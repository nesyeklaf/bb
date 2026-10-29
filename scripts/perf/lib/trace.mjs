import { round, summarize, shareOver } from "./metrics.mjs";

export const FRAME_BUDGET_MS = 1000 / 144;
export const LONG_TASK_MS = 50;
export const IDLE_GAP_MS = 100;

export const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "benchmark",
  "input",
  "latencyInfo",
  "blink.user_timing",
];

const BUCKETS = ["script", "style", "layout", "paint", "composite", "other"];

const BUCKET_RULES = [
  [
    "style",
    /^(UpdateLayoutTree|RecalculateStyles|ScheduleStyleRecalculation|InvalidateLayout|ParseAuthorStyleSheet|StyleEngine|Document::updateStyle|SelectorStats)/,
  ],
  [
    "layout",
    /^(Layout$|LocalFrameView::performLayout|LocalFrameView::layout|IntersectionObserver|ResizeObserver)/,
  ],
  [
    "paint",
    /^(PrePaint|Paint$|LocalFrameView::RunPrePaint|LocalFrameView::RunPaint|Layerize|UpdateLayer$|ImageDecode|Decode|Draw|Raster)/,
  ],
  [
    "composite",
    /^(Commit|CompositeLayers|UpdateLayerTree|Layer::|ProxyMain|HitTest|ScrollLayer|UpdateLifecycle|LocalFrameView::RunCompositing)/,
  ],
  [
    "script",
    /^(v8|V8|FunctionCall|EvaluateScript|EventDispatch|Timer|FireAnimationFrame|FireIdleCallback|RunMicrotasks|MinorGC|MajorGC|BlinkGC|ParseScript|CompileScript|HandlePostMessage|XHR|WebSocket|MojoJS|ThreadState::|Heap)/,
  ],
];

const bucketCache = new Map();
const classify = (name) => {
  const cached = bucketCache.get(name);
  if (cached) return cached;
  const bucket =
    BUCKET_RULES.find(([, pattern]) => pattern.test(name))?.[0] ?? "other";
  bucketCache.set(name, bucket);
  return bucket;
};

const INPUT_CLASSES = new Map([
  ["Char", "typing"],
  ["KeyPress", "typing"],
  ["RawKeyDown", "typing"],
  ["KeyDown", "typing"],
  ["KeyUp", "typing"],
  ["MouseMove", "hover"],
  ["MouseEnter", "hover"],
  ["MouseDown", "click"],
  ["MouseUp", "click"],
  ["TouchStart", "click"],
  ["TouchEnd", "click"],
  ["GestureTap", "click"],
  ["GestureScrollBegin", "scroll"],
  ["GestureScrollUpdate", "scroll"],
  ["GestureScrollEnd", "scroll"],
  ["MouseWheel", "scroll"],
  ["TouchMove", "scroll"],
]);

const EVENT_TIMING_CLASSES = new Map([
  ["keydown", "typing"],
  ["keypress", "typing"],
  ["keyup", "typing"],
  ["input", "typing"],
  ["beforeinput", "typing"],
  ["pointerover", "hover"],
  ["pointerenter", "hover"],
  ["pointermove", "hover"],
  ["mouseover", "hover"],
  ["mouseenter", "hover"],
  ["mousemove", "hover"],
  ["pointerdown", "click"],
  ["pointerup", "click"],
  ["mousedown", "click"],
  ["mouseup", "click"],
  ["click", "click"],
]);

export const ATTRIBUTION_CATEGORIES = [
  "disabled-by-default-v8.cpu_profiler",
  "v8.execute",
];

export const startTrace = async (client, { extraCategories = [] } = {}) => {
  const events = [];
  const unsubscribe = client.on("Tracing.dataCollected", (params) => {
    for (const event of params.value ?? []) events.push(event);
  });
  await client.send("Tracing.start", {
    traceConfig: {
      recordMode: "recordContinuously",
      includedCategories: [...TRACE_CATEGORIES, ...extraCategories],
    },
    transferMode: "ReportEvents",
    bufferUsageReportingInterval: 1000,
  });
  return { events, unsubscribe };
};

export const stopTrace = async (client, handle, timeoutMs = 120_000) => {
  const complete = client.once("Tracing.tracingComplete", timeoutMs);
  await client.send("Tracing.end");
  await complete;
  handle.unsubscribe();
  return handle.events;
};

const pairAsync = (events, nameFilter) => {
  const open = new Map();
  const pairs = [];
  for (const event of events) {
    if (!nameFilter(event.name)) continue;
    const id = event.id ?? event.id2?.local ?? event.id2?.global;
    const key = event.pid + "|" + event.name + "|" + id;
    if (event.ph === "b") open.set(key, event);
    else if (event.ph === "e") {
      const begin = open.get(key);
      if (!begin) continue;
      open.delete(key);
      pairs.push({ begin, end: event });
    }
  }
  return pairs;
};

const findRendererMain = (events, urlPrefix) => {
  const threadNames = new Map();
  for (const event of events) {
    if (event.ph === "M" && event.name === "thread_name")
      threadNames.set(event.pid + ":" + event.tid, event.args?.name);
  }
  const mains = [...threadNames.entries()]
    .filter(([, name]) => name === "CrRendererMain")
    .map(([key]) => key);
  const started = events.find(
    (event) => event.name === "TracingStartedInBrowser",
  );
  const frames = started?.args?.data?.frames ?? [];
  const hinted = urlPrefix
    ? frames.filter(
        (frame) =>
          typeof frame.url === "string" && frame.url.startsWith(urlPrefix),
      )
    : [];
  const busyByKey = new Map();
  for (const event of events) {
    if (event.name !== "RunTask" || event.ph !== "X") continue;
    const key = event.pid + ":" + event.tid;
    if (!mains.includes(key)) continue;
    busyByKey.set(key, (busyByKey.get(key) ?? 0) + (event.dur ?? 0));
  }
  let chosen = null;
  if (hinted.length > 0) {
    const pids = new Set(hinted.map((frame) => frame.processId));
    chosen = mains.find((key) => pids.has(Number(key.split(":")[0]))) ?? null;
  }
  if (!chosen)
    chosen =
      [...busyByKey.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  if (!chosen) return null;
  const [pid, tid] = chosen.split(":").map(Number);
  return { pid, tid, candidates: mains.length, hinted: hinted.length > 0 };
};

const computeSelfTimes = (mainEvents) => {
  const ordered = mainEvents
    .filter((event) => event.ph === "X" && typeof event.dur === "number")
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const stack = [];
  const nodes = [];
  for (const event of ordered) {
    while (stack.length > 0 && stack[stack.length - 1].end <= event.ts)
      stack.pop();
    const node = {
      name: event.name,
      start: event.ts,
      end: event.ts + event.dur,
      childDur: 0,
      root: null,
    };
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.childDur += Math.min(node.end, parent.end) - node.start;
      node.root = parent.root ?? parent;
    }
    stack.push(node);
    nodes.push(node);
  }
  const segments = [];
  const rootSelf = new Map();
  for (const node of nodes) {
    const self = Math.max(0, node.end - node.start - node.childDur);
    node.self = self;
    if (self <= 0) continue;
    segments.push({
      start: node.start,
      end: node.start + self,
      bucket: classify(node.name),
      name: node.name,
    });
    const root = node.root ?? node;
    if (root.name === "RunTask") {
      const byName = rootSelf.get(root) ?? new Map();
      byName.set(node.name, (byName.get(node.name) ?? 0) + self);
      rootSelf.set(root, byName);
    }
  }
  segments.sort((a, b) => a.start - b.start);
  return { nodes, segments, rootSelf };
};

const overlap = (aStart, aEnd, bStart, bEnd) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

const framesFrom = (events, pid, windowStart, windowEnd) => {
  const pairs = pairAsync(
    events.filter((event) => event.pid === pid),
    (name) => name === "PipelineReporter",
  ).filter((pair) => pair.begin.args?.frame_reporter);
  const reporters = pairs
    .map(({ begin, end }) => ({
      begin: begin.ts,
      end: end.ts,
      state: end.args?.frame_reporter?.state ?? begin.args.frame_reporter.state,
    }))
    .filter(
      (reporter) => reporter.end >= windowStart && reporter.begin <= windowEnd,
    );
  const stateCounts = {};
  for (const reporter of reporters)
    stateCounts[reporter.state] = (stateCounts[reporter.state] ?? 0) + 1;
  const presented = reporters
    .filter((reporter) => reporter.state.startsWith("STATE_PRESENTED"))
    .sort((a, b) => a.end - b.end);
  const dropped = reporters.filter((reporter) =>
    reporter.state.includes("DROPPED"),
  ).length;
  return { reporters, presented, dropped, stateCounts };
};

const topEntries = (map, count) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([name, micros]) => ({ name, ms: round(micros / 1000) }));

export const analyzeTrace = (
  events,
  { urlPrefix, windowStartTs, windowEndTs } = {},
) => {
  const main = findRendererMain(events, urlPrefix);
  if (!main)
    return {
      ok: false,
      reason: "no CrRendererMain thread found in trace",
      eventCount: events.length,
    };
  const mainEvents = events.filter(
    (event) => event.pid === main.pid && event.tid === main.tid,
  );
  const timestamps = events
    .filter(
      (event) =>
        typeof event.ts === "number" && event.ts > 0 && event.ph !== "M",
    )
    .map((event) => event.ts);
  const windowStart = windowStartTs ?? Math.min(...timestamps);
  const windowEnd = windowEndTs ?? Math.max(...timestamps);
  const windowMs = (windowEnd - windowStart) / 1000;
  const { segments, rootSelf, nodes } = computeSelfTimes(mainEvents);

  const runTasks = nodes.filter(
    (node) =>
      node.name === "RunTask" &&
      node.end >= windowStart &&
      node.start <= windowEnd,
  );
  const busyMicros = runTasks.reduce(
    (total, node) =>
      total + overlap(node.start, node.end, windowStart, windowEnd),
    0,
  );
  const taskDurations = runTasks.map((node) => (node.end - node.start) / 1000);
  const longTasks = runTasks.filter(
    (node) => node.end - node.start > LONG_TASK_MS * 1000,
  );
  const longTaskDetail = longTasks
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, 10)
    .map((node) => ({
      atMs: round((node.start - windowStart) / 1000, 1),
      durationMs: round((node.end - node.start) / 1000),
      top: topEntries(rootSelf.get(node) ?? new Map(), 5),
    }));

  const { presented, dropped, stateCounts, reporters } = framesFrom(
    events,
    main.pid,
    windowStart,
    windowEnd,
  );
  const frames = [];
  let cursor = 0;
  for (let index = 1; index < presented.length; index += 1) {
    const start = presented[index - 1].end;
    const end = presented[index].end;
    while (cursor < segments.length && segments[cursor].end <= start)
      cursor += 1;
    const buckets = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
    for (
      let probe = cursor;
      probe < segments.length && segments[probe].start < end;
      probe += 1
    ) {
      const segment = segments[probe];
      buckets[segment.bucket] += overlap(
        segment.start,
        segment.end,
        start,
        end,
      );
    }
    const intervalMs = (end - start) / 1000;
    if (intervalMs < 0.1) continue;
    const busyMs =
      Object.values(buckets).reduce((total, value) => total + value, 0) / 1000;
    if (intervalMs > IDLE_GAP_MS && busyMs / intervalMs < 0.5) continue;
    frames.push({
      intervalMs,
      busyMs,
      latencyMs: (presented[index].end - presented[index].begin) / 1000,
      buckets: Object.fromEntries(
        BUCKETS.map((bucket) => [bucket, buckets[bucket] / 1000]),
      ),
    });
  }
  const stageSummary = {};
  for (const bucket of BUCKETS) {
    const values = frames.map((frame) => frame.buckets[bucket]);
    stageSummary[bucket] = {
      ...summarize(values),
      shareOverBudget: shareOver(values, FRAME_BUDGET_MS),
    };
  }
  const mainWork = frames.map((frame) => frame.busyMs - frame.buckets.other);
  const unknownNames = new Map();
  for (const segment of segments) {
    if (
      segment.bucket === "other" &&
      segment.start < windowEnd &&
      segment.end > windowStart
    )
      unknownNames.set(
        segment.name,
        (unknownNames.get(segment.name) ?? 0) + (segment.end - segment.start),
      );
  }

  const inputPairs = pairAsync(events, (name) =>
    name.startsWith("InputLatency::"),
  ).filter((pair) => pair.end.ts >= windowStart && pair.begin.ts <= windowEnd);
  const inputByClass = {};
  const inputByType = {};
  for (const { begin, end } of inputPairs) {
    const type = begin.name.slice("InputLatency::".length);
    const latency = (end.ts - begin.ts) / 1000;
    (inputByType[type] ??= []).push(latency);
    (inputByClass[INPUT_CLASSES.get(type) ?? "other"] ??= []).push(latency);
  }

  const seenTiming = new Set();
  const timingByClass = {};
  const timingByType = {};
  for (const event of events) {
    if (event.name !== "EventTiming" || event.ph !== "b" || !event.args?.data)
      continue;
    if (event.ts < windowStart || event.ts > windowEnd) continue;
    const data = event.args.data;
    const dedupe = event.id + "|" + data.type + "|" + data.timeStamp;
    if (seenTiming.has(dedupe)) continue;
    seenTiming.add(dedupe);
    (timingByType[data.type] ??= []).push(data.duration);
    (timingByClass[EVENT_TIMING_CLASSES.get(data.type) ?? "other"] ??= []).push(
      data.duration,
    );
  }

  const summarizeGroups = (groups) =>
    Object.fromEntries(
      Object.entries(groups).map(([key, values]) => [key, summarize(values)]),
    );

  return {
    ok: true,
    main: {
      pid: main.pid,
      tid: main.tid,
      candidates: main.candidates,
      matchedByUrl: main.hinted,
    },
    eventCount: events.length,
    windowMs: round(windowMs, 1),
    mainThread: {
      busyMs: round(busyMicros / 1000),
      busyShare: round(busyMicros / (windowEnd - windowStart), 4),
      taskCount: runTasks.length,
      taskMs: summarize(taskDurations),
      tasksOver16ms: taskDurations.filter((value) => value > 16).length,
      tasksOver50ms: longTasks.length,
      tasksOver100ms: taskDurations.filter((value) => value > 100).length,
      tasksOver200ms: taskDurations.filter((value) => value > 200).length,
      tasksOver500ms: taskDurations.filter((value) => value > 500).length,
      longTasks: longTaskDetail,
    },
    frames: {
      budgetMs: round(FRAME_BUDGET_MS),
      reporterStates: stateCounts,
      reporterCount: reporters.length,
      presentedCount: presented.length,
      droppedCount: dropped,
      measuredFrames: frames.length,
      intervalMs: {
        ...summarize(frames.map((frame) => frame.intervalMs)),
        shareOverBudget: shareOver(
          frames.map((frame) => frame.intervalMs),
          FRAME_BUDGET_MS,
        ),
      },
      mainWorkMs: {
        ...summarize(mainWork),
        shareOverBudget: shareOver(mainWork, FRAME_BUDGET_MS),
      },
      pipelineLatencyMs: summarize(frames.map((frame) => frame.latencyMs)),
      stagesMs: stageSummary,
      topUnclassified: topEntries(unknownNames, 8),
    },
    inputLatencyMs: {
      byClass: summarizeGroups(inputByClass),
      byType: summarizeGroups(inputByType),
      pairCount: inputPairs.length,
    },
    eventTimingMs: {
      byClass: summarizeGroups(timingByClass),
      byType: summarizeGroups(timingByType),
    },
  };
};
