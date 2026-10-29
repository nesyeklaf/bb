import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map([...BASE64].map((char, index) => [char, index]));

const decodeSegment = (text) => {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64_VALUES.get(char);
    if (digit === undefined)
      throw new Error("invalid base64 VLQ character " + char);
    value += (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
};

export const decodeMappings = (mappings) => {
  const lines = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  for (const lineText of mappings.split(";")) {
    const segments = [];
    let generatedColumn = 0;
    if (lineText !== "")
      for (const segmentText of lineText.split(",")) {
        if (segmentText === "") continue;
        const values = decodeSegment(segmentText);
        generatedColumn += values[0];
        if (values.length < 4) continue;
        sourceIndex += values[1];
        sourceLine += values[2];
        sourceColumn += values[3];
        segments.push([generatedColumn, sourceIndex, sourceLine, sourceColumn]);
      }
    segments.sort((a, b) => a[0] - b[0]);
    lines.push(segments);
  }
  return lines;
};

export const originalPosition = (decoded, line, column) => {
  const segments = decoded[line];
  if (!segments || segments.length === 0) return null;
  let low = 0;
  let high = segments.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle][0] <= column) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  const segment = segments[found === -1 ? 0 : found];
  return { sourceIndex: segment[1], line: segment[2], column: segment[3] };
};

export const sourceLabel = (path) => {
  const clean = path
    .replace(/^(webpack|vite):\/\/\/?/, "")
    .replace(/\?.*$/, "");
  const marker = clean.lastIndexOf("node_modules/");
  if (marker !== -1) {
    const parts = clean.slice(marker + "node_modules/".length).split("/");
    return (
      "node_modules/" +
      (parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0])
    );
  }
  return clean.replace(/^(\.\.?\/)+/, "");
};

export const chunkLabel = (url) => {
  if (!url) return "(native)";
  try {
    return new URL(url).pathname.replace(/^\/(assets\/)?/, "") || url;
  } catch {
    return url;
  }
};

const readMap = async (url, directory) => {
  if (directory) {
    const local = join(directory, basename(chunkLabel(url)) + ".map");
    if (existsSync(local)) return JSON.parse(readFileSync(local, "utf8"));
  }
  if (!/^https?:/.test(url)) return null;
  const response = await fetch(url + ".map").catch(() => null);
  if (!response || !response.ok) return null;
  return response.json().catch(() => null);
};

export const loadSourceMaps = async (
  urls,
  { directory = null, cache = new Map() } = {},
) => {
  const maps = cache;
  for (const url of new Set(urls)) {
    if (!url || maps.has(url)) continue;
    const raw = await readMap(url, directory);
    if (raw === null || typeof raw.mappings !== "string") {
      maps.set(url, null);
      continue;
    }
    maps.set(url, {
      sources: raw.sources.map(sourceLabel),
      decoded: decodeMappings(raw.mappings),
    });
  }
  return maps;
};

export const sourceResolver = (maps) => (url, line, column) => {
  const map = maps.get(url);
  if (!map) return null;
  const position = originalPosition(map.decoded, line, column);
  if (position === null) return null;
  const source = map.sources[position.sourceIndex];
  return source === undefined ? null : { source, line: position.line };
};
