import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { abOrder, compareMedians, median } from "./lib/ab-stats.mjs";
import {
  REACT_DEVTOOLS_STUB,
  attributeTrace,
  cpuProfiles,
  frameUrls,
  summarizeAttribution,
} from "./lib/attribution.mjs";
import { AppApi } from "./lib/api.mjs";
import { PerfBrowser } from "./lib/browser.mjs";
import { wait } from "./lib/cdp.mjs";
import { querySqlFile, writeTrace } from "./lib/perfetto.mjs";
import { loadSourceMaps, sourceResolver } from "./lib/sourcemap.mjs";
import { scrollerPoint, SCROLLER_SELECTORS } from "./lib/scroll.mjs";
import {
  SCROLL_GESTURES,
  attachPacing,
  compareSmoothness,
  measureScrollGesture,
  tracePacing,
} from "./lib/smoothness.mjs";
import { ATTRIBUTION_CATEGORIES, startTrace, stopTrace } from "./lib/trace.mjs";
import {
  SELECTORS,
  openThread,
  settle,
  threadReadyExpression,
} from "./lib/ui.mjs";

const USAGE = `Usage: node scripts/perf/ab.mjs --a <url> --b <url> [options]

Interleaved A/B between two running bb servers on the same data.
Each round runs both variants in a fresh browser, in the order AB BA BA AB, so drift hits both alike.

Scenarios:
  switch                Thread switches and thread actions menu opens, timed until usable (default)
  scroll                A continuous wheel scroll up and a touch fling up on one heavy thread, compared by
                        frame pacing (presented frames from the trace, rAF and LoAF in the page)

Options:
  --a <url>             Baseline server
  --b <url>             Candidate server
  --scenario <name>     switch or scroll (default switch)
  --start <thread id>   Thread to open first, and the thread scrolled by --scenario scroll
                        (default: the first idle sidebar thread; for scroll the heaviest idle thread)
  --threads <n>         Sidebar threads to switch between (default 4)
  --menus <n>           Thread actions menu opens per round (default 3)
  --rounds <n>          Rounds (default 8)
  --cpu-throttle <n>    Slow the page's CPU n times, 4 for an old laptop (default 1)
  --viewport <w,h>      Window size (default 1600,1000)
  --trace               Record a Chrome trace per run and break each wait down with Perfetto SQL
  --keep-traces         Keep the trace files (about 100 MB per run) instead of deleting them after the query
  --attribute           Also sample the JS CPU profile and list the top functions and modules inside each wait,
                        mapped to source through the bundle's source maps (implies --trace)
  --react-components    With --attribute, also list the React components that rendered inside each wait.
                        Needs a React profiling build (scripts/perf/profiling-proxy.mjs) and slows renders down
  --sourcemaps <dir>    Read <chunk>.map from this directory before fetching <chunk url>.map from the server
  --out <dir>           Output directory (default: <tmp>/bb-perf-ab/<timestamp>)
`;

const { values } = parseArgs({
  options: {
    a: { type: "string" },
    b: { type: "string" },
    scenario: { type: "string", default: "switch" },
    start: { type: "string" },
    threads: { type: "string", default: "4" },
    menus: { type: "string", default: "3" },
    rounds: { type: "string", default: "8" },
    "cpu-throttle": { type: "string", default: "1" },
    viewport: { type: "string", default: "1600,1000" },
    trace: { type: "boolean", default: false },
    "keep-traces": { type: "boolean", default: false },
    attribute: { type: "boolean", default: false },
    "react-components": { type: "boolean", default: false },
    sourcemaps: { type: "string" },
    out: { type: "string" },
    chrome: { type: "string" },
    help: { type: "boolean", default: false },
  },
});
if (values.help || !values.a || !values.b) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

if (!["switch", "scroll"].includes(values.scenario)) {
  console.error("Unknown scenario '" + values.scenario + "'.\n\n" + USAGE);
  process.exit(2);
}
const scrolling = values.scenario === "scroll";
const urls = { a: values.a.replace(/\/$/, ""), b: values.b.replace(/\/$/, "") };
const attribute = values.attribute || values["react-components"];
const tracing = values.trace || attribute || scrolling;
const sourceMapCache = new Map();
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

const runSwitches = async (browser, plan, samples) => {
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
};

const runScroll = async (browser, plan, samples) => {
  const scroller = SCROLLER_SELECTORS.timeline;
  const point = await scrollerPoint(browser, scroller);
  for (const gesture of SCROLL_GESTURES) {
    const smoothness = await measureScrollGesture(browser, {
      scroller,
      point,
      gesture,
    });
    samples.push({
      kind: gesture.name,
      visit: "scroll",
      label: plan.start.id,
      waitMs:
        smoothness.scrolled && smoothness.moved > 100
          ? smoothness.durationMs
          : null,
      smoothness,
    });
  }
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
    if (values["react-components"])
      await browser.client.send("Page.addScriptToEvaluateOnNewDocument", {
        source: REACT_DEVTOOLS_STUB,
      });
    await openThread(browser, urls[variant], plan.start);
    await settle(browser, { quietMs: 600, timeoutMs: 15_000 });
    const trace = tracing
      ? await startTrace(browser.client, {
          extraCategories: attribute ? ATTRIBUTION_CATEGORIES : [],
        })
      : null;
    if (scrolling) await runScroll(browser, plan, samples);
    else await runSwitches(browser, plan, samples);
    const measures = await browser.evaluate("window.__bbmeasures");
    let breakdown = null;
    if (trace !== null) {
      const events = await stopTrace(browser.client, trace);
      const tracePath = join(
        outDir,
        "round-" + plan.round + "-" + variant + ".trace.json",
      );
      if (scrolling)
        attachPacing(
          samples.map((sample) => sample.smoothness),
          tracePacing(events),
        );
      await writeTrace(tracePath, events);
      const rows = querySqlFile(tracePath, "interaction-breakdown.sql");
      if (!values["keep-traces"]) rmSync(tracePath);
      const measured = samples.filter((sample) => sample.waitMs !== null);
      if (attribute) {
        await loadSourceMaps(frameUrls(cpuProfiles(events)), {
          directory: values.sourcemaps ?? null,
          cache: sourceMapCache,
        });
        const attributions = attributeTrace(events, {
          resolve: sourceResolver(sourceMapCache),
          components: values["react-components"],
        });
        if (attributions.length === measured.length)
          measured.forEach((sample, index) => {
            sample.attribution = attributions[index];
          });
      }
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

const planScroll = async () => {
  if (values.start) return { start: await threadInfo(urls.a, values.start) };
  const [heaviest] = await new AppApi(urls.a).rankSidebarThreads(40);
  return { start: heaviest };
};

const planThreads = async () => {
  if (scrolling) return { ...(await planScroll()), threads: [] };
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
  scrolling
    ? "scrolling " + start.id
    : "start " +
        start.id +
        ", switching between " +
        threads.map((thread) => thread.id).join(" "),
);
const roundLine = (samples) => {
  if (!scrolling) {
    const switches = samples.filter(
      (sample) => sample.kind === "switch" && sample.waitMs !== null,
    );
    return (
      "switch median " +
      Math.round(median(switches.map((sample) => sample.waitMs)) ?? NaN) +
      " ms"
    );
  }
  return samples
    .map(
      (sample) =>
        sample.kind +
        " p95 " +
        (sample.smoothness.presented?.p95Ms ?? "-") +
        " ms dropped " +
        (sample.smoothness.presented?.droppedPct ?? "-") +
        "%",
    )
    .join(", ");
};
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
    console.log(
      "round " +
        (round + 1) +
        "/" +
        rounds +
        " " +
        variant +
        ": " +
        roundLine(result.samples) +
        ", " +
        result.samples.filter((sample) => sample.waitMs === null).length +
        " invalid",
    );
  }
}

const groups = scrolling
  ? SCROLL_GESTURES.map((gesture) => [gesture.name, "scroll"])
  : [
      ["switch", "first"],
      ["switch", "revisit"],
      ["open", "first"],
      ["open", "revisit"],
    ];
const smoothnessOf = (variant, kind) =>
  runs
    .filter((run) => run.variant === variant)
    .flatMap((run) => run.samples)
    .filter((sample) => sample.kind === kind && sample.waitMs !== null)
    .map((sample) => sample.smoothness);
const smoothness = scrolling
  ? SCROLL_GESTURES.map((gesture) => ({
      gesture: gesture.name,
      metrics: compareSmoothness(
        smoothnessOf("a", gesture.name),
        smoothnessOf("b", gesture.name),
      ),
    }))
  : [];
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
const attributions = attribute
  ? [...new Set(groups.map(([kind]) => kind))].flatMap((kind) =>
      ["a", "b"].map((variant) => ({
        kind,
        variant,
        ...summarizeAttribution(
          runs
            .filter((run) => run.variant === variant)
            .flatMap((run) => run.samples)
            .filter((sample) => sample.kind === kind && sample.attribution)
            .map((sample) => sample.attribution),
        ),
      })),
    )
  : [];
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
  scenario: values.scenario,
  comparisons,
  smoothness,
  breakdowns,
  attributions,
  spans,
  runs,
};
writeFileSync(join(outDir, "ab.json"), JSON.stringify(report, null, 2));
const fmt = (value) =>
  value === null || value === undefined ? "-" : String(Math.round(value));
const throttleNote = cpuThrottle > 1 ? ", CPU " + cpuThrottle + "x slower" : "";
const decimal = (value) =>
  value === null || value === undefined ? "-" : value.toFixed(1);
for (const { gesture, metrics } of smoothness) {
  console.log(
    "\n" +
      gesture +
      ", median per run (95% CI of b - a), lower is smoother" +
      throttleNote,
  );
  for (const row of metrics)
    console.log(
      row.metric.padEnd(22) +
        " a " +
        decimal(row.a).padStart(7) +
        "  b " +
        decimal(row.b).padStart(7) +
        "  delta " +
        decimal(row.delta).padStart(7) +
        " [" +
        decimal(row.low) +
        ", " +
        decimal(row.high) +
        "]  " +
        (row.verdict ?? "too few samples"),
    );
}
if (!scrolling)
  console.log(
    "\nwait until usable, median ms (95% CI of b - a)" + throttleNote,
  );
for (const row of scrolling ? [] : comparisons)
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
const shorten = (text, width) =>
  text.length > width ? "…" + text.slice(text.length - width + 1) : text;
for (const summary of attributions.filter((entry) => entry.waits > 0)) {
  console.log(
    "\nJS self time per " +
      summary.kind +
      " wait, " +
      summary.variant +
      ", mean ms over " +
      summary.waits +
      " waits (" +
      fmt(summary.sampledMs) +
      " ms sampled)",
  );
  for (const entry of summary.functions.slice(0, 8))
    console.log(
      entry.selfMs.toFixed(1).padStart(8) +
        "  " +
        shorten(entry.name, 32).padEnd(32) +
        " " +
        shorten(entry.location, 60),
    );
  console.log("  modules:");
  for (const entry of summary.modules.slice(0, 6))
    console.log(
      entry.selfMs.toFixed(1).padStart(8) + "  " + shorten(entry.module, 80),
    );
  if (summary.components !== null && summary.components.length === 0)
    console.log(
      "  React components: none recorded, the server does not run a React profiling build",
    );
  else if (summary.components !== null) {
    console.log("  React components (self render time):");
    for (const entry of summary.components.slice(0, 6))
      console.log(
        entry.selfMs.toFixed(1).padStart(8) +
          "  " +
          shorten(entry.component, 40).padEnd(40) +
          " " +
          entry.renders +
          " renders",
      );
  }
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
