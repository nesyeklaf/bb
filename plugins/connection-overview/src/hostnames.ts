import { normalizeIp } from "./ip.js";
import type { Resolution } from "./classify.js";

export const HOSTNAME_LIMIT = 10_000;
export const CLOSED_SOCKET_TTL_MS = 2 * 60_000;
export const RESOLUTION_TTL_MS = 30 * 60_000;

interface Binding {
  hostname: string;
  closedAt: number | null;
}

export function socketBindingKey(
  localPort: number,
  remoteIp: string,
  remotePort: number,
): string {
  return `${localPort}|${normalizeIp(remoteIp)}|${remotePort}`;
}

export function createHostnameBook(now: () => number = Date.now) {
  const bindings = new Map<string, Binding>();
  const resolutions = new Map<string, Map<string, number>>();

  function sweep() {
    const current = now();
    for (const [key, binding] of bindings)
      if (
        binding.closedAt !== null &&
        current - binding.closedAt > CLOSED_SOCKET_TTL_MS
      )
        bindings.delete(key);
    while (bindings.size > HOSTNAME_LIMIT)
      bindings.delete(bindings.keys().next().value!);
    for (const [ip, names] of resolutions) {
      for (const [name, at] of names)
        if (current - at > RESOLUTION_TTL_MS) names.delete(name);
      if (names.size === 0) resolutions.delete(ip);
    }
  }

  return {
    bind(
      localPort: number,
      remoteIp: string,
      remotePort: number,
      hostname: string,
    ) {
      bindings.set(socketBindingKey(localPort, remoteIp, remotePort), {
        hostname,
        closedAt: null,
      });
      this.addResolution(hostname, remoteIp);
      if (bindings.size > HOSTNAME_LIMIT) sweep();
    },
    close(localPort: number, remoteIp: string, remotePort: number) {
      const binding = bindings.get(
        socketBindingKey(localPort, remoteIp, remotePort),
      );
      if (binding !== undefined) binding.closedAt = now();
    },
    lookup(
      localPort: number,
      remoteIp: string,
      remotePort: number,
    ): string | null {
      return (
        bindings.get(socketBindingKey(localPort, remoteIp, remotePort))
          ?.hostname ?? null
      );
    },
    addResolution(name: string, ip: string) {
      const normalized = normalizeIp(ip);
      const names = resolutions.get(normalized) ?? new Map<string, number>();
      names.set(name.toLowerCase(), now());
      resolutions.set(normalized, names);
    },
    resolutionsFor(ip: string): Resolution[] {
      const normalized = normalizeIp(ip);
      return [
        ...(resolutions.get(normalized) ?? new Map<string, number>()),
      ].map(([name, at]) => ({
        name,
        ip: normalized,
        at,
      }));
    },
    sweep,
  };
}

export type HostnameBook = ReturnType<typeof createHostnameBook>;
