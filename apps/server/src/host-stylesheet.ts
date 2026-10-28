import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostStylesheet } from "./services/plugins/app-bundle.js";

const ENTRY_STYLESHEET_PATTERN =
  /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\/assets\/(index-[\w-]+\.css)"/u;

export function loadHostStylesheet(staticDir: string): HostStylesheet | null {
  let html: string;
  try {
    html = readFileSync(join(staticDir, "index.html"), "utf8");
  } catch {
    return null;
  }
  const key = ENTRY_STYLESHEET_PATTERN.exec(html)?.[1];
  if (key === undefined) return null;
  try {
    return { key, css: readFileSync(join(staticDir, "assets", key), "utf8") };
  } catch {
    return null;
  }
}
