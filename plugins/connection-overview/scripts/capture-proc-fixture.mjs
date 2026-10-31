#!/usr/bin/env node
import fs from "node:fs";

const [rootArg, outPath] = process.argv.slice(2);
const rootPid = Number(rootArg);
if (!Number.isInteger(rootPid) || outPath === undefined) {
  console.error("Usage: capture-proc-fixture.mjs <host-daemon-pid> <out.json>");
  process.exit(1);
}

const KEEP_ARG = /(?:^|\/)([\w.@-]+\.(?:mjs|cjs|js))$/;
const ipMap = new Map();
const counters = { lan: 0, tailnet: 0, linkLocal: 0, public: 0, v6: 0 };

function read(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function link(path) {
  try {
    return fs.readlinkSync(path);
  } catch {
    return null;
  }
}

function parseStat(text) {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  const rest = text.slice(close + 2).split(" ");
  return {
    pid: Number(text.slice(0, open).trim()),
    comm: text.slice(open + 1, close),
    state: rest[0],
    ppid: Number(rest[1]),
    startTime: Number(rest[19]),
  };
}

function sanitizedStat({ pid, comm, state, ppid, startTime }) {
  const rest = Array.from({ length: 50 }, () => "0");
  rest[0] = state;
  rest[1] = String(ppid);
  rest[19] = String(startTime);
  return `${pid} (${comm}) ${rest.join(" ")}`;
}

function sanitizedCmdline(text) {
  if (text === null) return null;
  return text
    .split("\0")
    .filter((arg, index, args) => index < args.length - 1 || arg !== "")
    .map((arg, index) => {
      const kept = KEEP_ARG.exec(arg);
      if (kept !== null) return kept[1];
      if (index === 0) return arg.split("/").pop();
      return arg.startsWith("--") ? arg.split("=")[0] : "<arg>";
    })
    .join("\0") + "\0";
}

function mapV4(octets) {
  const ip = octets.join(".");
  const [a, b] = octets;
  if (a === 127 || ip === "0.0.0.0") return octets;
  if (!ipMap.has(ip)) {
    let kind = "public";
    if (a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168)) kind = "lan";
    else if (a === 100 && b >= 64 && b < 128) kind = "tailnet";
    else if (a === 169 && b === 254) kind = "linkLocal";
    counters[kind] += 1;
    const n = counters[kind];
    const base = { lan: [192, 168, 0], tailnet: [100, 64, 0], linkLocal: [169, 254, 0], public: n < 255 ? [203, 0, 113] : [198, 51, 100] }[kind];
    ipMap.set(ip, [...base, n % 255]);
  }
  return ipMap.get(ip);
}

function v4Hex(octets) {
  return octets.map((o) => o.toString(16).padStart(2, "0")).reverse().join("").toUpperCase();
}

function mapAddress(field) {
  const [hex, port] = field.split(":");
  if (hex.length === 8) {
    const value = Number.parseInt(hex, 16);
    const octets = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24];
    return `${v4Hex(mapV4(octets))}:${port}`;
  }
  const bytes = [];
  for (let word = 0; word < 4; word += 1)
    for (let i = 3; i >= 0; i -= 1) bytes.push(Number.parseInt(hex.slice(word * 8 + i * 2, word * 8 + i * 2 + 2), 16));
  const zeros10 = bytes.slice(0, 10).every((b) => b === 0);
  if (zeros10 && bytes[10] === 0xff && bytes[11] === 0xff) {
    const mapped = mapV4(bytes.slice(12));
    return `0000000000000000FFFF0000${v4Hex(mapped)}:${port}`;
  }
  if (zeros10 && bytes.slice(10, 15).every((b) => b === 0) && bytes[15] <= 1) return field;
  const key = hex;
  if (!ipMap.has(key)) {
    counters.v6 += 1;
    ipMap.set(key, counters.v6);
  }
  const n = ipMap.get(key);
  const out = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, (n >> 8) & 0xff, n & 0xff];
  let text = "";
  for (let word = 0; word < 4; word += 1)
    for (let i = 3; i >= 0; i -= 1) text += out[word * 4 + i].toString(16).padStart(2, "0");
  return `${text.toUpperCase()}:${port}`;
}

const stats = [];
for (const name of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(name)) continue;
  const text = read(`/proc/${name}/stat`);
  if (text !== null) stats.push(parseStat(text));
}
const children = new Map();
for (const stat of stats) {
  if (!children.has(stat.ppid)) children.set(stat.ppid, []);
  children.get(stat.ppid).push(stat);
}
const tree = [];
const queue = stats.filter((stat) => stat.pid === rootPid);
while (queue.length > 0) {
  const stat = queue.shift();
  tree.push(stat);
  queue.push(...(children.get(stat.pid) ?? []));
}

const procs = {};
const owned = new Set();
const netnsPids = new Map();
for (const stat of tree) {
  const netns = link(`/proc/${stat.pid}/ns/net`);
  let fds = null;
  try {
    fds = fs
      .readdirSync(`/proc/${stat.pid}/fd`)
      .map((fd) => link(`/proc/${stat.pid}/fd/${fd}`))
      .filter((target) => target !== null && target.startsWith("socket:["));
  } catch {}
  for (const target of fds ?? []) owned.add(target.slice(8, -1));
  if (netns !== null && !netnsPids.has(netns)) netnsPids.set(netns, stat.pid);
  procs[stat.pid] = {
    stat: sanitizedStat(stat),
    cmdline: stat.comm.startsWith("node") ? sanitizedCmdline(read(`/proc/${stat.pid}/cmdline`)) : null,
    netns,
    fds,
  };
}

const net = {};
for (const pid of netnsPids.values()) {
  net[pid] = {};
  for (const file of ["tcp", "tcp6", "udp", "udp6"]) {
    const text = read(`/proc/${pid}/net/${file}`);
    if (text === null) continue;
    const [header, ...lines] = text.split("\n");
    const kept = lines
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => fields.length >= 10 && owned.has(fields[9]))
      .map((fields, index) => {
        fields[0] = `${index}:`;
        fields[1] = mapAddress(fields[1]);
        fields[2] = mapAddress(fields[2]);
        fields[7] = "1000";
        if (fields[11] !== undefined) fields[11] = "0".repeat(fields[11].length);
        return "   " + fields.join(" ");
      });
    net[pid][file] = [header, ...kept, ""].join("\n");
  }
}

fs.writeFileSync(outPath, JSON.stringify({ rootPid, procs, net }, null, 1) + "\n");
console.log(`${tree.length} processes, ${owned.size} sockets, ${ipMap.size} addresses rewritten -> ${outPath}`);
