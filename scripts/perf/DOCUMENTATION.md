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

## A/B runs

`ab.mjs` compares two running servers on the same data, for example the live app and a candidate build behind `profiling-proxy.mjs` or a second server:

```sh
node scripts/perf/ab.mjs --a http://127.0.0.1:38886 --b http://127.0.0.1:38887 --start <thread id> --rounds 8 --cpu-throttle 4 --trace
```

- Each round runs both variants in a fresh browser, in the order AB BA BA AB, so warm caches and background load hit both alike.
- It opens `--start`, switches through `--threads` visible sidebar threads twice (first visit, revisit) and opens the thread actions menu `--menus` times. The wait runs from the input event until the frame after the content is usable, measured by the page probe, so it works on builds without the app measures.
- The report gives the median wait per variant and a bootstrap 95% interval of the difference. "b faster" or "b slower" only when the whole interval is on one side of zero; otherwise "no difference".
- `--cpu-throttle 4` slows the page like an old laptop. `run.mjs` takes the same flag.
- `--trace` records a Chrome trace per run, marks each wait as a `lab:switch` or `lab:open` measure and splits the main thread inside it into script, style, layout, paint, GC, other and idle time with `sql/interaction-breakdown.sql`. Traces are about 100 MB each and are deleted after the query unless `--keep-traces`.

`trace-sql.mjs <trace.json>` runs the same breakdown, or another file in `sql/` (`--sql`), on any trace, for example one saved from the DevTools Performance panel. `--windows` picks the slices to split: `bb:*` (default) for the app's spans and their phases, `bb:switch` for switches only.

Both need the Perfetto trace processor: `curl -LO https://get.perfetto.dev/trace_processor && chmod +x trace_processor`, then set `BB_PERF_TRACE_PROCESSOR` to its path, or put `trace_processor_shell` on the PATH.

## Regression check

`regression.mjs` answers "did this change make bb slower than its base?" without a running server:

```sh
node scripts/perf/regression.mjs --base origin/main --head HEAD
```

- It checks out `--base` (default: the merge-base of `origin/main` and the head) and `--head` (default `HEAD`) as detached worktrees under `--out`, installs with pnpm, builds the app, server, host daemon and bundled plugins with Turbo (`TURBO_CACHE_DIR` is honoured), seeds one fixture with the base's `seed-perf-db.ts` (1200 threads, 400000 events, seed 1) and starts each ref on its own copy of it.
- It then runs the A/B above with `--rounds 8 --cpu-throttle 4`, base as a and head as b, opening the heaviest idle thread first. Each browser's first load of that thread adds a `load first` metric next to the switches and menu opens.
- `budgets.json` sets, per metric, `budgetMs` and `budgetPct` (the slowdown the head may add) and `ceilingMs` (the head median it should stay under at `cpuThrottle`). A metric fails when the whole 95% interval of head - base is above zero and the median slowdown exceeds both `budgetMs` and `budgetPct`, or when the head completed more than 20% fewer of its actions than the base. Too few samples, a missing budget and a broken ceiling only warn.
- It prints and writes `summary.md` (a Markdown table starting with `<!-- bb-perf-regression -->`, also appended to `GITHUB_STEP_SUMMARY`), `regression.json` with the verdict and every row, `ab.json` with the raw samples, and the install, build, seed and server logs under `logs/`. Exit code 0 is PASS, 1 FAIL, 2 a broken run.
- The worktrees and data are removed afterwards unless `--keep-worktrees`. A run takes about 10 minutes, mostly the browser rounds; `--rounds` trades time for a narrower interval.
- `.github/workflows/perf-regression.yml` runs it on pull requests that touch the app, server, packages, plugins or this tooling, comparing the PR merge commit with its first parent, and on manual dispatch with any base and head. The report is the job summary and the `perf-regression` artifact.

Budgets are deliberately wider than the A/A noise: an A/A run of the same commit on both sides must pass, and a head that blocks the main thread for 250 ms when a thread's timeline becomes ready must fail. Work off the critical path, such as 60 ms in the first render of a switch while the timeline still loads, does not lengthen the wait and does not fail. Raise a budget only with an A/A run that shows the noise is wider; lower it with an A/A run that shows it is narrower.

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
- `ab.mjs`, `lib/ab-run.mjs`, `lib/ab-stats.mjs`: interleaved A/B runs and their statistics (`node --test scripts/perf/lib/ab-stats.test.mjs`).
- `regression.mjs`, `lib/regression-verdict.mjs`, `budgets.json`: base against head with budgets (`node --test scripts/perf/lib/regression-verdict.test.mjs`).
- `trace-sql.mjs`, `lib/perfetto.mjs`, `sql/`: Perfetto SQL on saved traces.
- `scenarios/`: one file per scenario, registered in `scenarios/index.mjs`. A scenario exports `{ name, description, run(context) }` and returns `{ headline, data }`.
- `fixtures/paced-stream-provider/`: the streaming provider plugin.

## Adding a scenario

Rank threads with `context.api.rankSidebarThreads`, open them with `openThread`, wrap the interaction in `browser.capture({ action })`, arm a ready expression with `window.__bbperf.arm` before each action that should produce content, and record a ledger check for every precondition. Do not add a wait that a missing element could satisfy silently.
