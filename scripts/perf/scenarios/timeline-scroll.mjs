import { contractChecks, headlineFromCapture } from "../lib/contract.mjs";
import {
  runScrollPasses,
  scrollerPoint,
  SCROLLER_SELECTORS,
} from "../lib/scroll.mjs";
import { SELECTORS, openThread, settle } from "../lib/ui.mjs";

export default {
  name: "timeline-scroll",
  description:
    "Scroll the heaviest thread's timeline (virtualized, bottom-anchored) from the end to the beginning and back, mouse and touch.",
  async run(context) {
    const { ledger } = context;
    const [heavy] = await context.api.rankSidebarThreads(40);
    ledger.record(
      "fixture: the heavy thread has a long timeline",
      heavy.rowCount > 50,
      heavy,
    );
    const browser = await context.launchBrowser();
    await openThread(browser, context.baseUrl, heavy);
    await settle(browser);
    const scroller = SCROLLER_SELECTORS.timeline;
    const point = await scrollerPoint(browser, scroller);
    const metrics = await browser.evaluate(
      "(() => { const s = document.querySelector(" +
        JSON.stringify(scroller) +
        "); return { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, scrollTop: s.scrollTop, renderedRows: document.querySelectorAll(" +
        JSON.stringify(SELECTORS.timelineRow) +
        ").length } })()",
    );
    ledger.record(
      "timeline-scroll: the timeline overflows its viewport several times",
      metrics.scrollHeight > metrics.clientHeight * 3,
      metrics,
    );
    let passes = [];
    const capture = await browser.capture({
      label: "timeline-scroll",
      ledger,
      urlPrefix: context.baseUrl,
      action: async () => {
        passes = await runScrollPasses(browser, {
          scrollerSelector: scroller,
          rowSelector: SELECTORS.timelineRow,
          point,
          ledger,
          label: "timeline-scroll",
          passes: [
            {
              name: "wheel fling up (history)",
              distance: -2400,
              speed: 2400,
              repeatCount: 2,
              repeatDelayMs: 100,
            },
            { name: "wheel fling up again", distance: -2400, speed: 3000 },
            { name: "wheel slow up", distance: -1200, speed: 500 },
            { name: "wheel fling down short", distance: 1800, speed: 1200 },
            {
              name: "wheel fling down",
              distance: 3000,
              speed: 2400,
              repeatCount: 1,
              repeatDelayMs: 100,
            },
          ],
        });
      },
    });
    ledger.record(
      "timeline-scroll: virtualization swapped the rendered rows",
      passes.some((pass) => pass.rowsChanged),
      passes,
    );
    return {
      headline: headlineFromCapture(capture),
      data: {
        thread: heavy,
        passes,
        metrics,
        capture,
        contract: contractChecks(capture),
      },
    };
  },
};
