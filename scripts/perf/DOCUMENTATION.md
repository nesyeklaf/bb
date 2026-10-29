# Performance Measurement Tooling

Scripted, repeatable captures of bb's web app against a seeded production build. Each scenario drives a real Chromium over CDP, records a trace and a page-side probe, and reports numbers against one contract. A capture that is throttled, empty or idle where it should be busy is reported `INVALID` and fails the run; it never produces a number.

## Contract

- Frame budget 6.94 ms (144 Hz): frame interval p50, p95 and max, the share of frames over budget, and main-thread time split into script, style, layout, paint and composite.
- No main-thread task over 50 ms during an interaction; the long-task distribution is reported.
- Input to next paint p95 <= 16 ms for typing, scrolling, hover and clicks.
- Perceived wait: user action until the requested content is usable (rows rendered and the composer present, the panel visible, the token on screen).

Scenario results are measurements, not pass/fail against the contract. `PASS` means the capture was valid; the contract numbers are in the headline and in `contract` inside the run JSON.

## Setup

1. Seed an isolated data dir. Never point the tooling at a real data dir.

   ```sh
   pnpm seed:perf -- --reset --events 400000 --data-dir ~/bb-perf/data
   ```

2. Start a production build on it (or let `--data-dir` do it, see below).

   ```sh
   BB_SKIP_ONBOARDING=1 NODE_ENV=production node --conditions=source --import tsx scripts/start-bb.mjs \
     --data-dir ~/bb-perf/data --server-port 39886 --host-daemon-port 39887 --no-in-app-updates
   ```

3. Streaming only: install the paced provider into that instance and spawn one thread on it. Keep `BB_SERVER_URL` pointed at the perf instance, because the `bb` CLI otherwise talks to whatever bb the shell environment names.

   ```sh
   export BB_SERVER_URL=http://127.0.0.1:39886
   bb plugin install ./scripts/perf/fixtures/paced-stream-provider --yes
   bb thread spawn --provider paced-stream-agent --project <project id> --environment <environment id> --prompt "warm up the stream"
   ```

   The fixture is a copy of `examples/plugins/echo-provider` whose answer streams as `PACED_STREAM_CHUNKS` (default 240) markdown chunks every `PACED_STREAM_INTERVAL_MS` (default 25). Its `node_modules` link points at the echo provider's installed dependencies. Reseeding wipes the plugin and thread; repeat step 3.

## Running

```sh
node scripts/perf/run.mjs list
node scripts/perf/run.mjs all --url http://127.0.0.1:39886 --server-match bb-perf/data --out ~/bb-perf/results/dev
node scripts/perf/run.mjs composer thread-switch --data-dir ~/bb-perf/data --runs 3
```

- `--url` attaches to a running instance; `--data-dir` starts a production server on a seeded dir and stops it afterwards.
- `--server-match` is a substring of the server's command line (its data dir). It enables server and daemon CPU sampling in `idle` and `server-latency`.
- `--runs n` repeats each scenario with a fresh browser and profile; the headline reports mean, min and max.
- `--viewport w,h`, `--headed`, `--chrome <path>` (or `BB_PERF_CHROME`) adjust the browser.
- The exit code is non-zero if any scenario was invalid or threw.

Artifacts land in `<out>/<scenario>/run-<n>.json` (headline, ledger of checks, capture data).

## Scenarios

| Scenario          | What it does                                                        | Headline                                                           |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `cold-start`      | Fresh profile, navigate to a heavy thread                           | time to sidebar and to usable thread, load-time main-thread budget |
| `idle`            | 15 s with no input on a heavy thread                                | wakeups, main busy share, frames per second, server CPU            |
| `thread-switch`   | Click heavy and light sidebar threads, first visit and revisit      | perceived wait p50/p95, long tasks, click input latency            |
| `sidebar-scroll`  | Wheel flings and touch drags in the thread list, hover rows         | frame budget, scroll and hover input latency                       |
| `timeline-scroll` | Scroll the heaviest timeline end to start and back, mouse and touch | frame budget, long tasks, scroll input latency                     |
| `streaming`       | Send a prompt to the paced provider and type while it streams       | first token wait, completion time, frame budget, typing latency    |
| `composer`        | Type, paste 400 lines, open the @ popup on a heavy thread           | paste wait, long tasks, typing latency                             |
| `drawers-panels`  | Right panel and tabs, sidebar collapse, phone-width sidebar drawer  | perceived wait per control, frame budget at both sizes             |
| `server-latency`  | HTTP latency of the app's endpoints, cold, warm and in a burst      | first, p50, p95 per endpoint, burst wall time                      |

## App measures

The app records thread switches and overlay opens as `performance.measure` entries, so DevTools, Perfetto and the field-latency plugin read the same spans:

- `bb:switch` from the input that started the switch until the frame after the timeline is ready, with phases `input`, `render`, `timeline` and `paint` (`bb:switch:<phase>`). A switch superseded by another one is dropped.
- `bb:open` from the input that opened a dropdown, popover, select or responsive dialog until the frame after it rendered, with phases `render` and `paint`. Context menus are not covered.

The spans appear on the "Interactions" and "Thread switch" or "Overlay open" custom tracks in the DevTools Performance panel. Each entry carries `detail.bb` with the kind, label and phase.

## Profiling build

A profiling build keeps names readable and adds React's performance tracks (Scheduler and Components) to the Performance panel:

```sh
pnpm exec turbo run build --filter=@bb/app^...
pnpm --filter @bb/app run build:profiling
node scripts/perf/profiling-proxy.mjs --upstream http://127.0.0.1:38886 --port 38887
```

`BB_APP_PROFILING=1` turns off JS minification, writes source maps and aliases `react-dom/client` to `react-dom/profiling`; the output goes to `apps/app/dist-profiling`. The proxy serves that build and forwards everything else, including WebSockets, to a running server, so the profiling app runs against the same data as the normal one on its own port. Plugins keep their own bundles.

## Validity checks

Every capture records a ledger of checks before it reports numbers, so a broken capture cannot read as a fast one:

- Before each capture: the page is visible, requestAnimationFrame produces frames (page not throttled), timers do not drift (not throttled), and the host CPU is quiet.
- The trace has window markers and a renderer main thread, covers the action, recorded tasks, presented frames and measurable renderer work (idle captures invert the last two).
- After the capture the page is still visible and focused, and the traced renderer is the one that loaded the app URL.
- The interaction landed: scrollers moved, content became usable, the popup appeared. A ready expression that was already true when armed (`staleAtArm`) or that timed out invalidates the wait.

## Layout

- `run.mjs`: CLI, scenario selection, ledger, exit code.
- `lib/cdp.mjs`, `lib/browser.mjs`: CDP client and `PerfBrowser` (navigation, input, viewport, capture).
- `lib/page-probe.js`: page-side recorder (long tasks, frames, event timing, armed ready expressions).
- `lib/trace.mjs`, `lib/metrics.mjs`: trace parsing into the script/style/layout/paint/composite split, percentiles.
- `lib/contract.mjs`: the contract applied to a capture; `lib/ui.mjs`, `lib/scroll.mjs`, `lib/api.mjs`: selectors, gestures and the thread ranking by event count.
- `lib/app-server.mjs`, `lib/proc.mjs`: starting a server on a seeded dir, process CPU sampling.
- `profiling-proxy.mjs`: serves the profiling build in front of a running server.
- `scenarios/`: one file per scenario, registered in `scenarios/index.mjs`. A scenario exports `{ name, description, run(context) }` and returns `{ headline, data }`.
- `fixtures/paced-stream-provider/`: the streaming provider plugin.

## Adding a scenario

Rank threads with `context.api.rankSidebarThreads`, open them with `openThread`, wrap the interaction in `browser.capture({ action })`, arm a ready expression with `window.__bbperf.arm` before each action that should produce content, and record a ledger check for every precondition. Do not add a wait that a missing element could satisfy silently.
