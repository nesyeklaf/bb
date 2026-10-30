import net from "node:net";

export interface Cidr {
  family: 4 | 6;
  bits: bigint;
  prefix: number;
}

function ipv4ToBigInt(ip: string): bigint {
  return ip
    .split(".")
    .reduce((acc, part) => (acc << 8n) | BigInt(Number.parseInt(part, 10)), 0n);
}

function ipv6ToBigInt(ip: string): bigint {
  const [head, tail] = ip.includes("::") ? ip.split("::") : [ip, null];
  const headGroups = head === "" || head === undefined ? [] : head.split(":");
  const tailGroups =
    tail === null || tail === "" || tail === undefined ? [] : tail.split(":");
  const fill = 8 - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array<string>(tail === null ? 0 : fill).fill("0"),
    ...tailGroups,
  ];
  return groups.reduce(
    (acc, group) => (acc << 16n) | BigInt(Number.parseInt(group, 16)),
    0n,
  );
}

export function normalizeIp(ip: string): string {
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:") && net.isIPv4(lower.slice(7)))
    return lower.slice(7);
  return lower;
}

export function parseCidr(value: string): Cidr | null {
  const [address, prefixText] = value.trim().split("/");
  if (address === undefined) return null;
  const family = net.isIP(address);
  if (family === 0) return null;
  const width = family === 4 ? 32 : 128;
  const prefix =
    prefixText === undefined ? width : Number.parseInt(prefixText, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) return null;
  const bits = family === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  return { family: family as 4 | 6, bits, prefix };
}

export function cidrContains(cidr: Cidr, ip: string): boolean {
  const normalized = normalizeIp(ip);
  const family = net.isIP(normalized);
  if (family !== cidr.family) return false;
  const width = family === 4 ? 32 : 128;
  const value =
    family === 4 ? ipv4ToBigInt(normalized) : ipv6ToBigInt(normalized);
  const shift = BigInt(width - cidr.prefix);
  return value >> shift === cidr.bits >> shift;
}

export const LOOPBACK = ["127.0.0.0/8", "::1/128"].map((c) => parseCidr(c)!);

export const TAILNET = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"].map((c) =>
  parseCidr(c)!,
);

export const LOCAL_NETWORKS = [
  "127.0.0.0/8",
  "::1/128",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "fd7a:115c:a1e0::/48",
  "169.254.0.0/16",
  "fe80::/10",
].map((c) => parseCidr(c)!);

export function inAny(cidrs: readonly Cidr[], ip: string): boolean {
  return cidrs.some((cidr) => cidrContains(cidr, ip));
}
