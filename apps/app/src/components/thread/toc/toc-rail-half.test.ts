import { describe, expect, it } from "vitest";
import { railHalfAt, railHalfTint } from "./toc-rail-half";

describe("railHalfAt", () => {
  const rect = { left: 100, width: 32 };

  it("maps the left half to messages and the right half to topics", () => {
    expect(railHalfAt(100, rect)).toBe("messages");
    expect(railHalfAt(115, rect)).toBe("messages");
    expect(railHalfAt(116, rect)).toBe("topics");
    expect(railHalfAt(131, rect)).toBe("topics");
  });

  it("tints the half under the pointer", () => {
    expect(railHalfTint("messages")).toContain("color-mix");
    expect(railHalfTint("messages")).not.toBe(railHalfTint("topics"));
  });
});
