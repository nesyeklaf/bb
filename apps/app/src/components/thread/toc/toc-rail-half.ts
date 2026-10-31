export type TocRailHalf = "messages" | "topics";

export function railHalfAt(
  clientX: number,
  rect: { left: number; width: number },
): TocRailHalf {
  return clientX >= rect.left + rect.width / 2 ? "topics" : "messages";
}

const TINT = "color-mix(in oklab, currentColor 8%, transparent)";

export function railHalfTint(half: TocRailHalf): string {
  return half === "topics"
    ? `linear-gradient(to right, transparent 50%, ${TINT} 50%)`
    : `linear-gradient(to right, ${TINT} 50%, transparent 50%)`;
}

export const TOC_HALF_SWITCH_DELAY_MS = 140;
