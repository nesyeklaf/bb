import { describe, expect, it } from "vitest";
import { bbDesktopInfoSchema } from "../src/info.js";

const baseInfo = {
  platform: "macos",
  version: "0.0.31",
} as const;

describe("bbDesktopInfoSchema", () => {
  it("accepts a shell payload", () => {
    expect(bbDesktopInfoSchema.safeParse(baseInfo).success).toBe(true);
  });

  it("accepts linux", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "linux",
      }).success,
    ).toBe(true);
  });

  it("rejects win32", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "win32",
      }).success,
    ).toBe(false);
  });
});
