import { readFileSync, readdirSync } from "node:fs";
import { wait } from "./cdp.mjs";
import { round } from "./metrics.mjs";

const clockTicksPerSecond = 100;

const listProcesses = (pattern) => {
  const found = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(
        "/proc/" + entry + "/cmdline",
        "utf8",
      ).replaceAll("\0", " ");
      if (
        cmdline.includes(pattern) &&
        !cmdline.includes("scripts/perf/run.mjs")
      )
        found.push({ pid: Number(entry), cmdline: cmdline.slice(0, 160) });
    } catch {}
  }
  return found;
};

const cpuSeconds = (pid) => {
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return (Number(fields[11]) + Number(fields[12])) / clockTicksPerSecond;
  } catch {
    return null;
  }
};

const rssMegabytes = (pid) => {
  try {
    const match = /VmRSS:\s+(\d+) kB/.exec(
      readFileSync("/proc/" + pid + "/status", "utf8"),
    );
    return match ? Number(match[1]) / 1024 : null;
  } catch {
    return null;
  }
};

export const processCpuDuring = async (pattern, durationMs) => {
  const before = new Map(
    listProcesses(pattern).map((proc) => [
      proc.pid,
      { ...proc, cpu: cpuSeconds(proc.pid) },
    ]),
  );
  const startedAt = performance.now();
  await wait(durationMs);
  const elapsed = (performance.now() - startedAt) / 1000;
  const processes = [];
  for (const [pid, proc] of before) {
    const cpuAfter = cpuSeconds(pid);
    if (proc.cpu === null || cpuAfter === null) continue;
    processes.push({
      pid,
      cmdline: proc.cmdline,
      cpuSeconds: round(cpuAfter - proc.cpu, 3),
      cpuShareOfOneCore: round((cpuAfter - proc.cpu) / elapsed, 4),
      rssMb: round(rssMegabytes(pid), 1),
    });
  }
  processes.sort((a, b) => b.cpuSeconds - a.cpuSeconds);
  return {
    pattern,
    windowSeconds: round(elapsed, 2),
    processCount: processes.length,
    totalCpuShareOfOneCore: round(
      processes.reduce((total, proc) => total + proc.cpuShareOfOneCore, 0),
      4,
    ),
    top: processes.slice(0, 5),
  };
};
