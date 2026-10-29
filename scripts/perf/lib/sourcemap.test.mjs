import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkLabel,
  decodeMappings,
  originalPosition,
  sourceLabel,
  sourceResolver,
} from "./sourcemap.mjs";

describe("sourcemap", () => {
  it("decodes VLQ segments with source columns carried across lines", () => {
    const decoded = decodeMappings("AAAA,SAAS;AACA;;");
    assert.deepEqual(decoded[0], [
      [0, 0, 0, 0],
      [9, 0, 0, 9],
    ]);
    assert.deepEqual(decoded[1], [[0, 0, 1, 9]]);
    assert.deepEqual(decoded[2], []);
  });

  it("maps a column to the closest segment at or before it", () => {
    const decoded = decodeMappings("AAAA,SAAS,UCAU");
    assert.deepEqual(originalPosition(decoded, 0, 12), {
      sourceIndex: 0,
      line: 0,
      column: 9,
    });
    assert.deepEqual(originalPosition(decoded, 0, 19), {
      sourceIndex: 1,
      line: 0,
      column: 19,
    });
    assert.equal(originalPosition(decoded, 4, 0), null);
  });

  it("returns no position inside an unmapped segment", () => {
    const decoded = decodeMappings("AAAA,K");
    assert.deepEqual(originalPosition(decoded, 0, 3), {
      sourceIndex: 0,
      line: 0,
      column: 0,
    });
    assert.equal(originalPosition(decoded, 0, 10), null);
  });

  it("returns no position before the first segment of a line", () => {
    const decoded = decodeMappings("KAAA");
    assert.equal(originalPosition(decoded, 0, 0), null);
    assert.deepEqual(originalPosition(decoded, 0, 5), {
      sourceIndex: 0,
      line: 0,
      column: 0,
    });
  });

  it("labels sources by package or by repository path", () => {
    assert.equal(
      sourceLabel(
        "../../node_modules/.pnpm/react-dom@19.3.0/node_modules/react-dom/cjs/react-dom.js",
      ),
      "node_modules/react-dom",
    );
    assert.equal(
      sourceLabel("../../node_modules/@tanstack/query-core/build/query.js"),
      "node_modules/@tanstack/query-core",
    );
    assert.equal(
      sourceLabel("../../../../packages/core-ui/src/assert-never.ts"),
      "packages/core-ui/src/assert-never.ts",
    );
  });

  it("labels chunks by their path below the assets directory", () => {
    assert.equal(
      chunkLabel("http://127.0.0.1:38887/assets/index-5qUOi7dq.js"),
      "index-5qUOi7dq.js",
    );
    assert.equal(
      chunkLabel("http://127.0.0.1:38887/api/v1/plugin-app-assets/abc/app.js"),
      "api/v1/plugin-app-assets/abc/app.js",
    );
    assert.equal(chunkLabel(""), "(native)");
  });

  it("resolves only chunks that have a map", () => {
    const resolve = sourceResolver(
      new Map([
        ["a.js", { sources: ["src/a.ts"], decoded: decodeMappings("AAEA") }],
        ["b.js", null],
      ]),
    );
    assert.deepEqual(resolve("a.js", 0, 3), { source: "src/a.ts", line: 2 });
    assert.equal(resolve("b.js", 0, 0), null);
    assert.equal(resolve("c.js", 0, 0), null);
  });
});
