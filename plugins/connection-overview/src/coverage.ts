export const COLLECTOR_FRESH_MS = 5_000;
export const TRANSPORT_FRESH_MS = 30_000;
export const DISCONNECTED_MS = 60_000;
export const GAP_TOLERANCE_MS = 10_000;

export interface SourceState {
  sourceId: string;
  label: string;
  supported: boolean;
  platform: string | null;
  lastReplyAt: number | null;
  lastSampledAt: number | null;
  lastHostNow: number | null;
  treeSize: number;
  unreadablePids: number;
  error: string | null;
}

export interface SourceHealth {
  sourceId: string;
  label: string;
  collector: "fresh" | "stale" | "unknown";
  transport: "fresh" | "stale" | "disconnected";
  supported: boolean;
  treeSize: number;
  unreadablePids: number;
  error: string | null;
}

export function sourceHealth(
  source: SourceState,
  serverNow: number,
): SourceHealth {
  const collector =
    source.lastSampledAt === null || source.lastHostNow === null
      ? "unknown"
      : source.lastHostNow - source.lastSampledAt <= COLLECTOR_FRESH_MS
        ? "fresh"
        : "stale";
  const age =
    source.lastReplyAt === null ? Infinity : serverNow - source.lastReplyAt;
  const transport =
    age <= TRANSPORT_FRESH_MS
      ? "fresh"
      : age <= DISCONNECTED_MS
        ? "stale"
        : "disconnected";
  return {
    sourceId: source.sourceId,
    label: source.label,
    collector,
    transport,
    supported: source.supported,
    treeSize: source.treeSize,
    unreadablePids: source.unreadablePids,
    error: source.error,
  };
}

export interface StatusInput {
  sources: readonly SourceHealth[];
  gaps: readonly { start: number; end: number }[];
  redCount: number;
  capReached: boolean;
}

export interface StatusResult {
  exitCode: 0 | 1 | 2;
  problems: string[];
}

export function evaluateStatus(input: StatusInput): StatusResult {
  const problems: string[] = [];
  if (input.sources.length === 0) problems.push("no measurement source");
  for (const source of input.sources) {
    if (!source.supported)
      problems.push(`${source.label}: not measured on this platform`);
    else if (source.collector !== "fresh" || source.transport !== "fresh")
      problems.push(
        `${source.label}: collector ${source.collector}, transport ${source.transport}`,
      );
  }
  const longGaps = input.gaps.filter(
    (gap) => gap.end - gap.start > GAP_TOLERANCE_MS,
  );
  if (longGaps.length > 0)
    problems.push(`${longGaps.length} gap(s) over 10 s in the window`);
  if (input.capReached)
    problems.push("storage cap reached, coverage incomplete");
  if (input.redCount > 0) {
    problems.unshift(`${input.redCount} red destination(s)`);
    return { exitCode: 2, problems };
  }
  return { exitCode: problems.length > 0 ? 1 : 0, problems };
}
