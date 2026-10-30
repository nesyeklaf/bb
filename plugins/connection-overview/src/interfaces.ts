import { readFileSync, readdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import type { Cidr } from "./ip.js";
import { parseCidr } from "./ip.js";

export interface InterfaceReader {
  names(): readonly string[];
  uevent(name: string): string;
  addresses(): ReturnType<typeof networkInterfaces>;
}

const SYS_NET = "/sys/class/net";

export const linuxInterfaces: InterfaceReader = {
  names: () => readdirSync(SYS_NET),
  uevent: (name) => readFileSync(`${SYS_NET}/${name}/uevent`, "utf8"),
  addresses: () => networkInterfaces(),
};

function isWireguard(reader: InterfaceReader, name: string): boolean {
  try {
    return /^DEVTYPE=wireguard$/m.test(reader.uevent(name));
  } catch {
    return false;
  }
}

export function wireguardSubnets(reader: InterfaceReader): Cidr[] {
  let names: readonly string[];
  try {
    names = reader.names();
  } catch {
    return [];
  }
  const addresses = reader.addresses();
  const subnets: Cidr[] = [];
  for (const name of names) {
    if (!isWireguard(reader, name)) continue;
    for (const entry of addresses[name] ?? []) {
      const cidr = entry.cidr === null ? null : parseCidr(entry.cidr);
      if (cidr !== null) subnets.push(cidr);
    }
  }
  return subnets;
}
