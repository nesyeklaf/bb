import { describe, expect, it } from "vitest";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  PATHS_EXIST_MAX_PATHS,
  hostAuthStateSchema,
  hostPlatformSchema,
  pathsExistRequestSchema,
  pathsExistResponseSchema,
  providerCliStatusResponseSchema,
  statusResponseSchema,
} from "../src/index.js";

describe("hostAuthStateSchema", () => {
  it("persists host identity without a host type", () => {
    expect(
      hostAuthStateSchema.parse({
        hostId: "host_modal",
        hostKey: "secret",
      }),
    ).toEqual({
      hostId: "host_modal",
      hostKey: "secret",
    });
  });
});

describe("hostPlatformSchema", () => {
  it("accepts the supported platform values", () => {
    for (const value of [
      "darwin",
      "linux",
      "wsl",
      "win32",
      "unknown",
    ] as const) {
      expect(hostPlatformSchema.parse(value)).toBe(value);
    }
  });

  it("rejects other strings", () => {
    expect(() => hostPlatformSchema.parse("freebsd")).toThrow();
    expect(() => hostPlatformSchema.parse("")).toThrow();
  });
});

describe("statusResponseSchema", () => {
  it("requires platform", () => {
    expect(() =>
      statusResponseSchema.parse({
        hostId: "host_1",
        connected: true,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
      }),
    ).toThrow();
  });

  it("accepts a fully formed status", () => {
    expect(
      statusResponseSchema.parse({
        hostId: "host_1",
        connected: true,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: true,
        platform: "darwin",
      }),
    ).toMatchObject({ platform: "darwin" });
  });
});

describe("pathsExistRequestSchema", () => {
  it("dedupes repeated paths", () => {
    const result = pathsExistRequestSchema.parse({
      paths: ["/a", "/a", "/b"],
    });
    expect(result.paths).toEqual(["/a", "/b"]);
  });

  it("rejects empty path arrays", () => {
    expect(() => pathsExistRequestSchema.parse({ paths: [] })).toThrow();
  });

  it("rejects empty-string path entries", () => {
    expect(() => pathsExistRequestSchema.parse({ paths: [""] })).toThrow();
  });

  it("rejects oversized batches", () => {
    const oversized = Array.from(
      { length: PATHS_EXIST_MAX_PATHS + 1 },
      (_, i) => `/p${i}`,
    );
    expect(() => pathsExistRequestSchema.parse({ paths: oversized })).toThrow();
  });
});

describe("pathsExistResponseSchema", () => {
  it("requires existence to be a boolean record", () => {
    expect(
      pathsExistResponseSchema.parse({
        existence: { "/a": true, "/b": false },
      }),
    ).toEqual({ existence: { "/a": true, "/b": false } });
  });

  it("rejects non-boolean values", () => {
    expect(() =>
      pathsExistResponseSchema.parse({ existence: { "/a": "yes" } }),
    ).toThrow();
  });
});

describe("provider CLI schemas", () => {
  it("accepts status for provider CLIs", () => {
    expect(
      providerCliStatusResponseSchema.parse({
        codex: {
          displayName: "Codex",
          executableName: "codex",
          executablePath: null,
          installed: false,
          currentVersion: null,
          minimumSupportedVersion: "0.136.0",
          versionUnsupported: false,
        },
        "claude-code": {
          displayName: "Claude Code",
          executableName: "claude",
          executablePath: "/opt/homebrew/bin/claude",
          installed: true,
          currentVersion: "2.1.147",
          minimumSupportedVersion: null,
          versionUnsupported: false,
        },
        "acp-cursor": {
          displayName: "Cursor",
          executableName: "agent",
          executablePath: null,
          installed: false,
          currentVersion: null,
          minimumSupportedVersion: null,
          versionUnsupported: false,
        },
      })["claude-code"].installed,
    ).toBe(true);

    expect(
      providerCliStatusResponseSchema.parse({
        codex: {
          displayName: "Codex",
          executableName: "codex",
          executablePath: "/usr/local/bin/codex",
          installed: true,
          currentVersion: "0.133.0",
          minimumSupportedVersion: "0.136.0",
          versionUnsupported: true,
        },
        "claude-code": {
          displayName: "Claude Code",
          executableName: "claude",
          executablePath: null,
          installed: false,
          currentVersion: null,
          minimumSupportedVersion: null,
          versionUnsupported: false,
        },
        "acp-cursor": {
          displayName: "Cursor",
          executableName: "agent",
          executablePath: "/Users/me/.local/bin/agent",
          installed: true,
          currentVersion: null,
          minimumSupportedVersion: null,
          versionUnsupported: false,
        },
      })["codex"].versionUnsupported,
    ).toBe(true);
  });
});
