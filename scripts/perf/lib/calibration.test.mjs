import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BENCHMARK_SOURCE,
  deviation,
  fieldDeviceScore,
  mainThreadBenchmarkExpression,
  recommendThrottle,
  refineRate,
  withinTolerance,
} from "./calibration.mjs";

const FIELD_FUNCTION =
  "function bbBenchmarkIndex() { const start = performance.now(); let iterations = 0; while (performance.now() - start < 300) { const values = []; for (let i = 0; i < 50000; i++) values.push((i * 7919) % 10007); values.sort((a, b) => a - b); iterations++; } return Math.round((iterations * 1000) / (performance.now() - start)); }";

describe("calibration", () => {
  it("runs the field plugin's benchmark verbatim", () => {
    assert.equal(BENCHMARK_SOURCE, FIELD_FUNCTION);
    const scores = new Function("return " + mainThreadBenchmarkExpression(1))();
    assert.equal(scores.length, 1);
    assert.ok(Number.isInteger(scores[0]) && scores[0] > 0);
  });

  it("recommends lab score over device score and never speeds the lab up", () => {
    assert.deepEqual(recommendThrottle(120, 30), {
      factor: 4,
      raw: 4,
      deviceFasterThanLab: false,
    });
    assert.deepEqual(recommendThrottle(100, 300), {
      factor: 1,
      raw: 0.333,
      deviceFasterThanLab: true,
    });
  });

  it("accepts a throttled score within ten percent of the target", () => {
    assert.equal(withinTolerance(27.5, 30), true);
    assert.equal(withinTolerance(26, 30), false);
    assert.equal(Math.round(deviation(33, 30) * 100), 10);
  });

  it("corrects the rate in proportion to the miss", () => {
    assert.equal(refineRate(4, 40, 30), 5.33);
    assert.equal(refineRate(2, 10, 30), 1);
  });

  it("takes the median benchmarkIndex from any depth of the field report", () => {
    const report = [
      { kind: "switch", sessions: [{ client: { benchmarkIndex: 40 } }] },
      { client: { benchmarkIndex: 20 } },
      { client: { benchmarkIndex: 30 } },
      { client: { benchmarkIndex: null } },
    ];
    assert.deepEqual(fieldDeviceScore(report), { score: 30, sessions: 3 });
    assert.deepEqual(fieldDeviceScore([{ kind: "open", p50: 3 }]), {
      score: null,
      sessions: 0,
    });
  });
});
