import { contractChecks, headlineFromCapture } from "../lib/contract.mjs";
import {
  runScrollPasses,
  scrollerPoint,
  SCROLLER_SELECTORS,
} from "../lib/scroll.mjs";
import { SELECTORS, openThread, settle } from "../lib/ui.mjs";
import { wait } from "../lib/cdp.mjs";

export default {
  name: "sidebar-scroll",
  description:
    "Scroll the sidebar thread list (wheel flings down and up, touch drag) and hover rows: frame budget, long tasks, scroll and hover input latency.",
  async run(context) {
    const { ledger } = context;
    const [heavy] = await context.api.rankSidebarThreads(20);
    const browser = await context.launchBrowser();
    await openThread(browser, context.baseUrl, heavy);
    await browser.waitForExpression(
      "document.querySelectorAll(" +
        JSON.stringify(SELECTORS.sidebarThread) +
        ").length > 20",
      { description: "sidebar list" },
    );
    await settle(browser);
    const scroller = SCROLLER_SELECTORS.sidebar;
    const point = await scrollerPoint(browser, scroller);
    const metrics = await browser.evaluate(
      "(() => { const s = document.querySelector(" +
        JSON.stringify(scroller) +
        "); return { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight } })()",
    );
    ledger.record(
      "sidebar-scroll: the sidebar list overflows its viewport",
      metrics.scrollHeight > metrics.clientHeight * 1.5,
      metrics,
    );
    let passes = [];
    let hovered = 0;
    const capture = await browser.capture({
      label: "sidebar-scroll",
      ledger,
      urlPrefix: context.baseUrl,
      action: async () => {
        passes = await runScrollPasses(browser, {
          scrollerSelector: scroller,
          rowSelector: SELECTORS.sidebarThread,
          point,
          ledger,
          label: "sidebar-scroll",
          passes: [
            { name: "wheel fling down", distance: 2400, speed: 2400 },
            { name: "wheel fling up", distance: -2400, speed: 2400 },
            {
              name: "wheel slow down",
              distance: 1500,
              speed: 600,
              repeatCount: 1,
              repeatDelayMs: 50,
            },
            { name: "wheel fling up again", distance: -1500, speed: 1200 },
          ],
        });
        const rect = await browser.rect(scroller);
        for (let index = 0; index < 40; index += 1) {
          await browser.mouseMove({
            x: rect.x + 40 + (index % 4) * 20,
            y: rect.y + 20 + index * ((rect.height - 40) / 40),
          });
          hovered += 1;
          await wait(16);
        }
      },
    });
    ledger.record(
      "sidebar-scroll: hover moves were dispatched",
      hovered === 40,
      { hovered },
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
