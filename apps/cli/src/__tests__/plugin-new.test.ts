import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { RESERVED_BB_CLI_COMMANDS } from "@bb/domain/plugin-cli";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerPluginCommands,
  resolveNewPluginTarget,
} from "../commands/plugin.js";

describe("resolveNewPluginTarget", () => {
  it.each([
    ["hello", "bb-plugin-hello", "bb-plugin-hello"],
    ["bb-plugin-hello", "bb-plugin-hello", "bb-plugin-hello"],
    ["@acme/bb-plugin-hello", "@acme/bb-plugin-hello", "bb-plugin-hello"],
  ])("resolves %s", (name, expectedPackageName, expectedDirectoryName) => {
    expect(resolveNewPluginTarget(name)).toEqual({
      packageName: expectedPackageName,
      directoryName: expectedDirectoryName,
    });
  });

  it.each([
    "Hello",
    "bb-plugin-",
    "@acme/hello",
    "@acme/bb-plugin-Hello",
    "@acme/team/bb-plugin-hello",
  ])("rejects %s", (name) => {
    expect(resolveNewPluginTarget(name)).toBeNull();
  });

  it.each(RESERVED_BB_CLI_COMMANDS)("rejects reserved id %s", (id) => {
    expect(resolveNewPluginTarget(id)).toBeNull();
    expect(resolveNewPluginTarget(`bb-plugin-${id}`)).toBeNull();
    expect(resolveNewPluginTarget(`@acme/bb-plugin-${id}`)).toBeNull();
  });
});

describe.sequential("bb plugin new", () => {
  const originalCwd = process.cwd();
  let workDir: string;
  let npmMarker: string;
  let logged: string[];
  let warned: string[];

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-new-"));
    process.chdir(workDir);
    npmMarker = join(workDir, "npm-was-called");
    const binDir = join(workDir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(
      join(binDir, "npm"),
      `#!/bin/sh\ntouch "${npmMarker}"\nexit 1\n`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${binDir}${delimiter}${process.env.PATH ?? ""}`);
    logged = [];
    warned = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
      warned.push(String(line));
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(workDir, { recursive: true, force: true });
  });

  async function runPluginNew(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerPluginCommands(program, () => "http://localhost");
    await program.parseAsync(["node", "bb", "plugin", "new", ...args]);
  }

  it("scaffolds without running npm or contacting the registry", async () => {
    await runPluginNew(["offline"]);

    expect(logged).toContain("Created bb-plugin-offline/ (bb-plugin-offline).");
    expect(await stat(npmMarker).catch(() => null)).toBeNull();
    expect(warned).toEqual([]);
    expect(
      await stat(join(workDir, "bb-plugin-offline", "node_modules")).catch(
        () => null,
      ),
    ).toBeNull();
  });

  it("tells the author to run npm install and bb plugin install", async () => {
    await runPluginNew(["next-steps"]);

    expect(logged).toContain("  cd bb-plugin-next-steps");
    expect(logged).toContain("  npm install --include=dev");
    expect(logged).toContain("  bb plugin install .");
  });

  it("pins the scaffold to this bb's SDK version", async () => {
    await runPluginNew(["pinned"]);

    const manifest: { devDependencies: Record<string, string> } = JSON.parse(
      await readFile(join(workDir, "bb-plugin-pinned", "package.json"), "utf8"),
    );
    expect(manifest.devDependencies["@get-bb/plugin-sdk"]).toBe(
      PLUGIN_SDK_VERSION,
    );
  });
});
