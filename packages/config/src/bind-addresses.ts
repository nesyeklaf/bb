import { readFileSync, readdirSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { BB_LOOPBACK_HOST } from "./runtime.js";

export const SERVER_BIND_HOST_ENV_NAME = "BB_SERVER_BIND_HOST";

export interface WireguardAddressReader {
  addresses: () => ReturnType<typeof networkInterfaces>;
  interfaceNames: () => readonly string[];
  readUevent: (interfaceName: string) => string;
}

export interface ParseServerBindAddressesArgs {
  value: string;
  wireguardAddresses: readonly string[];
}

const SYS_NET_DIR = "/sys/class/net";

const tailnetBlockList = new BlockList();
tailnetBlockList.addSubnet("100.64.0.0", 10, "ipv4");
tailnetBlockList.addSubnet("fd7a:115c:a1e0::", 48, "ipv6");

export const linuxWireguardAddressReader: WireguardAddressReader = {
  addresses: () => networkInterfaces(),
  interfaceNames: () => readdirSync(SYS_NET_DIR),
  readUevent: (interfaceName) =>
    readFileSync(SYS_NET_DIR + "/" + interfaceName + "/uevent", "utf8"),
};

function isWireguardInterface(
  reader: WireguardAddressReader,
  interfaceName: string,
): boolean {
  try {
    return /^DEVTYPE=wireguard$/mu.test(reader.readUevent(interfaceName));
  } catch {
    return false;
  }
}

export function readWireguardAddresses(
  reader: WireguardAddressReader = linuxWireguardAddressReader,
): string[] {
  let interfaceNames: readonly string[];
  try {
    interfaceNames = reader.interfaceNames();
  } catch {
    return [];
  }
  const addresses = reader.addresses();
  const result: string[] = [];
  for (const interfaceName of interfaceNames) {
    if (!isWireguardInterface(reader, interfaceName)) {
      continue;
    }
    for (const entry of addresses[interfaceName] ?? []) {
      result.push(canonicalAddress(entry.address));
    }
  }
  return result;
}

function canonicalAddress(address: string): string {
  if (isIP(address) === 6) {
    return new URL("http://[" + address + "]").hostname.slice(1, -1);
  }
  return address;
}

function ipFamily(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 6 ? "ipv6" : "ipv4";
}

function isWildcardAddress(address: string): boolean {
  return address === "0.0.0.0" || address === "::";
}

export function parseServerBindAddresses(
  args: ParseServerBindAddressesArgs,
): string[] {
  const entries = args.value
    .split(/[\s,]+/u)
    .map((entry) => entry.trim().replace(/^\[(.*)\]$/u, "$1"))
    .filter((entry) => entry.length > 0);
  const wireguardAddresses = new Set(
    args.wireguardAddresses.map(canonicalAddress),
  );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (isIP(entry) === 0) {
      throw new Error(
        SERVER_BIND_HOST_ENV_NAME +
          " entry " +
          JSON.stringify(entry) +
          " is not an IP address",
      );
    }
    const address = canonicalAddress(entry.toLowerCase());
    if (seen.has(address)) {
      throw new Error(
        SERVER_BIND_HOST_ENV_NAME + " lists " + address + " more than once",
      );
    }
    seen.add(address);
    if (address === BB_LOOPBACK_HOST) {
      continue;
    }
    if (isWildcardAddress(address)) {
      throw new Error(
        SERVER_BIND_HOST_ENV_NAME +
          " must not contain the wildcard address " +
          address +
          "; list concrete tailnet or WireGuard addresses",
      );
    }
    if (
      !tailnetBlockList.check(address, ipFamily(address)) &&
      !wireguardAddresses.has(address)
    ) {
      throw new Error(
        SERVER_BIND_HOST_ENV_NAME +
          " entry " +
          address +
          " is neither a tailnet address (100.64.0.0/10, fd7a:115c:a1e0::/48) nor an address of a WireGuard interface on this host",
      );
    }
    result.push(address);
  }
  return result;
}

export function parseServerBindAddressesOnThisHost(value: string): string[] {
  return parseServerBindAddresses({
    value,
    wireguardAddresses: readWireguardAddresses(),
  });
}
