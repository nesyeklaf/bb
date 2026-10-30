import { classify, type ClassifyContext } from "./classify.js";
import type { SampleReply, SocketRow } from "./contract.js";
import { sourceHealth, type SourceState } from "./coverage.js";
import type { HostnameBook } from "./hostnames.js";
import { normalizeIp } from "./ip.js";
import type { DestinationRow, Observation, Store } from "./store.js";

export const PULL_INTERVAL_MS = 10_000;
export const MAX_PAGES_PER_PULL = 20;
export const DEDUPE_TTL_MS = 10 * 60_000;

export type SampleResult =
  | ({ supported: true } & SampleReply)
  | { supported: false; platform: string };

export interface SourceDriver {
  sourceId: string;
  label: string;
  ownPid: number | null;
  sample(input: {
    generation: string | null;
    cursor: number;
    gapCursor: number;
  }): Promise<SampleResult>;
}

export interface Cursor {
  generation: string | null;
  cursor: number;
  gapCursor: number;
  lastSampledAt: number | null;
}

export function createCollector(options: {
  store: Store;
  book: HostnameBook;
  context: () => Omit<ClassifyContext, "now" | "resolutionsFor">;
  now?: () => number;
  loadCursor: (sourceId: string) => Cursor | null;
  saveCursor: (sourceId: string, cursor: Cursor) => void;
  onNewDestinations?: (rows: DestinationRow[]) => void;
}) {
  const now = options.now ?? Date.now;
  const cursors = new Map<string, Cursor>();
  const sources = new Map<string, SourceState>();
  const counted = new Map<string, number>();

  function toObservation(
    source: SourceDriver,
    row: SocketRow,
    context: ClassifyContext,
  ): Observation {
    const hostname =
      source.ownPid !== null && row.pid === source.ownPid
        ? options.book.lookup(row.localPort, row.remoteIp, row.remotePort)
        : null;
    const classification = classify(row, hostname, context);
    const socketKey = `${row.pid}:${row.startTime}:${row.inode}`;
    const newSocket = !row.continued && !counted.has(socketKey);
    counted.set(socketKey, row.sampledAt);
    return {
      sourceId: source.sourceId,
      direction: classification.direction,
      proto: row.proto,
      port: classification.direction === "in" ? row.localPort : row.remotePort,
      hostname: hostname === null ? null : hostname.toLowerCase(),
      ip: normalizeIp(row.remoteIp),
      state: classification.state,
      reason: classification.reason,
      seenAt: row.sampledAt,
      newSocket,
      attribution: { pid: row.pid, startTime: row.startTime, comm: row.comm },
    };
  }

  function sourceState(source: SourceDriver): SourceState {
    const existing = sources.get(source.sourceId);
    if (existing !== undefined) return existing;
    const created: SourceState = {
      sourceId: source.sourceId,
      label: source.label,
      supported: true,
      platform: null,
      lastReplyAt: null,
      lastSampledAt: null,
      lastHostNow: null,
      treeSize: 0,
      unreadablePids: 0,
      error: null,
    };
    sources.set(source.sourceId, created);
    return created;
  }

  async function pull(source: SourceDriver): Promise<void> {
    const state = sourceState(source);
    for (let page = 0; page < MAX_PAGES_PER_PULL; page += 1) {
      const cursor = cursors.get(source.sourceId) ??
        options.loadCursor(source.sourceId) ?? {
          generation: null,
          cursor: 0,
          gapCursor: 0,
          lastSampledAt: null,
        };
      let reply: SampleResult;
      try {
        reply = await source.sample({
          generation: cursor.generation,
          cursor: cursor.cursor,
          gapCursor: cursor.gapCursor,
        });
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        return;
      }
      const receivedAt = now();
      state.error = null;
      state.lastReplyAt = receivedAt;
      if (!reply.supported) {
        state.supported = false;
        state.platform = reply.platform;
        return;
      }
      state.supported = true;
      if (reply.reset) {
        const previous = cursor.lastSampledAt;
        const coveredFrom =
          reply.rows[0]?.sampledAt ?? reply.sampledAt ?? reply.hostNow;
        if (previous !== null && coveredFrom > previous)
          options.store.recordGap(
            source.sourceId,
            previous,
            coveredFrom,
            "collector restarted",
          );
      }
      for (const gap of reply.gaps)
        options.store.recordGap(
          source.sourceId,
          gap.start,
          gap.end,
          gap.reason,
        );
      const context: ClassifyContext = {
        ...options.context(),
        now: receivedAt,
        resolutionsFor: (ip) => options.book.resolutionsFor(ip),
      };
      const added = options.store.record(
        reply.rows.map((row) => toObservation(source, row, context)),
      );
      if (added.length > 0) options.onNewDestinations?.(added);
      const next: Cursor = {
        generation: reply.generation,
        cursor: reply.cursor,
        gapCursor: reply.gapCursor,
        lastSampledAt: reply.sampledAt ?? cursor.lastSampledAt,
      };
      cursors.set(source.sourceId, next);
      options.saveCursor(source.sourceId, next);
      state.lastSampledAt = reply.sampledAt;
      state.lastHostNow = reply.hostNow;
      state.treeSize = reply.treeSize;
      state.unreadablePids = reply.unreadablePids;
      if (!reply.more) break;
    }
    const cutoff = now() - DEDUPE_TTL_MS;
    for (const [key, at] of counted) if (at < cutoff) counted.delete(key);
  }

  return {
    pull,
    health(activeSourceIds: ReadonlySet<string>) {
      const at = now();
      return [...sources.values()]
        .filter((source) => activeSourceIds.has(source.sourceId))
        .map((source) => sourceHealth(source, at));
    },
    forget(sourceId: string) {
      sources.delete(sourceId);
      cursors.delete(sourceId);
    },
  };
}

export type Collector = ReturnType<typeof createCollector>;
