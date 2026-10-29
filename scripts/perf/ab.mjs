import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { abOrder, compareMedians, median } from "./lib/ab-stats.mjs";
import { PerfBrowser } from "./lib/browser.mjs";
import { wait } from "./lib/cdp.mjs";
import { querySqlFile, writeTrace } from "./lib/perfetto.mjs";
import { startTrace, stopTrace } from "./lib/trace.mjs";
import {
  SELECTORS,
  openThread,
  settle,
  threadReadyExpression,
} from "./lib/ui.mjs";

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

const urls = { a: values.a.replace(/\/$/, ""), b: values.b.replace(/\/$/, "") };
const rounds = Number(values.rounds);
const threadCount = Number(values.threads);
const menuCount = Number(values.menus);
const cpuThrottle = Number(values["cpu-throttle"]);
const [width, height] = values.viewport.split(",").map(Number);
const outDir = resolve(
  values.out ??
    join(tmpdir(), "bb-perf-ab", new Date().toISOString().replaceAll(":", "-")),
);
mkdirSync(outDir, { recursive: true });

const MEASURE_COLLECTOR =
  "window.__bbmeasures = []; new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.name.startsWith('bb:')) window.__bbmeasures.push({ name: entry.name, duration: entry.duration, label: entry.detail?.bb?.label ?? null }) }).observe({ type: 'measure' });";
const MENU_TRIGGER = "button[aria-label='Thread actions']";

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(url + " answered " + response.status);
  return response.json();
};

const threadInfo = async (base, id) => {
  const body = await fetchJson(base + "/api/v1/threads/" + id);
  const thread = body.thread ?? body;
  return {
    id,
    projectId: thread.projectId,
    archived: Boolean(thread.archivedAt ?? thread.archived),
  };
};

const visibleSidebarThreads = (browser) =>
  browser.evaluate(
    "[...document.querySelectorAll(" +
      JSON.stringify(SELECTORS.sidebarThread) +
      ")].filter((node) => { const rect = node.getBoundingClientRect(); return rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight }).map((node) => node.getAttribute('data-sidebar-thread-id')).filter((id, index, all) => all.indexOf(id) === index)",
  );

const timedAction = async (browser, kind, readyExpression, act) => {
  await browser.evaluate(
    "window.__bbperf.arm(" + JSON.stringify(readyExpression) + ", 20000)",
  );
  await act();
  const result = await browser.evaluate("window.__bbperf.collectArmed()");
  if (
    !result ||
    result.timedOut ||
    result.staleAtArm ||
    !result.sawInput ||
    result.waitMs === null
  )
    return null;
  await browser.evaluate(
    "performance.measure(" +
      JSON.stringify("lab:" + kind) +
      ", { start: " +
      result.startMs +
      ", end: " +
      (result.startMs + result.waitMs) +
      " }), true",
  );
  return result.waitMs;
};

const runVariant = async (variant, plan) => {
  const browser = await PerfBrowser.launch({
    chrome: values.chrome,
    windowSize: values.viewport,
    cpuThrottle,
  });
  const samples = [];
  try {
    await browser.setViewport({ width, height });
    await browser.client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: MEASURE_COLLECTOR,
    });
    await openThread(browser, urls[variant], plan.start);
    await settle(browser, { quietMs: 600, timeoutMs: 15_000 });
    const trace = values.trace ? await startTrace(browser.client) : null;
    for (const [index, thread] of plan.sequence.entries()) {
      const selector =
        "[data-sidebar-thread-id=" + JSON.stringify(thread.id) + "]";
      await browser.reveal(selector);
      const waitMs = await timedAction(
        browser,
        "switch",
        threadReadyExpression(thread),
        () => browser.click(selector),
      );
      samples.push({
        kind: "switch",
        visit: index < plan.threads.length ? "first" : "revisit",
        label: thread.id,
        waitMs,
      });
      await settle(browser, { quietMs: 300, timeoutMs: 8000 });
    }
    for (let index = 0; index < menuCount; index += 1) {
      const waitMs = await timedAction(
        browser,
        "open",
        "Boolean(document.querySelector('[role=menu]'))",
        () => browser.click(MENU_TRIGGER),
      );
      samples.push({
        kind: "open",
        visit: index === 0 ? "first" : "revisit",
        label: "thread actions",
        waitMs,
      });
      await browser.pressKey("Escape");
      await settle(browser, { quietMs: 300, timeoutMs: 5000 });
    }
    const measures = await browser.evaluate("window.__bbmeasures");
    let breakdown = null;
    if (trace !== null) {
      const events = await stopTrace(browser.client, trace);
      const tracePath = join(
        outDir,
        "round-" + plan.round + "-" + variant + ".trace.json",
      );
      await writeTrace(tracePath, events);
      const rows = querySqlFile(tracePath, "interaction-breakdown.sql");
      if (!values["keep-traces"]) rmSync(tracePath);
      const measured = samples.filter((sample) => sample.waitMs !== null);
      if (rows.length === measured.length)
        measured.forEach((sample, index) => {
          sample.breakdown = rows[index];
        });
      else
        breakdown = {
          error:
            "trace has " +
            rows.length +
            " lab windows for " +
            measured.length +
            " samples",
          rows,
        };
    }
    return { samples, measures, breakdown };
  } finally {
    await browser.close();
  }
};

const planThreads = async () => {
  const browser = await PerfBrowser.launch({
    chrome: values.chrome,
    windowSize: values.viewport,
  });
  try {
    await browser.setViewport({ width, height });
    await browser.navigate(urls.a + "/");
    await browser.waitForExpression(
      "document.querySelectorAll(" +
        JSON.stringify(SELECTORS.sidebarThread) +
        ").length > 3",
      {
        timeoutMs: 45_000,
        description: "sidebar threads",
      },
    );
    await settle(browser);
    const ids = await visibleSidebarThreads(browser);
    const infos = [];
    for (const id of ids) {
      const info = await threadInfo(urls.a, id).catch(() => null);
      if (info !== null && !info.archived) infos.push(info);
    }
    const start = values.start
      ? await threadInfo(urls.a, values.start)
      : infos[0];
    const threads = infos
      .filter((thread) => thread.id !== start.id)
      .slice(0, threadCount);
    if (threads.length < 2)
      throw new Error(
        "Need at least two visible idle sidebar threads, found " +
          threads.length,
      );
    return { start, threads };
  } finally {
    await browser.close();
  }
};

const { start, threads } = await planThreads();
const sequence = [...threads, ...threads];
console.log(
  "start " +
    start.id +
    ", switching between " +
    threads.map((thread) => thread.id).join(" "),
);
const runs = [];
for (let round = 0; round < rounds; round += 1) {
  for (const variant of abOrder(round)) {
    const result = await runVariant(variant, {
      round,
      start,
      threads,
      sequence,
    });
    runs.push({ round, variant, ...result });
    const switches = result.samples.filter(
      (sample) => sample.kind === "switch" && sample.waitMs !== null,
    );
    console.log(
      "round " +
        (round + 1) +
        "/" +
        rounds +
        " " +
        variant +
        ": switch median " +
        Math.round(median(switches.map((sample) => sample.waitMs)) ?? NaN) +
        " ms, " +
        result.samples.filter((sample) => sample.waitMs === null).length +
        " invalid",
    );
  }
}

const groups = [
  ["switch", "first"],
  ["switch", "revisit"],
  ["open", "first"],
  ["open", "revisit"],
];
const pick = (variant, kind, visit) =>
  runs
    .filter((run) => run.variant === variant)
    .flatMap((run) => run.samples)
    .filter(
      (sample) =>
        sample.kind === kind &&
        sample.visit === visit &&
        sample.waitMs !== null,
    )
    .map((sample) => sample.waitMs);
const comparisons = groups.map(([kind, visit]) => ({
  kind,
  visit,
  samples: {
    a: pick("a", kind, visit).length,
    b: pick("b", kind, visit).length,
  },
  ...compareMedians(pick("a", kind, visit), pick("b", kind, visit)),
}));
const BREAKDOWN_FIELDS = [
  "busy_ms",
  "idle_ms",
  "longest_task_ms",
  "script_ms",
  "style_ms",
  "layout_ms",
  "paint_ms",
  "gc_ms",
  "other_ms",
];
const breakdowns = groups
  .flatMap(([kind, visit]) =>
    ["a", "b"].map((variant) => {
      const rows = runs
        .filter((run) => run.variant === variant)
        .flatMap((run) => run.samples)
        .filter(
          (sample) =>
            sample.kind === kind && sample.visit === visit && sample.breakdown,
        );
      return {
        kind,
        visit,
        variant,
        samples: rows.length,
        ...Object.fromEntries(
          BREAKDOWN_FIELDS.map((field) => [
            field,
            median(rows.map((sample) => sample.breakdown[field])),
          ]),
        ),
      };
    }),
  )
  .filter((row) => row.samples > 0);
const spans = ["a", "b"].map((variant) => {
  const measures = runs
    .filter((run) => run.variant === variant)
    .flatMap((run) => run.measures);
  const names = [...new Set(measures.map((measure) => measure.name))].sort();
  return {
    variant,
    spans: names.map((name) => ({
      name,
      count: measures.filter((m) => m.name === name).length,
      medianMs: median(
        measures.filter((m) => m.name === name).map((m) => m.duration),
      ),
    })),
  };
});
const report = {
  startedAt: new Date().toISOString(),
  urls,
  rounds,
  cpuThrottle,
  viewport: values.viewport,
  start: start.id,
  threads: threads.map((thread) => thread.id),
  comparisons,
  breakdowns,
  spans,
  runs,
};
writeFileSync(join(outDir, "ab.json"), JSON.stringify(report, null, 2));
const fmt = (value) =>
  value === null || value === undefined ? "-" : String(Math.round(value));
console.log(
  "\nwait until usable, median ms (95% CI of b - a)" +
    (cpuThrottle > 1 ? ", CPU " + cpuThrottle + "x slower" : ""),
);
for (const row of comparisons)
  console.log(
    (row.kind + " " + row.visit).padEnd(16) +
      " a " +
      fmt(row.a).padStart(5) +
      "  b " +
      fmt(row.b).padStart(5) +
      "  delta " +
      fmt(row.delta).padStart(5) +
      " [" +
      fmt(row.low) +
      ", " +
      fmt(row.high) +
      "]  " +
      (row.verdict ?? "too few samples"),
  );
if (breakdowns.length > 0) {
  console.log("\nmain thread inside the wait, median ms (Perfetto)");
  console.log(
    "".padEnd(20) +
      BREAKDOWN_FIELDS.map((field) =>
        field.replace("_task", "").replace("_ms", "").padStart(8),
      ).join(""),
  );
  for (const row of breakdowns)
    console.log(
      (row.kind + " " + row.visit + " " + row.variant).padEnd(20) +
        BREAKDOWN_FIELDS.map((field) => fmt(row[field]).padStart(8)).join(""),
    );
}
for (const { variant, spans: list } of spans)
  if (list.length > 0)
    console.log(
      variant +
        " app spans: " +
        list
          .map(
            (span) =>
              span.name + " " + fmt(span.medianMs) + " (" + span.count + ")",
          )
          .join(", "),
    );
console.log("\n" + join(outDir, "ab.json"));
