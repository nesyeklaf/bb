import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { abOrder, compareMedians, median } from "./ab-stats.mjs";
import { PerfBrowser } from "./browser.mjs";
import { querySqlFile, writeTrace } from "./perfetto.mjs";
import { startTrace, stopTrace } from "./trace.mjs";
import { SELECTORS, openThread, settle, threadReadyExpression } from "./ui.mjs";

const MEASURE_COLLECTOR =
  "window.__bbmeasures = []; new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.name.startsWith('bb:')) window.__bbmeasures.push({ name: entry.name, duration: entry.duration, label: entry.detail?.bb?.label ?? null }) }).observe({ type: 'measure' });";
const MENU_TRIGGER_POINT =
  "(() => { const node = [...document.querySelectorAll(\"button[aria-label='Thread actions']\")].find((candidate) => { const rect = candidate.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && !candidate.closest(" +
  JSON.stringify(SELECTORS.sidebarBody) +
  ") }); if (!node) return null; const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })()";

export const AB_GROUPS = [
  ["switch", "first"],
  ["switch", "revisit"],
  ["open", "first"],
  ["open", "revisit"],
];
export const LOAD_GROUP = ["load", "first"];

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

const parseViewport = (viewport) => {
  const [width, height] = viewport.split(",").map(Number);
  return { width, height };
};

const runVariant = async (options, variant, plan) => {
  const { width, height } = parseViewport(options.viewport);
  const browser = await PerfBrowser.launch({
    chrome: options.chrome,
    windowSize: options.viewport,
    cpuThrottle: options.cpuThrottle,
  });
  const samples = [];
  try {
    await browser.setViewport({ width, height });
    await browser.client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: MEASURE_COLLECTOR,
    });
    if (options.measureLoad)
      await browser.watchOnLoad({
        startThread: threadReadyExpression(plan.start),
      });
    await openThread(browser, options.urls[variant], plan.start);
    if (options.measureLoad) {
      await browser
        .waitForExpression(
          "Boolean(window.__bbperf.watches().results.startThread?.paintedMs)",
          { timeoutMs: 5000, description: "start thread painted" },
        )
        .catch(() => null);
      const { results } = await browser.evaluate("window.__bbperf.watches()");
      samples.push({
        kind: "load",
        visit: "first",
        label: plan.start.id,
        waitMs: results.startThread?.paintedMs ?? null,
      });
    }
    await settle(browser, { quietMs: 600, timeoutMs: 15_000 });
    const trace = options.trace ? await startTrace(browser.client) : null;
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
    for (let index = 0; index < options.menuCount; index += 1) {
      const point = await browser.evaluate(MENU_TRIGGER_POINT);
      const waitMs =
        point === null
          ? null
          : await timedAction(
              browser,
              "open",
              "Boolean(document.querySelector('[role=menu]'))",
              () => browser.click(point),
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
        options.outDir,
        "round-" + plan.round + "-" + variant + ".trace.json",
      );
      await writeTrace(tracePath, events);
      const rows = querySqlFile(tracePath, "interaction-breakdown.sql");
      if (!options.keepTraces) rmSync(tracePath);
      const measured = samples.filter(
        (sample) => sample.kind !== "load" && sample.waitMs !== null,
      );
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

const planThreads = async (options) => {
  const { width, height } = parseViewport(options.viewport);
  const browser = await PerfBrowser.launch({
    chrome: options.chrome,
    windowSize: options.viewport,
  });
  try {
    await browser.setViewport({ width, height });
    await browser.navigate(options.urls.a + "/");
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
      const info = await threadInfo(options.urls.a, id).catch(() => null);
      if (info !== null && !info.archived) infos.push(info);
    }
    const start = options.start
      ? await threadInfo(options.urls.a, options.start)
      : infos[0];
    const threads = infos
      .filter((thread) => thread.id !== start.id)
      .slice(0, options.threadCount);
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

export const runAb = async ({
  urls,
  start: startId = null,
  threadCount = 4,
  menuCount = 3,
  rounds = 8,
  cpuThrottle = 1,
  viewport = "1600,1000",
  trace = false,
  keepTraces = false,
  measureLoad = false,
  chrome,
  outDir,
  log = console.log,
}) => {
  const options = {
    urls: { a: urls.a.replace(/\/$/, ""), b: urls.b.replace(/\/$/, "") },
    start: startId,
    threadCount,
    menuCount,
    cpuThrottle,
    viewport,
    trace,
    keepTraces,
    measureLoad,
    chrome,
    outDir,
  };
  mkdirSync(outDir, { recursive: true });
  const { start, threads } = await planThreads(options);
  const sequence = [...threads, ...threads];
  log(
    "start " +
      start.id +
      ", switching between " +
      threads.map((thread) => thread.id).join(" "),
  );
  const runs = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const variant of abOrder(round)) {
      const result = await runVariant(options, variant, {
        round,
        start,
        threads,
        sequence,
      });
      runs.push({ round, variant, ...result });
      const switches = result.samples.filter(
        (sample) => sample.kind === "switch" && sample.waitMs !== null,
      );
      log(
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

  const groups = measureLoad ? [LOAD_GROUP, ...AB_GROUPS] : AB_GROUPS;
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
  const attempts = (variant, kind, visit) =>
    runs
      .filter((run) => run.variant === variant)
      .flatMap((run) => run.samples)
      .filter((sample) => sample.kind === kind && sample.visit === visit)
      .length;
  const comparisons = groups.map(([kind, visit]) => ({
    kind,
    visit,
    samples: {
      a: pick("a", kind, visit).length,
      b: pick("b", kind, visit).length,
    },
    attempts: {
      a: attempts("a", kind, visit),
      b: attempts("b", kind, visit),
    },
    ...compareMedians(pick("a", kind, visit), pick("b", kind, visit)),
  }));
  const breakdowns = groups
    .flatMap(([kind, visit]) =>
      ["a", "b"].map((variant) => {
        const rows = runs
          .filter((run) => run.variant === variant)
          .flatMap((run) => run.samples)
          .filter(
            (sample) =>
              sample.kind === kind &&
              sample.visit === visit &&
              sample.breakdown,
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
    urls: options.urls,
    rounds,
    cpuThrottle,
    viewport,
    start: start.id,
    threads: threads.map((thread) => thread.id),
    comparisons,
    breakdowns,
    spans,
    runs,
  };
  writeFileSync(join(outDir, "ab.json"), JSON.stringify(report, null, 2));
  return report;
};

export const printAbReport = (report, log = console.log) => {
  const fmt = (value) =>
    value === null || value === undefined ? "-" : String(Math.round(value));
  log(
    "\nwait until usable, median ms (95% CI of b - a)" +
      (report.cpuThrottle > 1
        ? ", CPU " + report.cpuThrottle + "x slower"
        : ""),
  );
  for (const row of report.comparisons)
    log(
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
  if (report.breakdowns.length > 0) {
    log("\nmain thread inside the wait, median ms (Perfetto)");
    log(
      "".padEnd(20) +
        BREAKDOWN_FIELDS.map((field) =>
          field.replace("_task", "").replace("_ms", "").padStart(8),
        ).join(""),
    );
    for (const row of report.breakdowns)
      log(
        (row.kind + " " + row.visit + " " + row.variant).padEnd(20) +
          BREAKDOWN_FIELDS.map((field) => fmt(row[field]).padStart(8)).join(""),
      );
  }
  for (const { variant, spans: list } of report.spans)
    if (list.length > 0)
      log(
        variant +
          " app spans: " +
          list
            .map(
              (span) =>
                span.name + " " + fmt(span.medianMs) + " (" + span.count + ")",
            )
            .join(", "),
      );
};
