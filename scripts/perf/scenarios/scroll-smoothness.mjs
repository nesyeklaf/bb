import { contractChecks } from "../lib/contract.mjs";
import { scrollerPoint, SCROLLER_SELECTORS } from "../lib/scroll.mjs";
import {
  SCROLL_GESTURES,
  attachPacing,
  measureScrollGesture,
  tracePacing,
} from "../lib/smoothness.mjs";
import { openThread, settle } from "../lib/ui.mjs";

const camel = (name) =>
  name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());

const pickThread = async (context) => {
  const id = context.options.thread;
  if (id) {
    const listed = (await context.api.sidebarThreads()).find(
      (thread) => thread.id === id,
    );
    const body = listed ? null : await context.api.json("/threads/" + id);
    return context.api.weigh(
      listed ?? { id, projectId: (body.thread ?? body).projectId },
    );
  }
  const [heavy] = await context.api.rankSidebarThreads(40);
  return heavy;
};

export default {
  name: "scroll-smoothness",
  description:
    "Frame pacing while scrolling a heavy timeline up continuously and with a touch fling: presented frames from the trace, rAF and LoAF in the page.",
  async run(context) {
    const { ledger } = context;
    const thread = await pickThread(context);
    const browser = await context.launchBrowser();
    await openThread(browser, context.baseUrl, thread);
    await settle(browser);
    const scroller = SCROLLER_SELECTORS.timeline;
    const point = await scrollerPoint(browser, scroller);
    const extent = await browser.evaluate(
      "(() => { const s = document.querySelector(" +
        JSON.stringify(scroller) +
        "); return { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, scrollTop: s.scrollTop } })()",
    );
    ledger.record(
      "fixture: the timeline overflows its viewport several times",
      extent.scrollHeight > extent.clientHeight * 3,
      { thread: thread.id, eventCount: thread.eventCount, ...extent },
    );
    const gestures = [];
    const capture = await browser.capture({
      label: "scroll-smoothness",
      ledger,
      urlPrefix: context.baseUrl,
      action: async () => {
        for (const gesture of SCROLL_GESTURES)
          gestures.push(
            await measureScrollGesture(browser, { scroller, point, gesture }),
          );
      },
      onTrace: tracePacing,
    });
    ledger.record(
      "scroll-smoothness: every trace window matched a gesture",
      attachPacing(gestures, capture.inspected),
      { windows: capture.inspected.length, gestures: gestures.length },
    );
    for (const gesture of gestures)
      ledger.record(
        "scroll-smoothness: " + gesture.name + " moved the timeline",
        gesture.scrolled && gesture.moved > 100,
        { moved: gesture.moved, scrollEvents: gesture.scrollEvents ?? 0 },
      );
    const headline = Object.fromEntries(
      gestures
        .filter((gesture) => gesture.presented)
        .flatMap((gesture) => [
          [camel(gesture.name) + "FrameP95Ms", gesture.presented.p95Ms],
          [camel(gesture.name) + "FrameP99Ms", gesture.presented.p99Ms],
          [camel(gesture.name) + "LongestFrameMs", gesture.presented.longestMs],
          [camel(gesture.name) + "DroppedPct", gesture.presented.droppedPct],
          [camel(gesture.name) + "RafP95Ms", gesture.raf.p95Ms],
          [camel(gesture.name) + "LoafBlockingMs", gesture.loaf.blockingMs],
        ]),
    );
    const { inspected, ...stored } = capture;
    return {
      headline,
      data: {
        thread,
        gestures,
        capture: stored,
        contract: contractChecks(capture),
      },
    };
  },
};
