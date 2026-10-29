import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachPacing,
  compareSmoothness,
  frameStats,
  loafSummary,
  tracePacing,
} from "./smoothness.mjs";

const reporter = (id, begin, end, state = "STATE_PRESENTED_ALL") => [
  {
    name: "PipelineReporter",
    ph: "b",
    pid: 1,
    id,
    ts: begin,
    args: { frame_reporter: { state } },
  },
  {
    name: "PipelineReporter",
    ph: "e",
    pid: 1,
    id,
    ts: end,
    args: { frame_reporter: { state } },
  },
];

const measure = (ph, ts, name = "lab:scroll:scroll-up") => ({
  cat: "blink.user_timing",
  name,
  ph,
  ts,
  pid: 1,
  id2: { local: "0x9" },
});

describe("smoothness", () => {
  it("counts vsync slots without a new frame as missed", () => {
    const stats = frameStats([0, 5, 10, 30, 35, 40], {
      start: 0,
      end: 40,
      budgetMs: 5,
    });
    assert.equal(stats.frames, 6);
    assert.equal(stats.slots, 8);
    assert.equal(stats.missedFrames, 3);
    assert.equal(stats.droppedPct, 37.5);
    assert.equal(stats.longestMs, 20);
    assert.equal(stats.p50Ms, 5);
  });

  it("ignores frames outside the window", () => {
    const stats = frameStats([-10, 2, 4, 50], { start: 0, end: 10 });
    assert.equal(stats.frames, 2);
    assert.equal(stats.longestMs, 2);
  });

  it("reports no intervals for fewer than two frames", () => {
    const stats = frameStats([3], { start: 0, end: 20, budgetMs: 10 });
    assert.equal(stats.p95Ms, null);
    assert.equal(stats.longestMs, null);
    assert.equal(stats.missedFrames, 1);
  });

  it("sums LoAF scripts by function and source position", () => {
    const script = (fn, duration, char = 10) => ({
      fn,
      invoker: "MessagePort.onmessage",
      type: "event-listener",
      source: "http://x/assets/vendor.js",
      char,
      duration,
      forcedStyleAndLayout: 1,
    });
    const summary = loafSummary([
      {
        duration: 80,
        blocking: 30,
        scripts: [script("work", 50), script("work", 10, 99)],
      },
      { duration: 60, blocking: 10, scripts: [script("work", 40)] },
    ]);
    assert.equal(summary.count, 2);
    assert.equal(summary.blockingMs, 40);
    assert.equal(summary.longestMs, 80);
    assert.deepEqual(
      summary.scripts.map((entry) => [
        entry.char,
        entry.count,
        entry.durationMs,
      ]),
      [
        [10, 2, 90],
        [99, 1, 10],
      ],
    );
  });

  it("reads presented frames inside each scroll window from the trace", () => {
    const events = [
      measure("b", 10_000),
      ...reporter("0x1", 9_000, 12_000),
      ...reporter("0x2", 12_000, 19_000),
      ...reporter("0x3", 19_000, 21_000, "STATE_DROPPED"),
      ...reporter("0x4", 20_000, 40_000),
      measure("e", 40_000),
    ];
    const [pacing] = tracePacing(events);
    assert.equal(pacing.name, "scroll-up");
    assert.equal(pacing.frames, 3);
    assert.equal(pacing.longestMs, 21);
    assert.equal(pacing.chromeDroppedFrames, 1);
  });

  it("attaches pacing only when every scrolled gesture has a window", () => {
    const results = [{ scrolled: true }, { scrolled: false }];
    assert.equal(attachPacing(results, [{ p95Ms: 1 }]), true);
    assert.deepEqual(results[0].presented, { p95Ms: 1 });
    assert.equal(attachPacing(results, []), false);
  });

  it("calls lower frame times smoother", () => {
    const run = (p95Ms) => ({
      presented: { p95Ms, p99Ms: p95Ms, longestMs: p95Ms, droppedPct: 1 },
      raf: { p95Ms, droppedPct: 1 },
      loaf: { blockingMs: 0 },
    });
    const [p95] = compareSmoothness(
      [20, 21, 22, 23].map(run),
      [10, 11, 12, 13].map(run),
    );
    assert.equal(p95.metric, "presented p95");
    assert.equal(p95.verdict, "b smoother");
  });
});
