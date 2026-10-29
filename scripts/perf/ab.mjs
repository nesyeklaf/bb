import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { printAbReport, runAb } from "./lib/ab-run.mjs";

const USAGE = `Usage: node scripts/perf/ab.mjs --a <url> --b <url> [options]

Interleaved A/B of thread switches and menu opens between two running bb servers on the same data.
Each round runs both variants in a fresh browser, in the order AB BA BA AB, so drift hits both alike.

Options:
  --a <url>             Baseline server
  --b <url>             Candidate server
  --start <thread id>   Thread to open first (default: the first idle thread in the sidebar)
  --threads <n>         Sidebar threads to switch between (default 4)
  --menus <n>           Thread actions menu opens per round (default 3)
  --rounds <n>          Rounds (default 8)
  --cpu-throttle <n>    Slow the page's CPU n times, 4 for an old laptop (default 1)
  --viewport <w,h>      Window size (default 1600,1000)
  --trace               Record a Chrome trace per run and break each wait down with Perfetto SQL
  --keep-traces         Keep the trace files (about 100 MB per run) instead of deleting them after the query
  --out <dir>           Output directory (default: <tmp>/bb-perf-ab/<timestamp>)
`;

const { values } = parseArgs({
  options: {
    a: { type: "string" },
    b: { type: "string" },
    start: { type: "string" },
    threads: { type: "string", default: "4" },
    menus: { type: "string", default: "3" },
    rounds: { type: "string", default: "8" },
    "cpu-throttle": { type: "string", default: "1" },
    viewport: { type: "string", default: "1600,1000" },
    trace: { type: "boolean", default: false },
    "keep-traces": { type: "boolean", default: false },
    out: { type: "string" },
    chrome: { type: "string" },
    help: { type: "boolean", default: false },
  },
});
if (values.help || !values.a || !values.b) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

const outDir = resolve(
  values.out ??
    join(tmpdir(), "bb-perf-ab", new Date().toISOString().replaceAll(":", "-")),
);

const report = await runAb({
  urls: { a: values.a, b: values.b },
  start: values.start ?? null,
  threadCount: Number(values.threads),
  menuCount: Number(values.menus),
  rounds: Number(values.rounds),
  cpuThrottle: Number(values["cpu-throttle"]),
  viewport: values.viewport,
  trace: values.trace,
  keepTraces: values["keep-traces"],
  chrome: values.chrome,
  outDir,
});
printAbReport(report);
console.log("\n" + join(outDir, "ab.json"));
