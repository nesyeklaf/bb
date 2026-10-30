import type { Overview } from "../src/contract.js";

export type BannerTone = "alert" | "warning" | "measured";

export interface CoverageSummary {
  tone: BannerTone;
  headline: string;
  details: string[];
}

export const STALE_AFTER_MS = 60_000;

export function staleAt(overview: Overview): number {
  return overview.now + STALE_AFTER_MS;
}

export function describeCoverage(
  overview: Overview | undefined,
  refreshFailed: boolean,
  now: number,
): CoverageSummary {
  if (overview === undefined)
    return {
      tone: "warning",
      headline: "Not measured: the overview could not be read",
      details: [],
    };
  const details = overview.problems.filter(
    (problem) => !/^\d+ red destination\(s\)$/.test(problem),
  );
  if (refreshFailed)
    details.push("The last refresh failed; this is older data");
  const expired = now >= staleAt(overview);
  if (expired)
    details.push(
      `No update for ${formatDuration(now - overview.now)}; this is older data`,
    );
  const unexplained =
    (overview.counts["yellow"] ?? 0) + (overview.counts["undetermined"] ?? 0);
  if (unexplained > 0)
    details.push(
      `${unexplained} yellow or undetermined rows need an explanation`,
    );
  const red = overview.counts["red"] ?? 0;
  const incomplete =
    overview.sources.length === 0 ||
    details.length > 0 ||
    refreshFailed ||
    expired;
  if (red > 0)
    return {
      tone: "alert",
      headline: `${red} red ${red === 1 ? "destination" : "destinations"} in this window${incomplete ? "; measurement incomplete, there may be more" : ""}`,
      details,
    };
  if (overview.sources.length === 0)
    return {
      tone: "warning",
      headline: "Not measured: no measurement source is connected",
      details,
    };
  if (overview.exitCode !== 0 || refreshFailed || expired)
    return {
      tone: "warning",
      headline: "Measurement incomplete: do not read an empty list as safe",
      details,
    };
  return {
    tone: "measured",
    headline: "Measured: no red destination, all sources fresh",
    details,
  };
}

export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}
