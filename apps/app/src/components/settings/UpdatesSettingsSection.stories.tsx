import type { Host } from "@bb/domain";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  type ProviderCliKey,
} from "@bb/host-daemon-contract";
import type { ProviderCliIssue } from "@/components/provider-cli/provider-cli-install";
import type { ProviderCliInstallFailure } from "@/components/provider-cli/provider-cli-install-store";
import {
  buildUpdateInventoryPlugins,
  type UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import { makePluginListItem } from "@/test/fixtures/plugins";
import {
  makeHost,
  makeProviderCliStatus,
} from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  MachineUpdateRow,
  PluginUpdatesSection,
  ProviderCliUpdatesSection,
} from "./UpdatesSettingsSection";

export default {
  title: "settings/Updates",
};

const noop = () => {};
const NO_JOBS: ReadonlySet<string> = new Set();
const NO_FAILURES: ReadonlyMap<string, ProviderCliInstallFailure> = new Map();
const STORY_NOW = 1_800_000_000_000;

function updateIssue(
  provider: ProviderCliKey,
  currentVersion: string,
  latestVersion: string,
): ProviderCliIssue {
  const base = makeProviderCliStatus(provider);
  const action = {
    kind: "update" as const,
    label: "Update" as const,
    command: `${base.executableName} update`,
  };
  return {
    provider,
    status: {
      ...base,
      currentVersion,
      latestVersion,
      installAction: action,
      needsUpdate: true,
    },
    action,
    title: `${base.displayName} update available`,
    description: `${currentVersion} -> ${latestVersion}`,
    fingerprint: `${provider}:${currentVersion}:${latestVersion}`,
  };
}

function machineOf({
  host,
  isPrimary = false,
  issues = [],
  statusError = false,
  canRetryDaemonUpdate = false,
  providers = ["codex", "claude-code", "acp-cursor"],
}: {
  host: Host;
  isPrimary?: boolean;
  issues?: ProviderCliIssue[];
  statusError?: boolean;
  canRetryDaemonUpdate?: boolean;
  providers?: readonly ProviderCliKey[];
}): UpdateInventoryMachine {
  const statusFor = (provider: ProviderCliKey) =>
    issues.find((issue) => issue.provider === provider)?.status ??
    makeProviderCliStatus(provider);
  const providerStatus: NonNullable<UpdateInventoryMachine["providerStatus"]> =
    {};
  for (const provider of providers)
    providerStatus[provider] = statusFor(provider);
  return {
    host,
    isPrimary,
    providerStatus: host.status === "connected" ? providerStatus : null,
    statusPending: false,
    statusFetching: false,
    statusError,
    issues,
    canRetryDaemonUpdate,
  };
}

function failedProviderMachine(
  hostId: string,
  providers: readonly ProviderCliKey[] = ["codex", "claude-code", "acp-cursor"],
): UpdateInventoryMachine {
  return machineOf({
    host: makeHost({ id: hostId, name: "Old Air" }),
    providers,
    issues: [
      updateIssue("codex", "0.157.0", "0.159.3"),
      updateIssue("claude-code", "2.1.282", "2.1.287"),
    ],
  });
}

function failedProviderFailures(
  machine: UpdateInventoryMachine,
): ReadonlyMap<string, ProviderCliInstallFailure> {
  return new Map(
    machine.issues.map((issue, index) => [
      `${machine.host.id}:${issue.provider}`,
      {
        issueFingerprint: issue.fingerprint,
        kind: index === 0 ? "command" : "interrupted",
        logDialogState: {
          displayName: issue.status.displayName,
          log: `$ ${issue.status.executableName} update\n`,
          message:
            index === 0
              ? "Command exited with code 1"
              : "HTTP 504: bb connect: timed out waiting for the tunnel client",
          title: `${issue.status.displayName} update log`,
        },
      },
    ]),
  );
}

function StoryMachineRow({
  machine,
  expanded = false,
  tags = [],
  runningJobKey = null,
  queuedJobKeys = NO_JOBS,
  failuresByJobKey = NO_FAILURES,
}: {
  machine: UpdateInventoryMachine;
  expanded?: boolean;
  tags?: readonly string[];
  runningJobKey?: string | null;
  queuedJobKeys?: ReadonlySet<string>;
  failuresByJobKey?: ReadonlyMap<string, ProviderCliInstallFailure>;
}) {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <MachineUpdateRow
        machine={machine}
        now={STORY_NOW}
        tags={tags}
        expanded={expanded}
        retryUpdatePending={false}
        runningJobKey={runningJobKey}
        queuedJobKeys={queuedJobKeys}
        failuresByJobKey={failuresByJobKey}
        onToggle={noop}
        onStartInstall={noop}
        onRetryDaemonUpdate={noop}
        onRecheckClis={noop}
      />
    </div>
  );
}

function StoryProviderClis({
  machines,
  serverHostId = null,
  localDaemonHostId = null,
  runningJobKey = null,
  queuedJobKeys = NO_JOBS,
  failuresByJobKey = NO_FAILURES,
}: {
  machines: readonly UpdateInventoryMachine[];
  serverHostId?: string | null;
  localDaemonHostId?: string | null;
  runningJobKey?: string | null;
  queuedJobKeys?: ReadonlySet<string>;
  failuresByJobKey?: ReadonlyMap<string, ProviderCliInstallFailure>;
}) {
  return (
    <ProviderCliUpdatesSection
      machines={machines}
      now={STORY_NOW}
      localDaemonHostId={localDaemonHostId}
      serverHostId={serverHostId}
      retryPendingHostId={null}
      runningJobKey={runningJobKey}
      queuedJobKeys={queuedJobKeys}
      failuresByJobKey={failuresByJobKey}
      onStartInstall={noop}
      onRetryDaemonUpdate={noop}
      onRetryAllDaemonUpdates={noop}
      onRecheckClis={noop}
    />
  );
}

function manualUpdateIssue(
  provider: ProviderCliKey,
  currentVersion: string,
  latestVersion: string,
): ProviderCliIssue {
  const status = makeProviderCliStatus(provider, {
    currentVersion,
    latestVersion,
    installAction: null,
    needsUpdate: true,
  });
  return {
    provider,
    status,
    action: null,
    title: `${status.displayName} update available`,
    description: `${currentVersion} -> ${latestVersion}`,
    fingerprint: `${provider}:${currentVersion}:${latestVersion}:manual`,
  };
}

export function RowVariations() {
  const providerUpdate = machineOf({
    host: makeHost({ id: "state-provider-update", name: "workstation" }),
    providers: ["codex"],
    issues: [updateIssue("codex", "0.145.0", "0.146.0")],
  });
  const providerInstalling = machineOf({
    host: makeHost({ id: "state-provider-installing", name: "studio-mac" }),
    providers: ["codex", "claude-code"],
    issues: [
      updateIssue("codex", "0.145.0", "0.146.0"),
      updateIssue("claude-code", "2.0.1", "2.1.0"),
    ],
  });
  const providerFailed = failedProviderMachine("state-provider-failed", [
    "codex",
  ]);
  const providerManual = machineOf({
    host: makeHost({ id: "state-provider-manual", name: "homelab" }),
    providers: ["codex"],
    issues: [manualUpdateIssue("codex", "0.145.0", "0.146.0")],
  });
  const daemonUpdating = machineOf({
    host: makeHost({
      id: "state-daemon-updating",
      name: "studio-mac",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: STORY_NOW - 30_000,
    }),
    canRetryDaemonUpdate: true,
  });
  const daemonStalled = machineOf({
    host: makeHost({
      id: "state-daemon-stalled",
      name: "ci-runner-3",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: STORY_NOW - 6 * 60_000,
    }),
    canRetryDaemonUpdate: true,
  });
  const daemonOffline = machineOf({
    host: makeHost({
      id: "state-daemon-offline",
      name: "old-laptop",
      status: "disconnected",
    }),
  });
  const providerCheckFailed = machineOf({
    host: makeHost({ id: "state-provider-check", name: "workstation" }),
    statusError: true,
  });

  return (
    <>
      <StoryCard className="max-w-5xl" labelWidth="240px">
        <h2 className="px-4 py-3 text-sm font-semibold">Machine rows</h2>
        <StoryRow
          label="Updates available"
          hint="One line per machine: the face pile shows which provider CLIs are behind."
        >
          <StoryMachineRow machine={providerUpdate} tags={["Server"]} />
        </StoryRow>

        <StoryRow
          label="Expanded"
          hint="Each installed CLI with its versions and the updater bb will run."
        >
          <StoryMachineRow machine={providerUpdate} expanded />
        </StoryRow>

        <StoryRow
          label="Installing"
          hint="The running CLI spins in the pile; queued ones wait."
        >
          <StoryMachineRow
            machine={providerInstalling}
            expanded
            runningJobKey={`${providerInstalling.host.id}:codex`}
            queuedJobKeys={
              new Set([`${providerInstalling.host.id}:claude-code`])
            }
          />
        </StoryRow>

        <StoryRow
          label="Update failed"
          hint="The row names the failure and retries; the expanded row opens the log."
        >
          <StoryMachineRow
            machine={providerFailed}
            expanded
            failuresByJobKey={failedProviderFailures(providerFailed)}
          />
        </StoryRow>

        <StoryRow
          label="Update in terminal"
          hint="bb cannot run this update, so the avatar is dashed and Update all skips it."
        >
          <StoryMachineRow machine={providerManual} expanded />
        </StoryRow>

        <StoryRow
          label="Status check failed"
          hint="The provider CLI check failed and can be retried."
        >
          <StoryMachineRow machine={providerCheckFailed} />
        </StoryRow>

        <StoryRow
          label="Machine updating bb"
          hint="The enrolled daemon is applying its required update automatically."
        >
          <StoryMachineRow machine={daemonUpdating} />
        </StoryRow>

        <StoryRow
          label="Machine update stalled"
          hint="The daemon update did not finish and can be retried."
        >
          <StoryMachineRow machine={daemonStalled} />
        </StoryRow>

        <StoryRow
          label="Machine offline"
          hint="Shown only after Show all; bb cannot currently reach this machine."
        >
          <StoryMachineRow machine={daemonOffline} />
        </StoryRow>
      </StoryCard>
    </>
  );
}

export function SectionVariations() {
  const current = machineOf({
    host: makeHost({ id: "section-current", name: "workstation" }),
    isPrimary: true,
  });
  const workstation = machineOf({
    host: makeHost({ id: "section-workstation", name: "workstation" }),
    isPrimary: true,
    issues: [
      updateIssue("codex", "0.145.0", "0.146.0"),
      updateIssue("acp-cursor", "0.48.0", "0.49.0"),
    ],
  });
  const studioMac = machineOf({
    host: makeHost({ id: "section-studio", name: "studio-mac" }),
    issues: [
      updateIssue("codex", "0.145.0", "0.146.0"),
      updateIssue("claude-code", "2.0.1", "2.1.0"),
    ],
  });
  const homelab = machineOf({
    host: makeHost({ id: "section-homelab", name: "homelab" }),
    issues: [
      updateIssue("codex", "0.145.0", "0.146.0"),
      manualUpdateIssue("claude-code", "2.0.1", "2.1.0"),
    ],
  });
  const offline = machineOf({
    host: makeHost({
      id: "section-offline",
      name: "old-laptop",
      status: "disconnected",
    }),
  });
  const stalled = machineOf({
    host: makeHost({
      id: "section-stalled",
      name: "ci-runner-3",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: STORY_NOW - 6 * 60_000,
    }),
    canRetryDaemonUpdate: true,
  });
  const failed = failedProviderMachine("section-failed");
  return (
    <StoryCard className="max-w-6xl" labelWidth="240px">
      <StoryRow
        label="Everything current"
        hint="One quiet line for the fleet."
      >
        <div className="w-full space-y-6">
          <StoryProviderClis machines={[current, offline]} />
        </div>
      </StoryRow>
      <StoryRow
        label="Single machine — updates available"
        hint="Update all sits beside the Provider CLIs heading."
      >
        <div className="w-full space-y-6">
          <StoryProviderClis
            machines={[workstation]}
            serverHostId={workstation.host.id}
          />
        </div>
      </StoryRow>
      <StoryRow
        label="Multiple machines"
        hint="Provider updates, a manual update, a failed install, and a stalled daemon; quiet machines fold into the footer."
      >
        <div className="w-full space-y-6">
          <StoryProviderClis
            machines={[
              workstation,
              studioMac,
              homelab,
              failed,
              stalled,
              current,
              offline,
            ]}
            serverHostId={workstation.host.id}
            localDaemonHostId={studioMac.host.id}
            failuresByJobKey={failedProviderFailures(failed)}
          />
        </div>
      </StoryRow>
      <StoryRow
        label="Updating"
        hint="Update all gives way to progress while the queue drains."
      >
        <div className="w-full space-y-6">
          <StoryProviderClis
            machines={[workstation, studioMac]}
            runningJobKey={`${workstation.host.id}:codex`}
            queuedJobKeys={
              new Set([
                `${workstation.host.id}:acp-cursor`,
                `${studioMac.host.id}:codex`,
                `${studioMac.host.id}:claude-code`,
              ])
            }
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}

const STORY_PLUGINS = buildUpdateInventoryPlugins([
  makePluginListItem({
    id: "github-pr-status",
    name: "GitHub PR Status",
    icon: "GitPullRequest",
    source: "npm:@acme/github-pr-status@^1.2.0",
    version: "1.2.0",
    updateState: {
      outcome: "update-available",
      availableVersion: "1.4.1",
      availableLabel: "1.4.1",
    },
  }),
  makePluginListItem({
    id: "linear",
    name: "Linear",
    icon: "Zap",
    source: "git:github.com/acme/linear@^0.8.0",
    version: "0.8.2",
    updateState: {
      outcome: "update-available",
      availableVersion: "0.9.0",
      availableLabel: "0.9.0",
      lastFailure: {
        version: "0.9.0",
        label: "0.9.0",
        at: STORY_NOW,
        detail: "activation failed: settings schema rejected stored values",
      },
    },
  }),
  makePluginListItem({
    id: "notes",
    name: "Notes",
    icon: "File",
    source: "npm:@acme/notes@^2.0.0",
    version: "2.3.0",
    updateState: {
      outcome: "incompatible",
      blockedVersion: "3.0.0",
      blockedLabel: "3.0.0",
      blockedReasons: ["engines.bb requires >=0.40.0 (running 0.38.0)"],
    },
  }),
  makePluginListItem({
    id: "pinned",
    name: "Pinned",
    source: "npm:@acme/pinned@1.0.0",
    updateState: { outcome: "pinned" },
  }),
]);

export function PluginSectionVariations() {
  return (
    <StoryCard className="max-w-5xl" labelWidth="240px">
      <h2 className="px-4 py-3 text-sm font-semibold">Plugins</h2>
      <StoryRow
        label="Updates"
        hint="Update, a failed update with Retry, and an engines-blocked candidate."
      >
        <div className="w-full">
          <PluginUpdatesSection
            plugins={STORY_PLUGINS}
            updatingPluginIds={NO_JOBS}
            checking={false}
            onStartUpdates={noop}
          />
        </div>
      </StoryRow>
      <StoryRow
        label="Updating"
        hint="Update all gives way to progress while the queue drains."
      >
        <div className="w-full">
          <PluginUpdatesSection
            plugins={STORY_PLUGINS}
            updatingPluginIds={new Set(["github-pr-status", "linear"])}
            checking={false}
            onStartUpdates={noop}
          />
        </div>
      </StoryRow>
      <StoryRow label="Quiet" hint="Every tracking plugin is current.">
        <div className="w-full">
          <PluginUpdatesSection
            plugins={{ trackedCount: 6, items: [] }}
            updatingPluginIds={NO_JOBS}
            checking={false}
            onStartUpdates={noop}
          />
        </div>
      </StoryRow>
      <StoryRow label="Checking" hint="The page-load check is running.">
        <div className="w-full">
          <PluginUpdatesSection
            plugins={{ trackedCount: 6, items: [] }}
            updatingPluginIds={NO_JOBS}
            checking
            onStartUpdates={noop}
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
