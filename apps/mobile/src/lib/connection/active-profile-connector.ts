import type { ServerProfile } from "../profiles/profile";
import type { AppStateLike } from "../realtime/app-state";
import type {
  ProfileClient,
  ProfileClientRegistry,
} from "../sdk/client-registry";
import { connectProfileClient } from "../sdk/connect-profile-client";

export interface ActiveProfileConnection {
  profile: ServerProfile;
  client: ProfileClient;
}

export interface ActiveProfileConnector {
  activate(profile: ServerProfile | null): void;
  getSnapshot(): ActiveProfileConnection | null;
  subscribe(listener: () => void): () => void;
}

export interface CreateActiveProfileConnectorDeps {
  registry: ProfileClientRegistry;
  appState: AppStateLike;
}

function connectionIdentity(profile: ServerProfile): string {
  return `${profile.id}\0${profile.serverUrl}`;
}

export function createActiveProfileConnector(
  deps: CreateActiveProfileConnectorDeps,
): ActiveProfileConnector {
  const listeners = new Set<() => void>();
  let snapshot: ActiveProfileConnection | null = null;
  let identity: string | null = null;
  let teardown: (() => void) | null = null;

  function setSnapshot(next: ActiveProfileConnection | null): void {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function teardownCurrent(): void {
    const current = teardown;
    teardown = null;
    identity = null;
    current?.();
  }

  return {
    activate(profile) {
      if (profile === null) {
        teardownCurrent();
        setSnapshot(null);
        return;
      }
      const nextIdentity = connectionIdentity(profile);
      if (identity === nextIdentity && snapshot) {
        if (snapshot.profile !== profile) setSnapshot({ ...snapshot, profile });
        return;
      }
      teardownCurrent();
      identity = nextIdentity;
      const client = deps.registry.getClientForProfile(profile);
      teardown = connectProfileClient(client, deps.appState);
      setSnapshot({ profile, client });
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
