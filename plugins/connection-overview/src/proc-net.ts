export type SocketProto = "tcp" | "udp";

export interface ProcNetEntry {
  proto: SocketProto;
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  state: number;
  inode: number;
}

export const TCP_LISTEN = 0x0a;
export const TCP_ESTABLISHED = 0x01;

function hexIpv4(hex: string): string {
  const value = Number.parseInt(hex, 16);
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    value >>> 24,
  ].join(".");
}

function hexIpv6(hex: string): string {
  const bytes: number[] = [];
  for (let word = 0; word < 4; word += 1) {
    const chunk = hex.slice(word * 8, word * 8 + 8);
    for (let index = 3; index >= 0; index -= 1)
      bytes.push(Number.parseInt(chunk.slice(index * 2, index * 2 + 2), 16));
  }
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (mapped) return bytes.slice(12).join(".");
  const groups: string[] = [];
  for (let index = 0; index < 16; index += 2)
    groups.push(((bytes[index]! << 8) | bytes[index + 1]!).toString(16));
  return compressIpv6(groups);
}

function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < groups.length; start += 1) {
    let length = 0;
    while (start + length < groups.length && groups[start + length] === "0")
      length += 1;
    if (length > bestLength && length > 1) {
      bestStart = start;
      bestLength = length;
    }
  }
  if (bestStart === -1) return groups.join(":");
  const head = groups.slice(0, bestStart).join(":");
  const tail = groups.slice(bestStart + bestLength).join(":");
  return head + "::" + tail;
}

function parseAddress(field: string): { ip: string; port: number } | null {
  const [ipHex, portHex] = field.split(":");
  if (ipHex === undefined || portHex === undefined) return null;
  if (ipHex.length === 8)
    return { ip: hexIpv4(ipHex), port: Number.parseInt(portHex, 16) };
  if (ipHex.length === 32)
    return { ip: hexIpv6(ipHex), port: Number.parseInt(portHex, 16) };
  return null;
}

export function parseProcNet(text: string, proto: SocketProto): ProcNetEntry[] {
  const entries: ProcNetEntry[] = [];
  for (const line of text.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) continue;
    const local = parseAddress(fields[1]!);
    const remote = parseAddress(fields[2]!);
    const inode = Number.parseInt(fields[9]!, 10);
    if (local === null || remote === null || !Number.isFinite(inode)) continue;
    entries.push({
      proto,
      localIp: local.ip,
      localPort: local.port,
      remoteIp: remote.ip,
      remotePort: remote.port,
      state: Number.parseInt(fields[3]!, 16),
      inode,
    });
  }
  return entries;
}

export interface ProcStat {
  pid: number;
  comm: string;
  ppid: number;
  startTime: number;
}

export function parseProcStat(text: string): ProcStat | null {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open === -1 || close === -1 || close < open) return null;
  const pid = Number.parseInt(text.slice(0, open).trim(), 10);
  const comm = text.slice(open + 1, close);
  const rest = text.slice(close + 2).split(" ");
  const ppid = Number.parseInt(rest[1] ?? "", 10);
  const startTime = Number.parseInt(rest[19] ?? "", 10);
  if (
    !Number.isFinite(pid) ||
    !Number.isFinite(ppid) ||
    !Number.isFinite(startTime)
  )
    return null;
  return { pid, comm, ppid, startTime };
}

export function socketInodeFromLink(link: string): number | null {
  const match = /^socket:\[(\d+)\]$/.exec(link);
  return match === null ? null : Number.parseInt(match[1]!, 10);
}

export function descendants(
  rootPid: number,
  stats: readonly ProcStat[],
  excluded: ReadonlySet<number> = new Set(),
): ProcStat[] {
  const children = new Map<number, ProcStat[]>();
  for (const stat of stats) {
    const list = children.get(stat.ppid) ?? [];
    list.push(stat);
    children.set(stat.ppid, list);
  }
  const root = stats.find((stat) => stat.pid === rootPid);
  const result: ProcStat[] = root === undefined ? [] : [root];
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const child of children.get(pid) ?? []) {
      if (excluded.has(child.pid)) continue;
      result.push(child);
      queue.push(child.pid);
    }
  }
  return result;
}
