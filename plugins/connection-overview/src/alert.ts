import type { Store } from "./store.js";

export const ALERT_TITLE = "Connection overview";
export const ALERT_BODY = "A connection to an unapproved destination was seen";

export function createAlerter(options: {
  store: Pick<Store, "claimUnclaimedRed">;
  send: (notification: { title: string; body: string }) => Promise<void>;
  now?: () => number;
  onSendFailed?: (error: unknown) => void;
}) {
  const now = options.now ?? Date.now;
  return {
    async sweep(): Promise<number> {
      const claimed = options.store.claimUnclaimedRed(now());
      for (let sent = 0; sent < claimed.length; sent += 1) {
        try {
          await options.send({ title: ALERT_TITLE, body: ALERT_BODY });
        } catch (error) {
          options.onSendFailed?.(error);
        }
      }
      return claimed.length;
    },
  };
}
