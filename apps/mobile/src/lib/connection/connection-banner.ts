import type { MobileRealtimeConnectionState } from "../realtime/mobile-realtime";

export type ConnectionBannerKind = "hidden" | "connecting" | "reconnecting";

export interface ConnectionBannerInput {
  realtime: MobileRealtimeConnectionState;
  suspended: boolean;
  connectingForMs: number;
}

export const CONNECTING_BANNER_GRACE_MS = 1500;

export function deriveConnectionBanner(
  input: ConnectionBannerInput,
): ConnectionBannerKind {
  if (input.suspended) return "hidden";
  switch (input.realtime) {
    case "connected":
      return "hidden";
    case "reconnecting":
      return "reconnecting";
    case "connecting":
      return input.connectingForMs >= CONNECTING_BANNER_GRACE_MS
        ? "connecting"
        : "hidden";
  }
}
