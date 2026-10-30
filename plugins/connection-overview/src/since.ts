const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseSince(
  value: string | undefined,
  now: number,
  fallback = "24h",
): number {
  const text = (value ?? fallback).trim();
  const duration = /^(\d+)([smhd])$/.exec(text);
  if (duration !== null)
    return now - Number(duration[1]) * UNITS[duration[2]!]!;
  const absolute = Date.parse(text);
  if (Number.isFinite(absolute)) return absolute;
  throw new Error(
    `Use a duration like 30m, 24h or 7d, or an ISO time, for --since (got ${text}).`,
  );
}
