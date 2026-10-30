import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALERT_BODY, ALERT_TITLE, createAlerter } from "./alert.js";
import type { ConnectionState } from "./classify.js";
import { createStore, type Observation } from "./store.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function harness() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "bb-alert-"));
  cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
  const host = createFakePluginHost({
    pluginId: "bb--connection-overview",
    dataDir,
  });
  const open = () =>
    createStore(host.bb.storage.database(), host.bb.storage.migrate);
  return { open };
}

function observation(
  hostname: string,
  state: ConnectionState,
  seenAt = 1_000,
): Observation {
  return {
    sourceId: "server",
    direction: "out",
    proto: "tcp",
    port: 443,
    hostname,
    ip: "203.0.113.7",
    state,
    reason: "test",
    seenAt,
    newSocket: true,
    attribution: { pid: 10, startTime: 1, comm: "node" },
  };
}

describe("red destination alert", () => {
  it("sends once for a red key seen again in later sweeps", async () => {
    const { open } = await harness();
    const store = open();
    const send = vi.fn(async () => {});
    const alerter = createAlerter({ store, send });
    store.record([observation("bad.example", "red")]);
    expect(await alerter.sweep()).toBe(1);
    store.record([observation("bad.example", "red", 2_000)]);
    expect(await alerter.sweep()).toBe(0);
    expect(await alerter.sweep()).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ title: ALERT_TITLE, body: ALERT_BODY });
  });

  it("keeps hostnames and addresses out of the notification", async () => {
    const { open } = await harness();
    const store = open();
    const send = vi.fn(async () => {});
    store.record([observation("secret-host.example", "red")]);
    await createAlerter({ store, send }).sweep();
    expect(JSON.stringify(send.mock.calls)).not.toMatch(
      /secret-host|203\.0\.113/,
    );
  });

  it("sends zero after a crash between claim and send, also after restart", async () => {
    const { open } = await harness();
    const first = open();
    first.record([observation("bad.example", "red")]);
    expect(first.claimUnclaimedRed(1_500)).toHaveLength(1);
    const send = vi.fn(async () => {});
    const restarted = open();
    expect(await createAlerter({ store: restarted, send }).sweep()).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(restarted.list({ since: 0, states: ["red"] })).toHaveLength(1);
  });

  it("does not repeat after a failed send and keeps the row red", async () => {
    const { open } = await harness();
    const store = open();
    const failures: unknown[] = [];
    const send = vi.fn(async () => {
      throw new Error("unreachable");
    });
    const alerter = createAlerter({
      store,
      send,
      onSendFailed: (error) => failures.push(error),
    });
    store.record([observation("bad.example", "red")]);
    await alerter.sweep();
    await alerter.sweep();
    expect(send).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
    expect(store.list({ since: 0, states: ["red"] })).toHaveLength(1);
  });

  it("re-evaluates rows after an allowlist edit but never sends the same key twice", async () => {
    const { open } = await harness();
    const store = open();
    const send = vi.fn(async () => {});
    const alerter = createAlerter({ store, send });
    store.record([observation("bad.example", "red")]);
    await alerter.sweep();
    store.reclassifyHostnames(() => true);
    expect(store.list({ since: 0 })[0]?.state).toBe("allowed");
    await alerter.sweep();
    store.reclassifyHostnames(() => false);
    expect(store.list({ since: 0 })[0]?.state).toBe("red");
    await alerter.sweep();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never alerts for third-party, yellow, inferred, undetermined or allowed rows", async () => {
    const { open } = await harness();
    const store = open();
    const send = vi.fn(async () => {});
    store.record(
      (
        [
          "third-party",
          "yellow",
          "inferred",
          "undetermined",
          "unverifiable",
          "allowed",
        ] as const
      ).map((state) => observation(`${state}.example`, state)),
    );
    expect(await createAlerter({ store, send }).sweep()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends one notification per distinct red key", async () => {
    const { open } = await harness();
    const store = open();
    const send = vi.fn(async () => {});
    store.record([
      observation("a.example", "red"),
      observation("b.example", "red"),
      observation("c.example", "allowed"),
    ]);
    await createAlerter({ store, send }).sweep();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
