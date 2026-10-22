import { contractChecks } from "../lib/contract.mjs";
import { processCpuDuring } from "../lib/proc.mjs";
import { openThread, settle } from "../lib/ui.mjs";
import { round } from "../lib/metrics.mjs";

const IDLE_SECONDS = 15;

export default {
  name: "idle",
  description:
    "Open heavy thread, no input for 15 s: renderer wakeups, main-thread busy share, frames produced and server/daemon CPU while nothing happens.",
  async run(context) {
    const { ledger } = context;
    const [heavy] = await context.api.rankSidebarThreads(40);
    const browser = await context.launchBrowser();
    await openThread(browser, context.baseUrl, heavy);
    const quiet = await settle(browser, { quietMs: 500, timeoutMs: 20_000 });
    ledger.record(
      "idle: page quiesced after load before the idle window",
      quiet,
      null,
    );
    let server = null;
    const capture = await browser.capture({
      label: "idle",
      ledger,
      urlPrefix: context.baseUrl,
      expectFrames: false,
      expectActivity: false,
      action: async () => {
        if (context.dataDirPattern)
          server = await processCpuDuring(
            context.dataDirPattern,
            IDLE_SECONDS * 1000,
          );
        else
          await browser.evaluate(
            "new Promise((resolve) => setTimeout(resolve, " +
              IDLE_SECONDS * 1000 +
              "))",
          );
      },
    });
    if (context.dataDirPattern)
      ledger.record(
        "idle: server processes were found for CPU sampling",
        server.processCount > 0,
        server,
      );
    const analysis = capture.analysis;
    const seconds = analysis.windowMs / 1000;
    return {
      headline: {
        mainBusyShare: analysis.mainThread.busyShare,
        taskWakeupsPerSecond: round(analysis.mainThread.taskCount / seconds, 1),
        framesPresentedPerSecond: round(
          analysis.frames.presentedCount / seconds,
          2,
        ),
        longestTaskMs: analysis.mainThread.taskMs.max,
        layoutsPerSecond: round(
          capture.counters.delta.LayoutCount / seconds,
          2,
        ),
        styleRecalcsPerSecond: round(
          capture.counters.delta.RecalcStyleCount / seconds,
          2,
        ),
        ...(server
          ? { serverStackCpuShareOfOneCore: server.totalCpuShareOfOneCore }
          : {}),
      },
      data: {
        thread: heavy,
        capture,
        contract: contractChecks(capture),
        server,
      },
    };
  },
};
