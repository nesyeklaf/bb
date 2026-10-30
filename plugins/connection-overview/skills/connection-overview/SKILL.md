---
name: connection-overview
description: Check which hosts bb connects to, whether any destination is red, and whether the measurement is healthy, with bb connections.
---

# Connection overview

The bundled `bb--connection-overview` plugin records the connections of bb's server and daemon process trees, including the provider CLIs they start. It observes only.

```sh
bb connections status --since 1h          # exit 0 healthy, 1 coverage unhealthy, 2 red rows
bb connections list --since 24h           # outgoing destinations
bb connections list --red --since 30m --json
bb connections incoming --since 24h
```

`--since` takes a duration (`30m`, `24h`, `7d`) or an ISO time.

States: `allowed` (local network, system resolver, or a listed host bound to the socket), `inferred` (a provider CLI or git socket whose IP only matches a fresh resolution of a listed host), `yellow` (shared by listed and unlisted names, or a stale resolution), `red` (anything else), `unverifiable` (incoming over loopback: Tailscale Serve and local processes look the same), `undetermined` (direction unknown).

An empty red list proves nothing on its own. Check that the measurement is alive first: start a short fetch to an unlisted host from a bb child process, see it red with `bb connections list --red --since <control start>`, then evaluate a later window that starts after the control ended with `bb connections status --since <evaluation start>`, and confirm at least one provider row in it.

Allowed hosts beyond the built-in list go into the plugin setting `extraAllowedHosts` (one exact host per line).
