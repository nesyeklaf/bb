import type { Store } from "./store.js";

export const ALERT_TITLE = "Connection overview";
export const ALERT_BODY = "A connection to an unapproved destination was seen";

export function alertBody(count: number): string {
  return count === 1
    ? ALERT_BODY
    : count + " connections to unapproved destinations were seen";
}

const NOT_DELIVERED_STATUSES = new Set([404, 503]);

function certainlyNotDelivered(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error))
    return false;
  const status = (error as { status: unknown }).status;
  return typeof status === "number" && NOT_DELIVERED_STATUSES.has(status);
}

export function createAlerter(options: {
  store: Pick<Store, "claimUnclaimedRed" | "releaseClaims">;
  send: (notification: { title: string; body: string }) => Promise<void>;
  now?: () => number;
  onSendFailed?: (error: unknown) => void;
  onSendDeferred?: (error: unknown) => void;
}) {
  const now = options.now ?? Date.now;
  let running: Promise<number> | null = null;
  const alerter = {
    start(): Promise<number> | null {
      if (running !== null) return null;
      running = alerter.sweep().finally(() => {
        running = null;
      });
      return running;
    },
    async sweep(): Promise<number> {
      const claimed = options.store.claimUnclaimedRed(now());
      if (claimed.length === 0) return 0;
      try {
        await options.send({
          title: ALERT_TITLE,
          body: alertBody(claimed.length),
        });
      } catch (error) {
        if (certainlyNotDelivered(error)) {
          options.store.releaseClaims(claimed);
          options.onSendDeferred?.(error);
          return 0;
        }
        options.onSendFailed?.(error);
      }
      return claimed.length;
    },
  };
  return alerter;
}
