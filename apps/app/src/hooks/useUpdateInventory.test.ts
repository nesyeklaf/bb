import { describe, expect, it } from "vitest";
import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { makePluginListItem } from "@/test/fixtures/plugins";
import {
  buildUpdateInventoryPlugins,
  buildUpdateInventoryProviderIssues,
  updateInventoryHosts,
} from "./useUpdateInventory";

function providerStatus(
  displayName: string,
  overrides: Partial<ProviderCliStatus> = {},
): ProviderCliStatus {
  return {
    displayName,
    executableName: displayName.toLowerCase(),
    executablePath: `/usr/local/bin/${displayName.toLowerCase()}`,
    installed: true,
    installSource: "npmGlobal",
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: null,
    needsUpdate: false,
    versionUnsupported: false,
    ...overrides,
  };
}

describe("buildUpdateInventoryProviderIssues", () => {
  it("includes Cursor updates in the machine inventory", () => {
    const status: ProviderCliStatusResponse = {
      codex: providerStatus("Codex"),
      "claude-code": providerStatus("Claude Code"),
      "acp-cursor": providerStatus("Cursor", {
        latestVersion: "1.1.0",
        needsUpdate: true,
      }),
    };

    expect(buildUpdateInventoryProviderIssues(status)).toMatchObject([
      {
        provider: "acp-cursor",
        title: "Cursor update available",
      },
    ]);
  });
});

describe("buildUpdateInventoryPlugins", () => {
  it("lists tracking plugins with compatible or blocked candidates only", () => {
    const tracking = makePluginListItem({
      id: "notes",
      name: "Notes",
      source: "npm:@acme/notes@^1.0.0",
      updateState: {
        outcome: "update-available",
        availableVersion: "1.2.0",
        availableLabel: "1.2.0",
      },
    });
    const blocked = makePluginListItem({
      id: "linear",
      name: "Linear",
      source: "git:github.com/acme/linear@^0.8.0",
      updateState: {
        outcome: "incompatible",
        blockedVersion: "0.9.0",
        blockedLabel: "0.9.0",
        blockedReasons: ["engines.bb requires >=2.0.0"],
      },
    });
    const current = makePluginListItem({
      id: "current",
      source: "npm:@acme/current@^1.0.0",
      updateState: { outcome: "current" },
    });
    const pinned = makePluginListItem({
      id: "pinned",
      source: "npm:@acme/pinned@1.0.0",
      updateState: {
        outcome: "pinned",
        blockedVersion: "2.0.0",
        blockedLabel: "2.0.0",
      },
    });
    const path = makePluginListItem({
      id: "local",
      source: "path:/plugins/local",
      updateState: { availableVersion: "9.9.9", availableLabel: "9.9.9" },
    });
    const builtin = makePluginListItem({
      id: "git",
      source: "builtin:git",
      provenance: "builtin",
      updateState: { availableVersion: "9.9.9", availableLabel: "9.9.9" },
    });

    expect(
      buildUpdateInventoryPlugins([
        tracking,
        blocked,
        current,
        pinned,
        path,
        builtin,
      ]),
    ).toEqual({
      trackedCount: 3,
      items: [
        {
          kind: "blocked",
          plugin: blocked,
          version: "0.9.0",
          reasons: ["engines.bb requires >=2.0.0"],
        },
        { kind: "update", plugin: tracking, version: "1.2.0" },
      ],
    });
  });

  it("offers the compatible update when a newer release is also blocked", () => {
    const plugin = makePluginListItem({
      source: "npm:@acme/notes@^1.0.0",
      updateState: {
        outcome: "update-available",
        availableVersion: "1.2.0",
        availableLabel: "1.2.0",
        blockedVersion: "1.3.0",
        blockedLabel: "1.3.0",
        blockedReasons: ["engines.bbPluginSdk requires ^3.0.0"],
      },
    });
    expect(buildUpdateInventoryPlugins([plugin]).items).toEqual([
      { kind: "update", plugin, version: "1.2.0" },
    ]);
  });
});

describe("updateInventoryHosts", () => {
  it("omits machines from ephemeral providers", () => {
    const modal = makeHost({
      id: "host_modal",
      type: "ephemeral",
      machineProviderId: "modal-sandbox",
    });
    const persistent = makeHost({
      id: "host_persistent",
      machineProviderId: "persistent-cloud",
    });
    const manual = makeHost({ id: "host_manual" });
    expect(updateInventoryHosts([modal, persistent, manual])).toEqual([
      persistent,
      manual,
    ]);
  });
});
