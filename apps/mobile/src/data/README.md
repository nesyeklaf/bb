# Data layer (`src/data`)

Pure policy and the few data hooks the native shell still owns. Everything
about threads, projects, plugins and settings runs in the web page inside
the WebView, which has its own query client; the native `QueryClient` only
caches the system config the palette sync reads.

- `shared/use-realtime-subscription.ts`: `useSystemRealtimeSubscription`
  holds the active profile's `system` realtime subscription while a system
  query is mounted (refcounted per target by the realtime manager).
- `system/system-queries.ts`: `useSystemConfig` (`GET /system/config`, key
  from `@/lib/query/query-keys`). `@/lib/query/realtime-invalidation.ts`
  invalidates it on `host` and `system` changes and catches up stale queries
  after a reconnect.
