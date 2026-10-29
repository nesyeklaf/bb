import { chunkLabel } from "./sourcemap.mjs";

export const REACT_COMPONENTS_TRACK = "Components ⚛";
export const REACT_DEVTOOLS_STUB =
  "window.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= { isDisabled: true };";
export const MAX_SAMPLE_WEIGHT_US = 10_000;

const NATIVE_FRAMES = new Set([
  "(program)",
  "(garbage collector)",
  "(root)",
  "(idle)",
]);

export const labWindows = (events, prefix = "lab:") => {
  const open = new Map();
  const windows = [];
  for (const event of events) {
    if (event.cat !== "blink.user_timing" || !event.name?.startsWith(prefix))
      continue;
    const key =
      event.pid + "/" + event.name + "/" + (event.id2?.local ?? event.id);
    if (event.ph === "b") open.set(key, event);
    else if (event.ph === "e" && open.has(key)) {
      const begin = open.get(key);
      open.delete(key);
      windows.push({
        name: event.name,
        pid: event.pid,
        start: begin.ts,
        end: event.ts,
      });
    }
  }
  return windows.sort((a, b) => a.start - b.start);
};

export const cpuProfiles = (events) => {
  const profiles = new Map();
  const profileFor = (event) => {
    const key = event.pid + "/" + event.id;
    if (!profiles.has(key))
      profiles.set(key, {
        pid: event.pid,
        tid: null,
        startTime: null,
        nodes: new Map(),
        samples: [],
        deltas: [],
      });
    return profiles.get(key);
  };
  for (const event of events) {
    if (event.name === "Profile") {
      const profile = profileFor(event);
      profile.tid = event.tid;
      profile.startTime = event.args?.data?.startTime ?? event.ts;
    } else if (event.name === "ProfileChunk") {
      const profile = profileFor(event);
      const data = event.args?.data ?? {};
      for (const node of data.cpuProfile?.nodes ?? [])
        profile.nodes.set(node.id, node);
      profile.samples.push(...(data.cpuProfile?.samples ?? []));
      profile.deltas.push(...(data.timeDeltas ?? []));
    }
  }
  return [...profiles.values()]
    .filter((profile) => profile.startTime !== null)
    .map((profile) => {
      let time = profile.startTime;
      const timed = profile.samples.map((nodeId, index) => {
        time += profile.deltas[index] ?? 0;
        return { ts: time, nodeId };
      });
      timed.sort((a, b) => a.ts - b.ts);
      return {
        pid: profile.pid,
        tid: profile.tid,
        nodes: profile.nodes,
        samples: timed.map((sample, index) => ({
          ...sample,
          weight: Math.min(
            (timed[index + 1]?.ts ?? sample.ts) - sample.ts,
            MAX_SAMPLE_WEIGHT_US,
          ),
        })),
      };
    });
};

export const frameUrls = (profiles) =>
  [
    ...new Set(
      profiles.flatMap((profile) =>
        [...profile.nodes.values()].map((node) => node.callFrame.url),
      ),
    ),
  ].filter(Boolean);

const describeFrame = (callFrame, resolve) => {
  const name = callFrame.functionName || "(anonymous)";
  if (NATIVE_FRAMES.has(name) || !callFrame.url)
    return {
      name,
      location: callFrame.url ? chunkLabel(callFrame.url) : "(native)",
      module: callFrame.url ? chunkLabel(callFrame.url) : "(v8)",
    };
  const mapped = resolve(
    callFrame.url,
    callFrame.lineNumber ?? 0,
    callFrame.columnNumber ?? 0,
  );
  if (mapped === null) {
    const chunk = chunkLabel(callFrame.url);
    return {
      name,
      location:
        chunk +
        ":" +
        ((callFrame.lineNumber ?? 0) + 1) +
        ":" +
        ((callFrame.columnNumber ?? 0) + 1),
      module: chunk,
    };
  }
  return {
    name,
    location: mapped.source + ":" + (mapped.line + 1),
    module: mapped.source,
  };
};

const topEntries = (totals, limit) =>
  [...totals.values()]
    .sort((a, b) => b.selfUs - a.selfUs)
    .slice(0, limit)
    .map(({ selfUs, ...rest }) => ({
      ...rest,
      selfMs: Math.round(selfUs / 10) / 100,
    }));

const addTo = (totals, key, entry, weight) => {
  const current = totals.get(key) ?? { ...entry, selfUs: 0 };
  current.selfUs += weight;
  totals.set(key, current);
};

export const attributeCpu = (
  profiles,
  windows,
  { resolve = () => null, limit = 15 } = {},
) => {
  const described = new Map();
  const frameFor = (profile, nodeId) => {
    const key = profile.pid + "/" + profile.tid + "/" + nodeId;
    if (!described.has(key)) {
      const node = profile.nodes.get(nodeId);
      described.set(
        key,
        node
          ? describeFrame(node.callFrame, resolve)
          : { name: "(unknown)", location: "(unknown)", module: "(unknown)" },
      );
    }
    return described.get(key);
  };
  return windows.map((window) => {
    const functions = new Map();
    const modules = new Map();
    let sampledUs = 0;
    for (const profile of profiles) {
      if (profile.pid !== window.pid) continue;
      for (const sample of profile.samples) {
        if (sample.ts < window.start || sample.ts >= window.end) continue;
        const frame = frameFor(profile, sample.nodeId);
        if (frame.name === "(idle)") continue;
        sampledUs += sample.weight;
        addTo(
          functions,
          frame.name + " " + frame.location,
          { name: frame.name, location: frame.location },
          sample.weight,
        );
        addTo(modules, frame.module, { module: frame.module }, sample.weight);
      }
    }
    return {
      name: window.name,
      waitMs: Math.round((window.end - window.start) / 10) / 100,
      sampledMs: Math.round(sampledUs / 10) / 100,
      functions: topEntries(functions, limit),
      modules: topEntries(modules, limit),
    };
  });
};

export const componentRenders = (events) =>
  events
    .filter(
      (event) =>
        event.name === "TimeStamp" &&
        event.args?.data?.track === REACT_COMPONENTS_TRACK &&
        typeof event.args.data.start === "number" &&
        typeof event.args.data.end === "number",
    )
    .map((event) => ({
      pid: event.pid,
      name: event.args.data.message ?? event.args.data.name ?? "(unknown)",
      start: event.args.data.start,
      end: event.args.data.end,
    }));

export const componentSelfTimes = (renders) => {
  const byPid = new Map();
  for (const render of renders) {
    if (!byPid.has(render.pid)) byPid.set(render.pid, []);
    byPid.get(render.pid).push(render);
  }
  const result = [];
  for (const list of byPid.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
    const stack = [];
    for (const render of sorted) {
      while (stack.length > 0 && stack.at(-1).end <= render.start) stack.pop();
      const entry = { ...render, selfUs: render.end - render.start };
      const parent = stack.at(-1);
      if (parent && render.end <= parent.end)
        parent.selfUs -= render.end - render.start;
      stack.push(entry);
      result.push(entry);
    }
  }
  return result;
};

export const attributeComponents = (events, windows, { limit = 15 } = {}) => {
  const renders = componentSelfTimes(componentRenders(events));
  return windows.map((window) => {
    const totals = new Map();
    let count = 0;
    for (const render of renders) {
      if (render.pid !== window.pid) continue;
      if (render.start < window.start || render.start >= window.end) continue;
      count += 1;
      const current = totals.get(render.name) ?? {
        component: render.name,
        renders: 0,
        selfUs: 0,
      };
      current.renders += 1;
      current.selfUs += Math.max(render.selfUs, 0);
      totals.set(render.name, current);
    }
    return {
      name: window.name,
      renders: count,
      components: topEntries(totals, limit),
    };
  });
};

export const attributeTrace = (
  events,
  { resolve = () => null, components = false, limit = 15 } = {},
) => {
  const windows = labWindows(events);
  const cpu = attributeCpu(cpuProfiles(events), windows, { resolve, limit });
  const react = components
    ? attributeComponents(events, windows, { limit })
    : null;
  return cpu.map((entry, index) => ({
    ...entry,
    components: react === null ? null : react[index].components,
    componentRenders: react === null ? null : react[index].renders,
  }));
};

export const functionKey = (entry) => entry.name + " " + entry.location;

export const summarizeAttribution = (attributions, limit = 10) => ({
  waits: attributions.length,
  sampledMs:
    attributions.length === 0
      ? null
      : Math.round(
          (attributions.reduce((sum, entry) => sum + entry.sampledMs, 0) /
            attributions.length) *
            100,
        ) / 100,
  functions: mergeTop(
    attributions.map((entry) => entry.functions),
    functionKey,
    limit,
  ),
  modules: mergeTop(
    attributions.map((entry) => entry.modules),
    (entry) => entry.module,
    limit,
  ),
  components: attributions.some((entry) => entry.components !== null)
    ? mergeTop(
        attributions.map((entry) => entry.components ?? []),
        (entry) => entry.component,
        limit,
      )
    : null,
});

export const mergeTop = (lists, keyOf, limit = 10) => {
  const totals = new Map();
  for (const list of lists)
    for (const entry of list) {
      const id = keyOf(entry);
      const current = totals.get(id) ?? {
        ...entry,
        selfMs: 0,
        windows: 0,
        ...(typeof entry.renders === "number" ? { renders: 0 } : {}),
      };
      current.selfMs += entry.selfMs;
      current.windows += 1;
      if (typeof entry.renders === "number") current.renders += entry.renders;
      totals.set(id, current);
    }
  const count = Math.max(lists.length, 1);
  return [...totals.values()]
    .map((entry) => ({
      ...entry,
      selfMs: Math.round((entry.selfMs / count) * 100) / 100,
    }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, limit);
};
