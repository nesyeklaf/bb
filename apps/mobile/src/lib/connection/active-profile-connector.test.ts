import { describe, expect, it } from "vitest";
import type { ServerProfile } from "../profiles/profile";
import type { AppStateLike, AppStateStatusLike } from "../realtime/app-state";
import { createFakeSocketFactory } from "../realtime/fake-socket";
import { createProfileClientRegistry } from "../sdk/client-registry";
import { createActiveProfileConnector } from "./active-profile-connector";

const direct: ServerProfile = {
  id: "d1",
  mode: "direct",
  serverUrl: "http://127.0.0.1:41999",
  label: "Simulator",
  createdAt: 0,
};

function fakeAppState(): AppStateLike & {
  emit(state: AppStateStatusLike): void;
} {
  const handlers = new Set<(state: AppStateStatusLike) => void>();
  return {
    currentState: "active",
    addEventListener(_type, handler) {
      handlers.add(handler);
      return {
        remove: () => {
          handlers.delete(handler);
        },
      };
    },
    emit(state) {
      for (const handler of handlers) handler(state);
    },
  };
}

function setup() {
  const sockets = createFakeSocketFactory();
  const registry = createProfileClientRegistry({
    sdk: {
      fetch: async () => {
        throw new TypeError("Network request failed");
      },
      realtime: { socketFactory: sockets, onInvalidMessage: () => {} },
    },
  });
  const appState = fakeAppState();
  const connector = createActiveProfileConnector({ registry, appState });
  return { sockets, registry, appState, connector };
}

describe("createActiveProfileConnector", () => {
  it("opens the socket immediately for a direct profile and reuses the client on re-activation", () => {
    const { sockets, registry, connector } = setup();
    connector.activate(direct);
    expect(sockets.sockets).toHaveLength(1);
    const snap = connector.getSnapshot();
    expect(snap?.client).toBe(registry.getClientForProfile(direct));

    connector.activate({ ...direct, label: "Renamed" });
    expect(sockets.sockets).toHaveLength(1);
    expect(connector.getSnapshot()?.profile.label).toBe("Renamed");
    expect(connector.getSnapshot()?.client).toBe(snap?.client);
  });

  it("tears the previous socket down when switching profiles and when deactivating", () => {
    const { sockets, connector } = setup();
    connector.activate(direct);
    const first = sockets.latest();
    first.open();

    connector.activate({ ...direct, id: "d2", serverUrl: "http://10.0.0.5:1" });
    expect(first.closes).toHaveLength(1);
    expect(sockets.sockets).toHaveLength(2);
    expect(sockets.latest().url).toBe("ws://10.0.0.5:1/ws");

    connector.activate(null);
    expect(sockets.latest().closes).toHaveLength(1);
    expect(connector.getSnapshot()).toBeNull();
  });

  it("suspends and resumes the live socket with AppState", () => {
    const { sockets, appState, connector } = setup();
    connector.activate(direct);
    sockets.latest().open();
    appState.emit("background");
    expect(sockets.latest().closes).toHaveLength(1);
    appState.emit("active");
    expect(sockets.sockets).toHaveLength(2);

    connector.activate(null);
    appState.emit("active");
    expect(sockets.sockets).toHaveLength(2);
  });
});
