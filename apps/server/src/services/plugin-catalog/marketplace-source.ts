import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  normalizePluginSubdirectory,
  parsePluginSource,
  pluginRootDir,
  realPathInside,
  runInstallCommand,
} from "../plugins/install-sources.js";
import {
  parseMarketplaceManifest,
  type MarketplaceIconBase,
  type MarketplaceManifest,
} from "./marketplace-manifest.js";

const MARKETPLACE_MANIFEST_FILENAME = "marketplace.json";

type MarketplaceSource =
  | { kind: "git"; url: string; ref: string; subdirectory: string | null }
  | { kind: "path"; directory: string };

const GIT_CLONE_ARGS = ["-c", "core.hooksPath=/dev/null"] as const;

const SOURCE_FORMS = 'expected "git:<url>[@<ref>]" or "path:<directory>"';

function assertNoSubdirectory(
  source: string,
  subdirectory: string | null,
): void {
  if (subdirectory !== null) {
    throw new Error(
      `invalid marketplace source "${source}": a subdirectory applies to git: sources only`,
    );
  }
}

export function parseMarketplaceSource(
  raw: string,
  subdirectory: string | null,
): MarketplaceSource {
  const source = raw.trim();
  if (source.length === 0) {
    throw new Error(`invalid marketplace source: ${SOURCE_FORMS}`);
  }
  if (source.startsWith("path:")) {
    const directory = source.slice("path:".length);
    if (directory.length === 0) {
      throw new Error("marketplace source has an empty path");
    }
    assertNoSubdirectory(source, subdirectory);
    return { kind: "path", directory: resolve(directory) };
  }
  if (source.startsWith("git:")) {
    const parsed = parsePluginSource(source);
    if (parsed.kind !== "git") {
      throw new Error(`invalid marketplace git source "${source}"`);
    }
    if (parsed.selector.kind !== "ref") {
      throw new Error(
        `invalid marketplace git source "${source}": a marketplace ref names one branch, tag, or commit`,
      );
    }
    return {
      kind: "git",
      url: parsed.url,
      ref: parsed.selector.ref,
      subdirectory:
        subdirectory === null
          ? null
          : normalizePluginSubdirectory(
              subdirectory,
              "marketplace subdirectory",
            ),
    };
  }
  throw new Error(`invalid marketplace source "${source}": ${SOURCE_FORMS}`);
}

export function marketplaceSourceDisplay(source: MarketplaceSource): string {
  if (source.kind === "path") return `path:${source.directory}`;
  return `git:${source.url}@${source.ref}`;
}

export function marketplaceSourceFromRow(row: {
  sourceKind: string;
  manifestUrl: string;
  sourceGitRef: string | null;
  sourceGitSubdirectory: string | null;
}): MarketplaceSource {
  if (row.sourceKind === "path") {
    return { kind: "path", directory: row.manifestUrl };
  }
  if (row.sourceKind !== "git") {
    throw new Error(`unsupported marketplace source kind "${row.sourceKind}"`);
  }
  if (row.sourceGitRef === null) {
    throw new Error("git marketplace row has no ref");
  }
  return {
    kind: "git",
    url: row.manifestUrl,
    ref: row.sourceGitRef,
    subdirectory: row.sourceGitSubdirectory,
  };
}

export function marketplaceSourceColumns(source: MarketplaceSource): {
  sourceKind: "git" | "path";
  manifestUrl: string;
  sourceGitRef: string | null;
  sourceGitSubdirectory: string | null;
} {
  if (source.kind === "path") {
    return {
      sourceKind: "path",
      manifestUrl: source.directory,
      sourceGitRef: null,
      sourceGitSubdirectory: null,
    };
  }
  return {
    sourceKind: "git",
    manifestUrl: source.url,
    sourceGitRef: source.ref,
    sourceGitSubdirectory: source.subdirectory,
  };
}

interface MaterializedMarketplace {
  catalog: MarketplaceManifest;
  manifestJson: string;
  commit: string | null;
  iconBase: MarketplaceIconBase;
  dispose(): Promise<void>;
}

export async function materializeMarketplace(args: {
  source: MarketplaceSource;
  stagingDir: string;
  warn?: (message: string) => void;
}): Promise<MaterializedMarketplace> {
  if (args.source.kind === "path") {
    return materializeLocal(
      args.source.directory,
      null,
      async () => {},
      args.warn,
    );
  }
  return materializeGit(args.source, args.stagingDir, args.warn);
}

async function materializeLocal(
  root: string,
  commit: string | null,
  dispose: () => Promise<void>,
  warn: ((message: string) => void) | undefined,
): Promise<MaterializedMarketplace> {
  try {
    const isDirectory = await stat(root)
      .then((entry) => entry.isDirectory())
      .catch(() => false);
    if (!isDirectory) {
      throw new Error(`marketplace directory does not exist: ${root}`);
    }
    const manifestPath = await realPathInside(
      root,
      join(root, MARKETPLACE_MANIFEST_FILENAME),
      "marketplace manifest",
    );
    const raw = await readFile(manifestPath, "utf8");
    const catalog = parseMarketplaceManifest(
      JSON.parse(raw) as unknown,
      "marketplace manifest",
      warn,
    );
    const iconBase = { kind: "dir", root } as const;
    return {
      catalog,
      manifestJson: JSON.stringify(catalog),
      commit,
      iconBase,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

async function gitMarketplaceRoot(
  checkout: string,
  subdirectory: string | null,
): Promise<string> {
  if (subdirectory === null) return checkout;
  const directory = pluginRootDir(checkout, subdirectory);
  const isDirectory = await stat(directory)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
  if (!isDirectory) {
    throw new Error(
      `marketplace subdirectory "${subdirectory}" is not a directory in the repository`,
    );
  }
  return realPathInside(checkout, directory, "marketplace subdirectory");
}

async function materializeGit(
  source: Extract<MarketplaceSource, { kind: "git" }>,
  stagingDir: string,
  warn: ((message: string) => void) | undefined,
): Promise<MaterializedMarketplace> {
  await mkdir(stagingDir, { recursive: true });
  const checkout = join(stagingDir, randomUUID());
  const dispose = () => rm(checkout, { recursive: true, force: true });
  try {
    await runInstallCommand("git", [
      ...GIT_CLONE_ARGS,
      "clone",
      "--quiet",
      "--no-checkout",
      source.url,
      checkout,
    ]);
    const commit = await runInstallCommand("git", [
      "-C",
      checkout,
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${source.ref}^{commit}`,
    ]).catch(() =>
      runInstallCommand("git", [
        "-C",
        checkout,
        "rev-parse",
        "--verify",
        "--end-of-options",
        `refs/remotes/origin/${source.ref}^{commit}`,
      ]),
    );
    await runInstallCommand("git", [
      ...GIT_CLONE_ARGS,
      "-C",
      checkout,
      "checkout",
      "--quiet",
      "--detach",
      commit,
    ]);
    await rm(join(checkout, ".git"), { recursive: true, force: true });
    return await materializeLocal(
      await gitMarketplaceRoot(checkout, source.subdirectory),
      commit,
      dispose,
      warn,
    );
  } catch (error) {
    await dispose();
    throw error;
  }
}
