# Connection overview

A bundled plugin that records every network connection bb's own processes open or accept, and classifies each destination. It observes only and never blocks.

- The host worker reads `/proc/net/{tcp,tcp6,udp,udp6}` for the daemon's process tree once a second and maps sockets to processes through `/proc/<pid>/fd`. The server samples its own tree the same way. No root is needed.
- In the server process, `node:diagnostics_channel` (`undici:client:connected`, `http.client.request.start`) binds a hostname to the exact socket a `fetch` or `http` request opened, including plugin backends.
- Local networks are loopback, RFC 1918, link-local, the Tailscale ranges (100.64.0.0/10, fd7a:115c:a1e0::/48) and the subnets of every WireGuard interface (`DEVTYPE=wireguard` in `/sys/class/net/<if>/uevent`), re-read every 2 minutes.
- Classification, first match wins: outgoing sockets to local networks and the system resolver are allowed; a socket with a hostname is allowed when the host is listed, red otherwise; a provider CLI or git socket without a hostname is inferred when its IP matches a fresh resolution of a listed host only; a shared or stale match is yellow; anything else is red. Incoming peers follow the incoming rule below.
- Incoming HTTP requests and WebSocket upgrades of the server are read from a bounded ring (8192 entries) that the server app fills before its host check, through `bb.server.internal_DO_NOT_USE_requestPeers`. Each entry holds the socket peer, method, status and time only. Incoming rule, for these requests and for sockets accepted by the server and daemon trees: loopback is "origin unverifiable", Tailscale ranges and WireGuard interface subnets are allowed, anything else is red, RFC 1918 and link-local included. An overwritten stretch of the ring is recorded as a gap.
- The list is the model providers' hosts plus four exact GitHub hosts. Add more with the `extraAllowedHosts` setting; it lives in the server's database, never in git.
- Storage is one aggregate row per destination (at most 100,000, kept 7 days) and a gap table. Hitting the cap marks coverage incomplete.

`bb connections status` exits 0 when every connected source is fresh (collector sampled within 5 s, transport replied within 30 s) and no gap over 10 s falls in the window; 1 when coverage is unhealthy; 2 when red rows exist.

Not measured: hosts that are not Linux, remote and sandbox environments, unreadable pids, connections shorter than about a second, unconnected UDP, bb CLI processes outside the server and daemon trees, and the clients themselves.
