import { describe, expect, it } from "vitest";
import { classifyRequestPeer } from "./classify.js";
import type { InterfaceReader } from "./interfaces.js";
import { wireguardSubnets } from "./interfaces.js";

function reader(
  devices: Record<string, { devtype?: string; cidrs: string[] }>,
): InterfaceReader {
  return {
    names: () => Object.keys(devices),
    uevent: (name) => {
      const devtype = devices[name]?.devtype;
      if (devtype === "missing") throw new Error("ENOENT");
      return `INTERFACE=${name}\n${devtype === undefined ? "" : `DEVTYPE=${devtype}\n`}`;
    },
    addresses: () =>
      Object.fromEntries(
        Object.entries(devices).map(([name, device]) => [
          name,
          device.cidrs.map((cidr) => ({
            address: cidr.split("/")[0] ?? "",
            netmask: "",
            family: cidr.includes(":") ? ("IPv6" as const) : ("IPv4" as const),
            mac: "00:00:00:00:00:00",
            internal: false,
            cidr,
            scopeid: 0,
          })),
        ]),
      ),
  };
}

describe("wireguard subnets", () => {
  it("trusts peers on WireGuard interfaces only", () => {
    const subnets = wireguardSubnets(
      reader({
        eth0: { cidrs: ["203.0.113.5/24"] },
        docker0: { devtype: "bridge", cidrs: ["172.17.0.1/16"] },
        home: {
          devtype: "wireguard",
          cidrs: ["fd42:1234::1/64", "198.18.7.1/24"],
        },
        gone: { devtype: "missing", cidrs: ["198.51.100.1/24"] },
      }),
    );
    const state = (address: string) =>
      classifyRequestPeer({ address }, { bindSubnets: subnets }).state;
    expect(state("fd42:1234::2")).toBe("allowed");
    expect(state("198.18.7.20")).toBe("allowed");
    expect(state("203.0.113.9")).toBe("red");
    expect(state("198.51.100.7")).toBe("red");
  });

  it("returns no subnets when interfaces cannot be listed", () => {
    expect(
      wireguardSubnets({
        names: () => {
          throw new Error("EACCES");
        },
        uevent: () => "",
        addresses: () => ({}),
      }),
    ).toEqual([]);
  });
});
