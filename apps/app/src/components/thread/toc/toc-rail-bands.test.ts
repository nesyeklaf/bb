import { describe, expect, it } from "vitest";
import { pickBandAtTick } from "./toc-rail-bands";

describe("pickBandAtTick", () => {
  const ranges = [
    { start: 0, end: 1 },
    { start: 5, end: 6 },
    { start: 0, end: 9 },
  ];
  it("returns null without bands", () => {
    expect(pickBandAtTick([], 3)).toBeNull();
  });
  it("takes the band covering the tick, narrower first", () => {
    expect(pickBandAtTick(ranges, 1)).toBe(0);
    expect(pickBandAtTick(ranges, 6)).toBe(1);
  });
  it("takes the nearest band between two", () => {
    expect(pickBandAtTick(ranges.slice(0, 2), 2)).toBe(0);
    expect(pickBandAtTick(ranges.slice(0, 2), 4)).toBe(1);
  });
});
