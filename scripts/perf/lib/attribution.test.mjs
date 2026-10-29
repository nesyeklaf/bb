import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_SAMPLE_WEIGHT_US,
  attributeComponents,
  attributeCpu,
  componentSelfTimes,
  cpuProfiles,
  labWindows,
  mergeTop,
} from "./attribution.mjs";

const mark = (ph, ts, local, pid = 1) => ({
  cat: "blink.user_timing",
  name: "lab:switch",
  ph,
  ts,
  pid,
  tid: 1,
  id2: { local },
});

const node = (id, functionName, url = "") => ({
  id,
  callFrame: { functionName, url, lineNumber: 0, columnNumber: id },
});

const profileEvents = (pid, samples, deltas) => [
  {
    name: "Profile",
    pid,
    tid: 1,
    id: "0x1",
    ts: 0,
    args: { data: { startTime: 1000 } },
  },
  {
    name: "ProfileChunk",
    pid,
    tid: 9,
    id: "0x1",
    ts: 0,
    args: {
      data: {
        cpuProfile: {
          nodes: [
            node(1, "(root)"),
            node(2, "(idle)"),
            node(3, "render", "http://x/assets/app.js"),
            node(4, "(garbage collector)"),
          ],
          samples,
        },
        timeDeltas: deltas,
      },
    },
  },
];

const component = (pid, message, start, end) => ({
  name: "TimeStamp",
  pid,
  args: { data: { track: "Components ⚛", message, start, end } },
});

describe("attribution", () => {
  it("pairs lab window marks by id and process", () => {
    const windows = labWindows([
      mark("b", 100, "0x1"),
      mark("b", 150, "0x1", 2),
      mark("e", 300, "0x1"),
      mark("e", 400, "0x1", 2),
    ]);
    assert.deepEqual(
      windows.map((entry) => [entry.pid, entry.start, entry.end]),
      [
        [1, 100, 300],
        [2, 150, 400],
      ],
    );
  });

  it("weights each sample by the gap to the next one, capped", () => {
    const [profile] = cpuProfiles(
      profileEvents(1, [3, 3, 4], [10, 200, 50_000]),
    );
    assert.deepEqual(
      profile.samples.map((sample) => [sample.ts, sample.weight]),
      [
        [1010, 200],
        [1210, MAX_SAMPLE_WEIGHT_US],
        [51_210, 0],
      ],
    );
  });

  it("counts self time inside the window of the same process and skips idle", () => {
    const profiles = cpuProfiles([
      ...profileEvents(1, [3, 2, 4, 3], [0, 100, 100, 100]),
      ...profileEvents(2, [3, 3], [0, 100]),
    ]);
    const [result] = attributeCpu(
      profiles,
      [{ name: "lab:switch", pid: 1, start: 1000, end: 1300 }],
      {
        resolve: (url) =>
          url.endsWith("app.js") ? { source: "src/app.tsx", line: 4 } : null,
      },
    );
    assert.equal(result.sampledMs, 0.2);
    assert.deepEqual(result.functions, [
      { name: "render", location: "src/app.tsx:5", selfMs: 0.1 },
      { name: "(garbage collector)", location: "(native)", selfMs: 0.1 },
    ]);
    assert.deepEqual(result.modules, [
      { module: "src/app.tsx", selfMs: 0.1 },
      { module: "(v8)", selfMs: 0.1 },
    ]);
  });

  it("counts only the renderer main thread, not a worker in the same process", () => {
    const worker = profileEvents(1, [3, 3, 3, 3], [0, 100, 100, 100]).map(
      (event) => ({ ...event, id: "0x2", tid: 7 }),
    );
    const profiles = cpuProfiles([
      {
        ph: "M",
        name: "thread_name",
        pid: 1,
        tid: 1,
        args: { name: "CrRendererMain" },
      },
      {
        ph: "M",
        name: "thread_name",
        pid: 1,
        tid: 7,
        args: { name: "DedicatedWorker thread" },
      },
      ...profileEvents(1, [3, 3, 3, 3], [0, 100, 100, 100]),
      ...worker,
    ]);
    const [result] = attributeCpu(profiles, [
      { name: "lab:switch", pid: 1, start: 1000, end: 1300 },
    ]);
    assert.equal(result.sampledMs, 0.3);
  });

  it("charges only the part of a sample that overlaps the window", () => {
    const profile = {
      pid: 1,
      tid: 1,
      nodes: new Map([[3, node(3, "render", "http://x/assets/app.js")]]),
      samples: [{ ts: 900, nodeId: 3, weight: 10_000 }],
    };
    const [result] = attributeCpu(
      [profile],
      [{ name: "lab:switch", pid: 1, start: 0, end: 1000 }],
    );
    assert.equal(result.sampledMs, 0.1);
    const [straddling] = attributeCpu(
      [profile],
      [{ name: "lab:switch", pid: 1, start: 1000, end: 3000 }],
    );
    assert.equal(straddling.sampledMs, 2);
  });

  it("subtracts nested component renders from their parent", () => {
    const entries = componentSelfTimes([
      { pid: 1, name: "App", start: 0, end: 100 },
      { pid: 1, name: "List", start: 10, end: 60 },
      { pid: 1, name: "Row", start: 20, end: 30 },
      { pid: 1, name: "Row", start: 30, end: 50 },
      { pid: 1, name: "Footer", start: 70, end: 90 },
    ]);
    assert.deepEqual(
      Object.fromEntries(
        entries.map((entry) => [entry.name + entry.start, entry.selfUs]),
      ),
      { App0: 30, List10: 20, Row20: 10, Row30: 20, Footer70: 20 },
    );
  });

  it("sums component self time per window by render start", () => {
    const [result] = attributeComponents(
      [
        component(1, "App", 1000, 4000),
        component(1, "Row", 2000, 3000),
        component(1, "Row", 9000, 9500),
      ],
      [{ name: "lab:switch", pid: 1, start: 0, end: 5000 }],
    );
    assert.equal(result.renders, 2);
    assert.deepEqual(result.components, [
      { component: "App", renders: 1, selfMs: 2 },
      { component: "Row", renders: 1, selfMs: 1 },
    ]);
  });

  it("averages merged entries over every wait, counting absence as zero", () => {
    const merged = mergeTop(
      [
        [{ module: "a", selfMs: 4 }],
        [
          { module: "a", selfMs: 2 },
          { module: "b", selfMs: 6 },
        ],
      ],
      (entry) => entry.module,
    );
    assert.deepEqual(merged, [
      { module: "a", selfMs: 3, windows: 2 },
      { module: "b", selfMs: 3, windows: 1 },
    ]);
  });
});
