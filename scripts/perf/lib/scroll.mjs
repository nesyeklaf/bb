import { SELECTORS } from "./ui.mjs";
import { wait } from "./cdp.mjs";

export const scrollState = (browser, scrollerSelector, rowSelector) =>
  browser.evaluate(
    "(() => { const scroller = document.querySelector(" +
      JSON.stringify(scrollerSelector) +
      "); const rows = [...document.querySelectorAll(" +
      JSON.stringify(rowSelector) +
      ")]; return { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight, rowKeys: rows.map((row) => row.getAttribute('data-timeline-row-id') ?? row.getAttribute('data-sidebar-thread-id')).slice(0, 200) } })()",
  );

export const runScrollPasses = async (
  browser,
  { scrollerSelector, rowSelector, passes, point, ledger, label },
) => {
  const observed = [];
  for (const pass of passes) {
    const before = await scrollState(browser, scrollerSelector, rowSelector);
    await browser.scrollGesture({
      ...point,
      distance: pass.distance,
      speed: pass.speed,
      source: pass.source ?? "mouse",
      repeatCount: pass.repeatCount ?? 0,
      repeatDelayMs: pass.repeatDelayMs ?? 0,
    });
    await wait(pass.settleMs ?? 250);
    const after = await scrollState(browser, scrollerSelector, rowSelector);
    const moved = Math.abs(after.top - before.top);
    const rowsChanged = after.rowKeys.some(
      (key) => !before.rowKeys.includes(key),
    );
    ledger.record(
      label + ": " + pass.name + " moved the scroller",
      moved > 100,
      { before: before.top, after: after.top, moved },
    );
    observed.push({
      name: pass.name,
      from: Math.round(before.top),
      to: Math.round(after.top),
      moved: Math.round(moved),
      rowsChanged,
      scrollHeight: Math.round(after.height),
    });
  }
  return observed;
};

export const scrollerPoint = async (browser, scrollerSelector) => {
  const rect = await browser.rect(scrollerSelector);
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
};

export const SCROLLER_SELECTORS = {
  sidebar: SELECTORS.sidebarBody + " [data-sidebar]",
  timeline: SELECTORS.timelineScroller,
};
