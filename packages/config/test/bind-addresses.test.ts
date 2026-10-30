import { describe, expect, it } from "vitest";
import {
  parseServerBindAddresses,
  readWireguardAddresses,
  type WireguardAddressReader,
} from "../src/bind-addresses.js";

const WIREGUARD = ["10.8.0.1", "fd00:8::1"];

function parse(value: string): string[] {
  return parseServerBindAddresses({ value, wireguardAddresses: WIREGUARD });
}

describe("parseServerBindAddresses", () => {
  it("accepts tailnet and WireGuard addresses as additional listeners", () => {
    expect(
      parse("100.101.102.103, 10.8.0.1 fd7a:115c:a1e0::1 [fd00:8:0::1]"),
    ).toEqual([
      "100.101.102.103",
      "10.8.0.1",
      "fd7a:115c:a1e0::1",
      "fd00:8::1",
    ]);
  });

  it("treats empty input and 127.0.0.1 as loopback only", () => {
    expect(parse("")).toEqual([]);
    expect(parse("127.0.0.1")).toEqual([]);
  });

  it.each(["0.0.0.0", "::", "[::]", "0:0:0:0:0:0:0:0", "100.64.0.1,0.0.0.0"])(
    "rejects the wildcard in %s",
    (value) => {
      expect(() => parse(value)).toThrow(/wildcard/u);
    },
  );

  it.each([
    "8.8.8.8",
    "192.168.1.10",
    "100.128.0.1",
    "100.63.255.255",
    "2001:db8::1",
    "fd7a:115c:a1e1::1",
    "::1",
  ])("rejects %s, which is neither tailnet nor WireGuard", (value) => {
    expect(() => parse(value)).toThrow(/neither a tailnet address/u);
  });

  it.each([
    "localhost",
    "tailnet.example.test",
    "100.64.0",
    "300.1.1.1",
    "fd7a::115c::1",
  ])("rejects the malformed entry %s", (value) => {
    expect(() => parse(value)).toThrow(/is not an IP address/u);
  });

  it("rejects duplicates, also in different spellings", () => {
    expect(() => parse("100.64.0.1,100.64.0.1")).toThrow(/more than once/u);
    expect(() => parse("fd7a:115c:a1e0::1 fd7a:115c:a1e0:0:0:0:0:1")).toThrow(
      /more than once/u,
    );
  });
});

describe("readWireguardAddresses", () => {
  it("reads addresses only from interfaces whose uevent says wireguard", () => {
    const reader: WireguardAddressReader = {
      interfaceNames: () => ["eth0", "wg0", "broken"],
      readUevent: (name) => {
        if (name === "broken") {
          throw new Error("gone");
        }
        return name === "wg0"
          ? "DEVTYPE=wireguard\nINTERFACE=wg0\n"
          : "INTERFACE=eth0\n";
      },
      addresses: () => ({
        eth0: [
          {
            address: "203.0.113.5",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: false,
            cidr: "203.0.113.5/24",
          },
        ],
        wg0: [
          {
            address: "10.8.0.1",
            netmask: "255.255.255.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: false,
            cidr: "10.8.0.1/24",
          },
        ],
      }),
    };
    expect(readWireguardAddresses(reader)).toEqual(["10.8.0.1"]);
  });

  it("returns no addresses when the interface list cannot be read", () => {
    const reader: WireguardAddressReader = {
      interfaceNames: () => {
        throw new Error("no sysfs");
      },
      readUevent: () => "",
      addresses: () => ({}),
    };
    expect(readWireguardAddresses(reader)).toEqual([]);
  });
});
