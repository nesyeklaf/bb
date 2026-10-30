import { describe, expect, it } from "vitest";
import {
  descendants,
  parseProcNet,
  parseProcStat,
  socketInodeFromLink,
} from "./proc-net.js";

const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:96A6 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1 0000000000000000 100 0 0 10 0
   1: 4AE47364:C9F4 0679528C:01BB 01 00000000:00000000 02:000A7D7A 00000000  1000        0 222 2 0000000000000000 20 4 30 10 -1
`;
const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0000000000000000FFFF00000100007F:96A6 0000000000000000FFFF00000100007F:D2F0 01 00000000:00000000 00:00000000 00000000  1000        0 333 1 0000000000000000 20 4 0 10 -1
   1: 00000000000000000000000001000000:1F90 C06B0726000000000000000010000000:01BB 01 00000000:00000000 00:00000000 00000000  1000        0 444 1 0000000000000000 20 4 0 10 -1
`;

describe("parseProcNet", () => {
  it("decodes little-endian IPv4 addresses, ports, state and inode", () => {
    expect(parseProcNet(TCP, "tcp")).toEqual([
      {
        proto: "tcp",
        localIp: "127.0.0.1",
        localPort: 38566,
        remoteIp: "0.0.0.0",
        remotePort: 0,
        state: 0x0a,
        inode: 111,
      },
      {
        proto: "tcp",
        localIp: "100.115.228.74",
        localPort: 51700,
        remoteIp: "140.82.121.6",
        remotePort: 443,
        state: 0x01,
        inode: 222,
      },
    ]);
  });

  it("unwraps v4-mapped IPv6 and compresses plain IPv6", () => {
    const rows = parseProcNet(TCP6, "tcp");
    expect(rows[0]).toMatchObject({
      localIp: "127.0.0.1",
      remoteIp: "127.0.0.1",
      remotePort: 0xd2f0,
    });
    expect(rows[1]).toMatchObject({
      localIp: "::1",
      remoteIp: "2607:6bc0::10",
      remotePort: 443,
      inode: 444,
    });
  });

  it("skips malformed lines", () => {
    expect(parseProcNet("header\n  0: zz\n", "udp")).toEqual([]);
  });
});

describe("parseProcStat", () => {
  it("keeps spaces and parentheses inside comm", () => {
    const fields = Array.from({ length: 50 }, (_, index) => String(index));
    fields[0] = "77";
    fields[18] = "123456";
    const stat = parseProcStat(`42 (node (worker) x) S ${fields.join(" ")}`);
    expect(stat).toEqual({
      pid: 42,
      comm: "node (worker) x",
      ppid: 77,
      startTime: 123456,
    });
  });
});

describe("socketInodeFromLink", () => {
  it("reads socket inodes and ignores other descriptors", () => {
    expect(socketInodeFromLink("socket:[98765]")).toBe(98765);
    expect(socketInodeFromLink("/dev/null")).toBeNull();
    expect(socketInodeFromLink("anon_inode:[eventfd]")).toBeNull();
  });
});

describe("descendants", () => {
  const stats = [
    { pid: 1, comm: "systemd", ppid: 0, startTime: 1 },
    { pid: 10, comm: "server", ppid: 1, startTime: 2 },
    { pid: 11, comm: "daemon", ppid: 10, startTime: 3 },
    { pid: 12, comm: "claude", ppid: 11, startTime: 4 },
    { pid: 13, comm: "git", ppid: 10, startTime: 5 },
    { pid: 20, comm: "other", ppid: 1, startTime: 6 },
  ];

  it("walks the whole tree below the root", () => {
    expect(
      descendants(10, stats)
        .map((stat) => stat.pid)
        .sort(),
    ).toEqual([10, 11, 12, 13]);
  });

  it("drops excluded subtrees so a local daemon is not counted twice", () => {
    expect(
      descendants(10, stats, new Set([11]))
        .map((stat) => stat.pid)
        .sort(),
    ).toEqual([10, 13]);
  });

  it("returns nothing when the root is gone", () => {
    expect(descendants(99, stats)).toEqual([]);
  });
});
