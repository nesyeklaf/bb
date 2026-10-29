import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  abOrder,
  compareMedians,
  compareRounds,
  median,
  quantile,
} from "./ab-stats.mjs";

const repeat = (value, times) => Array.from({ length: times }, () => value);

describe("ab-stats", () => {
  it("balances the order of the variants over every four rounds", () => {
    const firsts = [0, 1, 2, 3].map((round) => abOrder(round)[0]);
    assert.equal(firsts.filter((variant) => variant === "a").length, 2);
    assert.deepEqual(abOrder(0), ["a", "b"]);
    assert.deepEqual(abOrder(1), ["b", "a"]);
  });

  it("takes medians and interpolated quantiles", () => {
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(quantile([0, 10], 0.25), 2.5);
  });

  it("reports a faster variant only when the whole interval is below zero", () => {
    const a = [300, 310, 320, 305, 315, 298, 312, 307];
    const faster = compareMedians(
      a,
      a.map((value) => value - 100),
    );
    assert.equal(faster.verdict, "b faster");
    assert.ok(faster.high < 0);
    const noisy = compareMedians(a, [290, 330, 300, 318, 296, 311, 322, 303]);
    assert.equal(noisy.verdict, "no difference");
    assert.ok(noisy.low < 0);
    assert.ok(noisy.high > 0);
  });

  it("gives no interval for too few samples", () => {
    assert.equal(compareMedians([1, 2], [3, 4]).delta, null);
  });

  it("resamples whole rounds so repeated actions in one browser are not independent", () => {
    const heads = [1200, 1200, 800, 1200, 1200, 1200, 800, 1200];
    const rounds = heads.map((head) => ({
      a: repeat(1000, 4),
      b: repeat(head, 4),
    }));
    const result = compareRounds(rounds);
    assert.equal(result.delta, 200);
    assert.ok(result.low <= 0);
    assert.notEqual(result.verdict, "b slower");
  });

  it("reports a slower variant when every round is slower", () => {
    const rounds = [0, 1, 2, 3, 4, 5].map((round) => ({
      a: [1000 + round, 1010 - round],
      b: [1100 + round, 1110 - round],
    }));
    const result = compareRounds(rounds);
    assert.equal(result.verdict, "b slower");
    assert.ok(result.low > 0);
  });

  it("needs three rounds with valid samples on each side", () => {
    const rounds = [
      { a: [1, 2, 3], b: [4, 5, 6] },
      { a: [1, 2, 3], b: [4, 5, 6] },
      { a: [1, 2, 3], b: [] },
    ];
    const result = compareRounds(rounds);
    assert.equal(result.delta, null);
    assert.equal(result.low, null);
    assert.equal(result.b, 5);
  });
});
