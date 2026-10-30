// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import { makeHost as makeHostFixture } from "@bb/test-helpers/domain-fixtures";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  type ProviderCliKey,
} from "@bb/host-daemon-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type {
  ProviderCliIssue,
  ProviderCliActionableIssue,
} from "@/components/provider-cli/provider-cli-install";
import { useProviderCliInstallRunner } from "@/components/provider-cli/provider-cli-install";
import {
  getProviderCliInstallSnapshot,
  resetProviderCliInstallStoreForTests,
} from "@/components/provider-cli/provider-cli-install-store";
import { appToast } from "@/components/ui/app-toast";
import { makePluginListItem } from "@/test/fixtures/plugins";
import { buildUpdateInventoryPlugins } from "@/hooks/useUpdateInventory";
import {
  useUpdateInventory,
  type UpdateInventory,
  type UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import {
  UpdateActionButton,
  UpdatesSettingsSection,
} from "./UpdatesSettingsSection";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/sdk", async () => {
  const { makeProviderInfo } = await import("@bb/test-helpers/domain-fixtures");
  const { makeSystemConfig } = await import("@/test/fixtures/system-config");
  return {
    sdk: {
      system: {
        config: vi.fn(async () =>
          makeSystemConfig({ primaryHostId: "host_primary" }),
        ),
      },
      providers: {
        list: vi.fn(async () => [
          makeProviderInfo({ id: "codex", displayName: "Codex" }),
          makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
          makeProviderInfo({ id: "acp-cursor", displayName: "Cursor" }),
        ]),
      },
    },
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock("@/hooks/useUpdateInventory", async (original) => ({
  ...(await original<typeof import("@/hooks/useUpdateInventory")>()),
  useUpdateInventory: vi.fn(),
}));

const hostDaemon = vi.hoisted(() => ({
  localDaemonHostId: null as string | null,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localDaemonHostId: hostDaemon.localDaemonHostId,
  }),
}));

const openUrlInExternalBrowserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/url-open-routing", () => ({
  openUrlInExternalBrowser: openUrlInExternalBrowserMock,
}));

const retryHostUpdateMutateMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/mutations/host-mutations", () => ({
  useRetryHostUpdate: () => ({
    isPending: false,
    mutate: retryHostUpdateMutateMock,
    variables: undefined,
  }),
}));

const startInstallMock = vi.fn();

const startPluginUpdateMock = vi.hoisted(() => vi.fn());
const pluginUpdateJobs = vi.hoisted(() => ({
  current: [] as import("@bb/server-contract").PluginUpdateJob[],
}));

vi.mock("@/hooks/queries/plugin-catalog-queries", () => ({
  usePluginUpdateCheck: () => ({ isFetching: false }),
}));

vi.mock("@/hooks/queries/plugin-update-job-queries", async (original) => ({
  ...(await original<
    typeof import("@/hooks/queries/plugin-update-job-queries")
  >()),
  startPluginUpdate: startPluginUpdateMock,
  usePluginUpdateJobs: () => ({ data: pluginUpdateJobs.current }),
}));

vi.mock("@/components/provider-cli/provider-cli-install", async (original) => {
  const actual =
    await original<
      typeof import("@/components/provider-cli/provider-cli-install")
    >();
  return {
    ...actual,
    useProviderCliInstallRunner: vi.fn(() => ({
      failuresByJobKey: new Map(),
      queuedJobKeys: new Set<string>(),
      runningJobKey: null,
      startInstall: startInstallMock,
    })),
  };
});

function makeHost(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return makeHostFixture({
    lastSeenAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });
}

function makeUpdateIssue(args: {
  provider: ProviderCliKey;
}): ProviderCliActionableIssue {
  const identity =
    args.provider === "codex"
      ? { displayName: "Codex", executableName: "codex" }
      : args.provider === "claude-code"
        ? { displayName: "Claude Code", executableName: "claude" }
        : { displayName: "Cursor", executableName: "agent" };
  const { displayName, executableName } = identity;
  const action = {
    kind: "update" as const,
    label: "Update" as const,
    command: `${executableName} update`,
  };
  return {
    provider: args.provider,
    status: {
      displayName,
      executableName,
      executablePath: `/usr/local/bin/${executableName}`,
      installed: true,
      installSource: "npmGlobal",
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      minimumSupportedVersion: null,
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: action,
      needsUpdate: true,
      versionUnsupported: false,
    },
    action,
    title: `${displayName} update available`,
    description: "1.0.0 -> 1.0.1",
    fingerprint: `${args.provider}:outdated`,
  };
}

function makeManualUpdateIssue(args: {
  provider: "codex" | "claude-code";
}): ProviderCliIssue {
  const issue = makeUpdateIssue(args);
  return {
    ...issue,
    action: null,
    status: {
      ...issue.status,
      installSource: "external",
      installAction: null,
    },
  };
}

function makeMachine(args: {
  host: Host;
  issues?: ProviderCliIssue[];
  isPrimary?: boolean;
  statusPending?: boolean;
  statusError?: boolean;
  canRetryDaemonUpdate?: boolean;
}): UpdateInventoryMachine {
  const issues = args.issues ?? [];
  const upToDate = (provider: ProviderCliKey) => {
    const issue = issues.find((entry) => entry.provider === provider);
    if (issue !== undefined) {
      return issue.status;
    }
    const base = makeUpdateIssue({ provider }).status;
    return {
      ...base,
      latestVersion: base.currentVersion,
      needsUpdate: false,
    };
  };
  const cursorIssue = issues.find((entry) => entry.provider === "acp-cursor");
  const cursorStatus =
    cursorIssue?.status ??
    ({
      ...makeUpdateIssue({ provider: "acp-cursor" }).status,
      installed: false,
      currentVersion: null,
      latestVersion: null,
      needsUpdate: false,
      installAction: null,
    } as const);
  return {
    host: args.host,
    isPrimary: args.isPrimary ?? false,
    providerStatus:
      args.host.status === "connected"
        ? {
            codex: upToDate("codex"),
            "claude-code": upToDate("claude-code"),
            "acp-cursor": cursorStatus,
          }
        : null,
    statusPending: args.statusPending ?? false,
    statusFetching: args.statusPending ?? false,
    statusError: args.statusError ?? false,
    issues,
    canRetryDaemonUpdate: args.canRetryDaemonUpdate ?? false,
  };
}

function makeInventory(overrides: Partial<UpdateInventory>): UpdateInventory {
  return {
    isLoading: false,
    machines: [
      makeMachine({
        host: makeHost({ id: "host_primary", name: "workstation" }),
        isPrimary: true,
      }),
    ],
    plugins: { trackedCount: 0, items: [] },
    pluginAttentionCount: 0,
    actionableCount: 0,
    hasAttention: false,
    lastCheckedAt: null,
    ...overrides,
  };
}

function renderSection(): void {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <UpdatesSettingsSection />
        </QueryClientProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const useUpdateInventoryMock = vi.mocked(useUpdateInventory);
const useProviderCliInstallRunnerMock = vi.mocked(useProviderCliInstallRunner);

function useWebApp(): void {
  useUpdateInventoryMock.mockReturnValue(makeInventory({}));
}

beforeEach(() => {
  hostDaemon.localDaemonHostId = null;
  pluginUpdateJobs.current = [];
  useProviderCliInstallRunnerMock.mockReturnValue({
    failuresByJobKey: new Map(),
    queuedJobKeys: new Set<string>(),
    runningJobKey: null,
    startInstall: startInstallMock,
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  resetProviderCliInstallStoreForTests();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("UpdatesSettingsSection", () => {
  it("places fleet-wide Update all beside the Provider CLIs heading", () => {
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: makeHost({ id: "host_1", name: "workstation" }),
            issues: [makeUpdateIssue({ provider: "codex" })],
          }),
          makeMachine({
            host: makeHost({ id: "host_2", name: "homelab" }),
            issues: [makeUpdateIssue({ provider: "claude-code" })],
          }),
        ],
      }),
    );

    renderSection();

    const bulkActions = screen.getByRole("toolbar", {
      name: "Bulk update actions",
    });
    const updateAll = bulkActions.querySelector(
      '[aria-label="Update all 2 CLI tools"]',
    );
    expect(updateAll).not.toBeNull();
    expect(updateAll?.className).toContain("bg-foreground");
    expect(updateAll?.className).toContain("text-background");
    expect(updateAll?.textContent).toBe("Update all");
    expect(updateAll?.firstElementChild?.getAttribute("data-icon")).toBe(
      "Download",
    );
    const fleetSection = screen
      .getByRole("heading", { name: "Provider CLIs" })
      .closest("section");
    const fleetHeader = fleetSection?.firstElementChild;
    const fleetBody = fleetSection?.children.item(1);
    const machineRows = document.querySelectorAll("[data-updates-machine]");
    expect(machineRows).toHaveLength(2);
    expect(fleetHeader?.contains(bulkActions)).toBe(true);
    for (const row of machineRows) {
      expect(fleetBody?.contains(row)).toBe(true);
      expect(row.contains(bulkActions)).toBe(false);
    }
    expect(screen.queryByRole("heading", { name: "workstation" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Machine updates" }),
    ).toBeNull();
  });

  it("does not claim up to date when the latest version is unknown", async () => {
    const machine = makeMachine({
      host: makeHost({ id: "host_1", name: "workstation" }),
      isPrimary: true,
    });
    const codex = machine.providerStatus!.codex;
    machine.providerStatus!.codex = { ...codex, latestVersion: null };
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({ lastCheckedAt: Date.now(), machines: [machine] }),
    );

    renderSection();

    expect(screen.getByText("Nothing to update on workstation.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show machines" }));
    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    const codexRow = document.querySelector('[data-provider-row="codex"]');
    expect(codexRow?.textContent).toContain("Latest unknown");
    expect(
      codexRow?.querySelector('[data-update-state="up-to-date"]'),
    ).toBeNull();
  });

  it("does not call an offline fleet all in sync", async () => {
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: makeHost({
              id: "host_1",
              name: "homelab",
              status: "disconnected",
            }),
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getByText("homelab is offline.")).toBeDefined();
    expect(screen.queryByText(/Nothing to update/)).toBeNull();
    expect(screen.queryByText(/all in sync/)).toBeNull();
    expect(document.querySelector("[data-updates-machine]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show machines" }));
    const row = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_1"]',
    );
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Offline")).toBeDefined();
    expect(
      within(row as HTMLElement).queryByRole("button", { name: "homelab" }),
    ).toBeNull();
  });

  it("lists only machines that need attention and folds the rest into the footer", () => {
    const stalledHost = makeHost({
      id: "host_3",
      name: "homelab",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: Date.now() - 3 * 60 * 1000,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: makeHost({ id: "host_1", name: "workstation" }),
          }),
          makeMachine({
            host: makeHost({
              id: "host_2",
              name: "studio-mac",
              status: "disconnected",
            }),
          }),
          makeMachine({
            host: stalledHost,
            canRetryDaemonUpdate: true,
          }),
        ],
      }),
    );

    renderSection();

    expect(document.querySelectorAll("[data-updates-machine]")).toHaveLength(1);
    expect(screen.getByText("homelab")).toBeDefined();
    expect(screen.queryByText("workstation")).toBeNull();
    expect(screen.queryByText("studio-mac")).toBeNull();
    expect(
      screen.getByText("2 other machines have nothing to update"),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^Failed · Retry on/ }),
    ).toBeDefined();

    const showAll = screen.getByRole("button", { name: "Show all" });
    expect(showAll.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(showAll);

    expect(
      [...document.querySelectorAll("[data-updates-machine]")].map((row) =>
        row.getAttribute("data-updates-machine"),
      ),
    ).toEqual(["host_3", "host_1", "host_2"]);
    expect(screen.getByText("Offline")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(document.querySelectorAll("[data-updates-machine]")).toHaveLength(1);
  });

  it("treats a recent daemon protocol mismatch as an automatic update", () => {
    const host = makeHost({
      id: "host_1",
      name: "homelab",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            canRetryDaemonUpdate: true,
          }),
        ],
      }),
    );

    renderSection();

    const row = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_1"]',
    );
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("homelab")).toBeDefined();
    expect(within(row as HTMLElement).getByText("Updating bb")).toBeDefined();
    expect(
      row?.querySelector('[data-update-state="in-progress"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.queryByText(/can't connect/i)).toBeNull();
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("explains and retries a daemon update that has stalled", () => {
    const host = makeHost({
      id: "host_1",
      name: "homelab",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: Date.now() - 3 * 60 * 1000,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            canRetryDaemonUpdate: true,
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getByText("homelab")).toBeDefined();
    expect(screen.queryByText("1 needs attention")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Failed · Retry on homelab now" }),
    ).toBeDefined();
    expect(screen.queryByText("1 machine needs attention")).toBeNull();
    expect(screen.queryByText(/daemon protocol/)).toBeNull();
    expect(
      document.querySelector('[data-updates-machine="host_1"]')?.innerHTML,
    ).not.toContain("bg-surface-destructive");
    expect(screen.queryByText(/^Up to date/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Update didn't finish").className).toContain(
      "text-destructive",
    );
    expect(
      screen.getAllByRole("button", { name: /^Failed · Retry on/ }),
    ).toHaveLength(1);

    expect(
      screen.queryByRole("button", { name: /Update all .* machines now/ }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Failed · Retry on homelab now",
      }),
    );
    expect(retryHostUpdateMutateMock).toHaveBeenCalledWith(
      host.id,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("names a machine running a newer bb than the server", () => {
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: makeHost({
              id: "host_1",
              name: "homelab",
              status: "disconnected",
              lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
            }),
            canRetryDaemonUpdate: false,
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getByText("Update this app to reconnect")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Update homelab now/ }),
    ).toBeNull();
  });

  it("sweeps every machine stalled on the same bb update", () => {
    const stalled = ["workstation", "studio-mac", "homelab"].map(
      (name, index) =>
        makeHost({
          id: `host_${index}`,
          name,
          status: "disconnected",
          lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
          updatedAt: Date.now() - 3 * 60 * 1000,
        }),
    );
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: stalled.map((host) =>
          makeMachine({ host, canRetryDaemonUpdate: true }),
        ),
      }),
    );

    renderSection();

    expect(screen.queryByText(/^Up to date/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Update all 3 machines now",
      }),
    );
    expect(retryHostUpdateMutateMock).toHaveBeenCalledTimes(3);
    for (const host of stalled) {
      expect(retryHostUpdateMutateMock).toHaveBeenCalledWith(host.id);
    }
    expect(
      screen.getByRole("button", {
        name: "Failed · Retry on studio-mac now",
      }),
    ).toBeDefined();
  });

  it("shows one line per machine and its installed CLIs when expanded", async () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    const codexIssue = makeUpdateIssue({ provider: "codex" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({ host, issues: [codexIssue], isPrimary: true }),
        ],
      }),
    );

    renderSection();

    const row = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_1"]',
    );
    if (row === null) throw new Error("expected the machine row");
    expect(screen.getAllByText("workstation")).toHaveLength(1);
    expect(row.querySelector('[data-icon="Laptop"]')).not.toBeNull();
    expect(
      [...row.querySelectorAll("[data-provider-avatar]")].map((avatar) =>
        avatar.getAttribute("data-provider-avatar"),
      ),
    ).toEqual(["codex"]);
    expect(row.querySelector("[data-updates-machine-detail]")).toBeNull();
    expect(screen.queryByText("Codex")).toBeNull();
    expect(screen.queryByText(/^Update available/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Update Codex on workstation/ }),
    ).toBeNull();

    const toggle = screen.getByRole("button", { name: "workstation" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const detail = row.querySelector<HTMLElement>(
      "[data-updates-machine-detail]",
    );
    if (detail === null) throw new Error("expected the expanded detail");
    expect(toggle.getAttribute("aria-controls")).toBe(detail.id);

    expect(
      [...detail.querySelectorAll("[data-provider-row]")].map((entry) =>
        entry.getAttribute("data-provider-row"),
      ),
    ).toEqual(["codex", "claude-code"]);
    expect(within(detail).queryByText("Cursor")).toBeNull();
    const claudeRow = detail.querySelector('[data-provider-row="claude-code"]');
    expect(
      claudeRow?.querySelector('[data-update-state="up-to-date"]'),
    ).not.toBeNull();
    expect(claudeRow?.querySelector("[data-provider-updater]")).toBeNull();
    const codexRow = detail.querySelector('[data-provider-row="codex"]');
    expect(
      codexRow?.querySelector("[data-provider-updater]")?.textContent,
    ).toBe("Built-in updater");
    await waitFor(() => {
      expect(
        codexRow?.querySelector(
          '[data-provider-icon="codex"] [data-provider-logo]',
        ),
      ).not.toBeNull();
    });
    const versionMetadata = codexRow?.querySelector("[data-version-metadata]");
    expect(versionMetadata?.className).toContain("text-2xs");
    expect(versionMetadata?.className).not.toContain("font-mono");
    const upgrade = versionMetadata?.querySelector(".text-version-upgrade");
    expect(upgrade?.textContent).toBe("1.0.1");
    expect(upgrade?.className).toContain("font-semibold");
    expect(
      claudeRow?.querySelector("[data-version-metadata]")?.textContent,
    ).toBe("1.0.0");

    fireEvent.click(screen.getByRole("button", { name: "Update workstation" }));
    expect(startInstallMock).toHaveBeenCalledTimes(1);
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_1",
      issue: codexIssue,
    });

    fireEvent.click(toggle);
    expect(row.querySelector("[data-updates-machine-detail]")).toBeNull();
  });

  it("names the updater from the command the machine reports", () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    const withCommand = (
      provider: "codex" | "claude-code",
      command: string,
    ): ProviderCliActionableIssue => {
      const issue = makeUpdateIssue({ provider });
      const action = { ...issue.action, command };
      return {
        ...issue,
        action,
        status: { ...issue.status, installAction: action },
      };
    };
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            issues: [
              withCommand("codex", "mise upgrade npm:@openai/codex"),
              withCommand(
                "claude-code",
                "/opt/homebrew/bin/brew upgrade claude-code",
              ),
            ],
          }),
        ],
      }),
    );

    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "workstation" }));

    expect(
      [...document.querySelectorAll("[data-provider-updater]")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["mise", "Homebrew"]);
  });

  it("badges the client-local daemon independently from the server machine", async () => {
    const primary = makeHost({ id: "host_primary", name: "workstation" });
    const local = makeHost({ id: "host_local", name: "studio-mac" });
    hostDaemon.localDaemonHostId = local.id;
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: primary,
            issues: [makeUpdateIssue({ provider: "codex" })],
            isPrimary: true,
          }),
          makeMachine({
            host: local,
            issues: [makeUpdateIssue({ provider: "claudeCode" })],
          }),
        ],
      }),
    );

    renderSection();

    const primaryHeading = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_primary"]',
    )!;
    const localHeading = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_local"]',
    )!;
    await waitFor(() => {
      expect(
        within(primaryHeading)
          .getByText("Server")
          .hasAttribute("data-machine-tag"),
      ).toBe(true);
    });
    expect(primaryHeading.textContent).not.toContain("This machine");
    expect(localHeading.textContent).toContain("This machine");
    expect(within(localHeading).queryByText("Server")).toBeNull();
  });

  it("badges a lone server machine without marking it as this machine", async () => {
    const primary = makeHost({ id: "host_primary", name: "workstation" });
    hostDaemon.localDaemonHostId = primary.id;
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: primary,
            issues: [makeUpdateIssue({ provider: "codex" })],
            isPrimary: true,
          }),
        ],
      }),
    );

    renderSection();

    const primaryHeading = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_primary"]',
    )!;
    await waitFor(() => {
      expect(
        within(primaryHeading)
          .getByText("Server")
          .hasAttribute("data-machine-tag"),
      ).toBe(true);
    });
    expect(primaryHeading.textContent).not.toContain("This machine");
  });

  it("lists Cursor updates with the other provider CLIs", async () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    const cursorIssue = makeUpdateIssue({ provider: "acp-cursor" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [cursorIssue] })],
      }),
    );

    renderSection();

    expect(
      document.querySelector('[data-provider-avatar="acp-cursor"]'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(
      document.querySelector('[data-provider-row="acp-cursor"]')?.textContent,
    ).toContain("Cursor");
    fireEvent.click(screen.getByRole("button", { name: "Update workstation" }));
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_1",
      issue: cursorIssue,
    });
  });

  it("piles every outdated CLI onto its machine's single line", () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            issues: [
              makeUpdateIssue({ provider: "codex" }),
              makeUpdateIssue({ provider: "claude-code" }),
            ],
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getAllByText("workstation")).toHaveLength(1);
    const row = document.querySelector('[data-updates-machine="host_1"]');
    expect(
      [...(row?.querySelectorAll("[data-provider-avatar]") ?? [])].map(
        (avatar) => avatar.getAttribute("data-provider-avatar"),
      ),
    ).toEqual(["codex", "claude-code"]);
    expect(row?.querySelector("[data-provider-manual]")).toBeNull();
    expect(row?.querySelector("[data-provider-activity]")).toBeNull();
    fireEvent.click(
      row?.querySelector('[data-provider-avatar="codex"]') as HTMLElement,
    );
    expect(
      row?.querySelectorAll("[data-provider-row] [data-version-metadata]")
        .length,
    ).toBe(2);
  });

  it("shows one quiet line while provider checks are still running", async () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, statusPending: true })],
      }),
    );

    renderSection();

    const summary = document.querySelector("[data-updates-summary]");
    expect(summary?.textContent).toBe("Checking for updates…");
    expect(summary?.querySelector('[data-icon="Loading"]')).not.toBeNull();
    expect(screen.queryByText(/Nothing to update/)).toBeNull();
    expect(document.querySelector("[data-updates-machine]")).toBeNull();
  });

  it("ignores repeat Retry clicks while the retry is running", () => {
    const onClick = vi.fn();
    render(
      <TooltipProvider>
        <UpdateActionButton
          label="Retry on homelab now"
          icon="RotateCcw"
          loading
          onClick={onClick}
        />
      </TooltipProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Retry on homelab now" }),
    );

    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps error red on the reason and off the recovery", () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, statusError: true })],
      }),
    );

    renderSection();

    expect(screen.getByText("Couldn't check for updates").className).toContain(
      "text-destructive",
    );
    const retry = screen.getByRole("button", {
      name: /Check workstation's CLIs again/,
    });
    expect(retry.className).not.toContain("text-destructive");
    expect(retry.hasAttribute("disabled")).toBe(false);
  });

  it("leaves never-installed CLIs off an update page", () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    const missingCodex = makeUpdateIssue({ provider: "codex" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            issues: [
              {
                ...missingCodex,
                status: {
                  ...missingCodex.status,
                  installed: false,
                  currentVersion: null,
                },
              },
              makeUpdateIssue({ provider: "claude-code" }),
            ],
          }),
        ],
      }),
    );

    renderSection();

    expect(
      [...document.querySelectorAll("[data-provider-avatar]")].map((avatar) =>
        avatar.getAttribute("data-provider-avatar"),
      ),
    ).toEqual(["claude-code"]);
    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(screen.getByText("Claude Code")).toBeDefined();
    expect(screen.queryByText("Codex")).toBeNull();
  });

  it("swaps Update all for progress while every job is running or queued", () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    const codexIssue = makeUpdateIssue({ provider: "codex" });
    const claudeIssue = makeUpdateIssue({ provider: "claude-code" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [codexIssue, claudeIssue] })],
      }),
    );
    useProviderCliInstallRunnerMock.mockReturnValue({
      failuresByJobKey: new Map(),
      queuedJobKeys: new Set(["host_1:claude-code"]),
      runningJobKey: "host_1:codex",
      startInstall: startInstallMock,
    });

    renderSection();

    expect(screen.queryByRole("button", { name: /Update all/ })).toBeNull();
    expect(document.querySelector("[data-updates-progress]")?.textContent).toBe(
      "Updating 1 of 2",
    );
    expect(
      document
        .querySelector('[data-provider-avatar="codex"]')
        ?.getAttribute("data-provider-activity"),
    ).toBe("running");
    expect(
      document
        .querySelector('[data-provider-avatar="claude-code"]')
        ?.getAttribute("data-provider-activity"),
    ).toBe("queued");

    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(
      document.querySelectorAll(
        '[data-updates-machine="host_1"] [data-provider-row] [data-update-state="in-progress"]',
      ).length,
    ).toBe(2);
    expect(
      screen.queryByRole("button", { name: "Update workstation" }),
    ).toBeNull();
  });

  it("counts progress through an Update all batch", () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            issues: [
              makeUpdateIssue({ provider: "codex" }),
              makeUpdateIssue({ provider: "claude-code" }),
              makeUpdateIssue({ provider: "acp-cursor" }),
            ],
          }),
        ],
      }),
    );
    const runner = (runningJobKey: string | null, queued: string[]) => ({
      failuresByJobKey: new Map(),
      queuedJobKeys: new Set(queued),
      runningJobKey,
      startInstall: startInstallMock,
    });
    const queryClient = new QueryClient();
    const tree = () => (
      <MemoryRouter>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <UpdatesSettingsSection />
          </QueryClientProvider>
        </TooltipProvider>
      </MemoryRouter>
    );
    const progress = () =>
      document.querySelector("[data-updates-progress]")?.textContent ?? null;

    useProviderCliInstallRunnerMock.mockReturnValue(
      runner("host_1:codex", ["host_1:claude-code", "host_1:acp-cursor"]),
    );
    const view = render(tree());
    expect(progress()).toBe("Updating 1 of 3");

    useProviderCliInstallRunnerMock.mockReturnValue(
      runner("host_1:claude-code", ["host_1:acp-cursor"]),
    );
    view.rerender(tree());
    expect(progress()).toBe("Updating 2 of 3");

    useProviderCliInstallRunnerMock.mockReturnValue(
      runner("host_1:acp-cursor", []),
    );
    view.rerender(tree());
    expect(progress()).toBe("Updating 3 of 3");

    useProviderCliInstallRunnerMock.mockReturnValue(runner(null, []));
    view.rerender(tree());
    expect(progress()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Update all 3 CLI tools" }),
    ).toBeDefined();
  });

  it("keeps a provider update failure and its command log on the machine", () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    const issue = makeUpdateIssue({ provider: "claude-code" });
    const logDialogState = {
      displayName: "Claude Code",
      log: "$ claude update\npermission denied\n",
      message: "Command exited with code 1",
      title: "Claude Code update log",
    };
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [issue] })],
      }),
    );
    useProviderCliInstallRunnerMock.mockReturnValue({
      failuresByJobKey: new Map([
        [
          "host_1:claude-code",
          {
            issueFingerprint: issue.fingerprint,
            kind: "interrupted",
            logDialogState,
          },
        ],
      ]),
      queuedJobKeys: new Set(),
      runningJobKey: null,
      startInstall: startInstallMock,
    });

    renderSection();

    expect(screen.getByText("Claude Code failed").className).toContain(
      "text-destructive",
    );
    expect(
      document
        .querySelector('[data-provider-avatar="claude-code"]')
        ?.getAttribute("data-provider-activity"),
    ).toBe("failed");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Failed · Retry failed updates on workstation",
      }),
    );
    expect(startInstallMock).toHaveBeenCalledWith({ hostId: "host_1", issue });

    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(
      screen.getByText("Connection lost during update").className,
    ).toContain("sr-only");
    expect(screen.queryByText("Command exited with code 1")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Failed · Retry Claude Code on workstation",
      }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "View Claude Code update log" }),
    );
    expect(getProviderCliInstallSnapshot().logDialogState).toEqual(
      logDialogState,
    );
  });

  it("runs every actionable provider update across machines from Update all", async () => {
    const laptop = makeHost({ id: "host_1", name: "laptop" });
    const homelab = makeHost({ id: "host_2", name: "homelab" });
    const laptopIssue = makeUpdateIssue({ provider: "codex" });
    const homelabIssue = makeUpdateIssue({ provider: "claude-code" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({ host: laptop, issues: [laptopIssue] }),
          makeMachine({ host: homelab, issues: [homelabIssue] }),
        ],
        actionableCount: 2,
        hasAttention: true,
      }),
    );

    renderSection();
    expect(useProviderCliInstallRunnerMock).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "laptop" })).toBeDefined();
    expect(screen.getByRole("button", { name: "homelab" })).toBeDefined();
    const updateAll = screen.getByRole("button", {
      name: "Update all 2 CLI tools",
    });
    expect(updateAll.textContent).toBe("Update all");
    expect(updateAll.firstElementChild?.getAttribute("data-icon")).toBe(
      "Download",
    );

    fireEvent.click(updateAll);
    expect(startInstallMock).toHaveBeenCalledTimes(2);
    expect(startInstallMock).toHaveBeenNthCalledWith(1, {
      hostId: "host_1",
      issue: laptopIssue,
    });
    expect(startInstallMock).toHaveBeenNthCalledWith(2, {
      hostId: "host_2",
      issue: homelabIssue,
    });
  });

  it("updates tracking plugins from the Plugins section and leaves blocked ones alone", async () => {
    useWebApp();
    startPluginUpdateMock.mockImplementation(async (pluginId: string) => ({
      id: `job_${pluginId}`,
      pluginId,
      displayName: pluginId,
      state: "queued",
    }));
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        plugins: buildUpdateInventoryPlugins([
          makePluginListItem({
            id: "notes",
            name: "Notes",
            source: "npm:@acme/notes@^1.0.0",
            version: "1.0.0",
            updateState: {
              outcome: "update-available",
              availableVersion: "1.2.0",
              availableLabel: "1.2.0",
            },
          }),
          makePluginListItem({
            id: "linear",
            name: "Linear",
            source: "git:github.com/acme/linear@^0.8.0",
            version: "0.8.0",
            updateState: {
              outcome: "update-available",
              availableVersion: "0.8.4",
              availableLabel: "0.8.4",
            },
          }),
          makePluginListItem({
            id: "legacy",
            name: "Legacy",
            source: "npm:@acme/legacy@^2.0.0",
            version: "2.0.0",
            updateState: {
              outcome: "incompatible",
              blockedVersion: "3.0.0",
              blockedLabel: "3.0.0",
              blockedReasons: ["engines.bb requires >=9.0.0"],
            },
          }),
        ]),
      }),
    );

    renderSection();

    const legacy = document.querySelector('[data-plugin-update-row="legacy"]');
    expect(legacy?.textContent).toContain("3.0.0: engines.bb requires >=9.0.0");
    expect(within(legacy as HTMLElement).queryByRole("button")).toBeNull();
    expect(
      within(legacy as HTMLElement)
        .getByRole("link")
        .getAttribute("href"),
    ).toBe("/settings/plugins/legacy?view=installed");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Update available · Update Notes to 1.2.0",
      }),
    );
    expect(startPluginUpdateMock).toHaveBeenCalledTimes(1);
    expect(startPluginUpdateMock).toHaveBeenLastCalledWith("notes");

    fireEvent.click(
      screen.getByRole("button", { name: "Update all 2 plugins" }),
    );
    expect(startPluginUpdateMock.mock.calls.slice(1)).toEqual([
      ["linear"],
      ["notes"],
    ]);
  });

  it("tracks plugin update jobs on their rows and counts through the batch", () => {
    useWebApp();
    const plugin = (id: string) =>
      makePluginListItem({
        id,
        name: id,
        source: `npm:@acme/${id}@^1.0.0`,
        updateState: {
          outcome: "update-available",
          availableVersion: "1.1.0",
          availableLabel: "1.1.0",
        },
      });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        plugins: buildUpdateInventoryPlugins([
          plugin("alpha"),
          plugin("beta"),
          plugin("gamma"),
        ]),
      }),
    );
    const job = (
      pluginId: string,
      state: "queued" | "running",
    ): import("@bb/server-contract").PluginUpdateJob =>
      state === "queued"
        ? { id: `job_${pluginId}`, pluginId, displayName: pluginId, state }
        : {
            id: `job_${pluginId}`,
            pluginId,
            displayName: pluginId,
            state,
            phase: "preparing",
          };
    const queryClient = new QueryClient();
    const tree = () => (
      <MemoryRouter>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <UpdatesSettingsSection />
          </QueryClientProvider>
        </TooltipProvider>
      </MemoryRouter>
    );
    const section = () =>
      document.querySelector('[data-updates-domain="plugins"]') as HTMLElement;
    const progress = () =>
      section().querySelector("[data-updates-progress]")?.textContent ?? null;
    const rowState = (id: string) =>
      section()
        .querySelector(`[data-plugin-update-row="${id}"] [data-update-state]`)
        ?.getAttribute("data-update-state") ?? null;

    pluginUpdateJobs.current = [
      job("alpha", "running"),
      job("beta", "queued"),
      job("gamma", "queued"),
    ];
    const view = render(tree());
    expect(progress()).toBe("Updating 1 of 3");
    expect(rowState("alpha")).toBe("in-progress");
    expect(rowState("gamma")).toBe("in-progress");
    expect(
      within(section()).queryByRole("button", { name: /Update all/u }),
    ).toBeNull();

    pluginUpdateJobs.current = [job("gamma", "running")];
    view.rerender(tree());
    expect(progress()).toBe("Updating 3 of 3");
    expect(rowState("alpha")).toBeNull();
    expect(
      within(section()).getByRole("button", {
        name: "Update available · Update alpha to 1.1.0",
      }),
    ).toBeDefined();

    pluginUpdateJobs.current = [];
    view.rerender(tree());
    expect(progress()).toBeNull();
    expect(
      within(section()).getByRole("button", { name: "Update all 3 plugins" }),
    ).toBeDefined();
  });

  it("toasts a plugin update the server refuses to start", async () => {
    useWebApp();
    startPluginUpdateMock.mockRejectedValue(
      new Error("server move in progress"),
    );
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        plugins: buildUpdateInventoryPlugins([
          makePluginListItem({
            id: "notes",
            name: "Notes",
            source: "npm:@acme/notes@^1.0.0",
            updateState: {
              outcome: "update-available",
              availableVersion: "1.2.0",
              availableLabel: "1.2.0",
            },
          }),
        ]),
      }),
    );

    renderSection();
    fireEvent.click(
      screen.getByRole("button", { name: "Update all 1 plugin" }),
    );

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith("Plugin update failed", {
        description: "Notes — server move in progress",
      });
    });
  });

  it("shows an external Claude installation as a manual update without an update button", () => {
    const host = makeHost({ id: "host_1", name: "workstation" });
    const issue = makeManualUpdateIssue({ provider: "claude-code" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [issue] })],
        actionableCount: 1,
        hasAttention: true,
      }),
    );

    renderSection();

    expect(screen.getByText("1 manual")).toBeDefined();
    expect(
      document
        .querySelector('[data-provider-avatar="claude-code"]')
        ?.hasAttribute("data-provider-manual"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /Update all/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(
      document.querySelector('[data-provider-row="claude-code"]')?.textContent,
    ).toContain("Update in terminal");
    expect(
      screen.queryByRole("button", { name: "Update workstation" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("omits an empty machine container", async () => {
    useUpdateInventoryMock.mockReturnValue(makeInventory({ machines: [] }));

    renderSection();

    expect(document.querySelector("[data-updates-machine]")).toBeNull();
    expect(screen.queryByText("No machines yet.")).toBeNull();
    expect(screen.getByText("No machines available.")).toBeDefined();
  });
});
