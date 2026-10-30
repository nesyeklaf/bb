import fs from "node:fs/promises";
import type { ProcFs } from "./sampler.js";

export const nodeProcFs: ProcFs = {
  readdir: (path) => fs.readdir(path),
  readFile: (path) => fs.readFile(path, "utf8"),
  readlink: (path) => fs.readlink(path),
};
