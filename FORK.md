# This fork

`nesyeklaf/bb` is [get-bb/bb](https://github.com/get-bb/bb) with a small set of local fixes, built and run on a self-hosted server reached over Tailscale.

- `upstream` mirrors get-bb `main`, unchanged.
- `main` is `upstream` plus the fork commits: `git log --oneline origin/upstream..origin/main`.

Keep the fork commits few and self-contained, so each rebase onto a new upstream stays a small conflict at most. A fix that upstream takes over gets dropped during the rebase.

## Release

```sh
scripts/fork/release.sh          # sync + test + build
scripts/fork/release.sh build    # build the current main only
```

`sync` pushes upstream `main` to `origin/upstream` and rebases local `main` onto it. Publishing the rebased `main` rewrites the branch, so it is a deliberate step after the checks pass:

```sh
git push --force-with-lease origin main
```

`build` writes to `~/bb-fork-dist/<short-sha>/` (override with `BB_FORK_DIST`):

| Artifact | Use |
| --- | --- |
| `bb-<version>-x86_64.AppImage` | Linux desktop app |
| `bb-app-<version>.tgz` | Server and machine daemon package, what `deploy.sh` installs |
| `bb-android-<sha>.apk` | Android app, arm64, debug-signed |
| `SHA256SUMS` | Checksums of the above |

Build requirements: Node and pnpm from `package.json`, a JDK 17 with `javac` (found under `~/.gradle/jdks` or `/usr/lib/jvm`, or set `JAVA_HOME`), and the Android SDK at `$ANDROID_HOME` (default `~/Android/Sdk`). JDK 21 does not build the APK.

The version number stays upstream's. Tell a fork build apart by its commit, not by its version.

## Deploy

```sh
scripts/fork/deploy.sh AI ~/bb-fork-dist/<sha>/bb-app-<version>.tgz
```

`deploy.sh` copies the tarball and `remote.sh` to the host, compares checksums, and starts `remote.sh deploy` as a transient systemd user unit. The unit keeps running when the ssh session drops, which it does when the restarted server is the one carrying the session. `remote.sh deploy`:

1. finds the single `bb-host-daemon-*.service` user unit (or `BB_UNIT`) and its `BB_DATA_DIR`,
2. stops the server,
3. backs up `bb.db`, `config.json` and the npm prefix to `<data-dir>/backup-pre-fork-<timestamp>` and records that path in `~/bb-fork-last-backup`,
4. installs the tarball into the npm prefix, restoring the old package if npm fails,
5. sets `BB_APP_URL` to the tailnet URL and starts the server.

Check the result any time with `ssh AI 'bash ~/bb-fork-remote.sh status'`. It prints the unit state, installed version, `BB_APP_URL`, the local and tailnet HTTP status, and the tail of `~/bb-fork-deploy.log`.

Do not update the server through the bb UI or npm. That installs the official package and drops the fork fixes. Machine daemons started with `--auto-update` fetch the package from their server, so they follow the fork.

## Rollback

```sh
ssh AI 'bash ~/bb-fork-remote.sh rollback'             # package and config only
ssh AI 'bash ~/bb-fork-remote.sh rollback --with-db'   # also bb.db
```

A newer bb migrates `bb.db` on its first start, and an older bb does not know those migrations. So a rollback without `--with-db` fails when the deploy brought new migrations. Check with `git diff --stat <old>..<new> -- packages/db/drizzle`. `--with-db` restores the database as it was before the deploy and loses every thread, message and setting written since.

## Network

The server listens on `127.0.0.1:38886` only. Tailscale Serve publishes it inside the tailnet:

```sh
ssh AI 'bash ~/bb-fork-remote.sh serve'   # sudo tailscale serve --bg --https=38886 http://127.0.0.1:38886
```

- URL: `https://<host>.<tailnet>.ts.net:38886`. On AI, port 443 belongs to nginx-proxy-manager, so Serve uses 38886.
- `serve --bg` persists in tailscaled's state and survives a reboot. The server unit is enabled and the user has lingering on, so it starts without a login. Neither has been tested with an actual reboot yet.
- Never use Funnel. The bb API has no authentication of its own and can run commands, so the tailnet ACLs are the access boundary.
- bb connect (`<name>.getbb.app`) keeps running alongside as a fallback until every client uses the tailnet URL.

Clients: the desktop app points at the tailnet URL through its custom server URL. The phone needs Tailscale running. A machine daemon is re-enrolled from the tailnet URL under Settings, Machines, Add machine.

## Fork changes

- `BbNavigate.toThread(threadId, { experimental_messageSeq })` jumps to a message (`#msg=SEQ`) from plugins, with `split` too. Dropped when upstream ships an equivalent.
- `app.slots.experimental_threadTocExtension({ id, title, useBands, tab?, onBandClick?, onBandHover? })` adds topic brackets and a popover tab to the thread TOC rail, with drag-marked ranges (`railSelection`). The tab can be the popover's default (`tab.experimental_default`) and gets `activeSeq`, `hoveredBand` and `setHoveredRange` to link its rows with the brackets. Ticks get their seq from the new `messageSeq` field of the conversation outline item (projection version 3). Dropped when upstream ships an equivalent.
