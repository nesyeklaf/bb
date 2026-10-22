import { threadUrl } from "./api.mjs";
import { wait } from "./cdp.mjs";

export const SELECTORS = {
  sidebarBody: "[data-testid=app-sidebar-body]",
  sidebarThread: "[data-sidebar-thread-id]",
  timelineScroller: "[data-page-scroll-viewport]",
  timelineRow: "[data-timeline-row-id]",
  composer: "#thread-detail-follow-up-composer",
  rightPanelToggle:
    "button[aria-label^='Show right panel'], button[aria-label^='Hide right panel']",
  sidebarToggle: "button[aria-label^='Toggle sidebar']",
  panelChrome: "[data-testid=thread-secondary-panel-top-chrome]",
};

export const threadLinkSelector = (thread) =>
  "a[data-sidebar-thread-id=" + JSON.stringify(thread.id) + "]";

export const threadReadyExpression = (
  thread,
  { composer = !thread.archived } = {},
) =>
  "(() => { const rows = document.querySelectorAll(" +
  JSON.stringify(SELECTORS.timelineRow) +
  "); const prefix = " +
  JSON.stringify(thread.id + ":") +
  "; let own = false; for (const row of rows) { if (row.getAttribute('data-timeline-row-id').startsWith(prefix)) { own = true; break } } return own && location.pathname.endsWith(" +
  JSON.stringify("/threads/" + thread.id) +
  ")" +
  (composer
    ? " && Boolean(document.querySelector(" +
      JSON.stringify(SELECTORS.composer) +
      "))"
    : "") +
  " })()";

export const openThread = async (browser, baseUrl, thread, options = {}) => {
  await browser.navigate(threadUrl(baseUrl, thread));
  await browser.waitForExpression(threadReadyExpression(thread, options), {
    timeoutMs: 45_000,
    description: "thread " + thread.id + " timeline rows",
  });
};

export const settle = async (
  browser,
  { quietMs = 400, timeoutMs = 10_000 } = {},
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const before = await browser.performanceMetrics();
    await wait(quietMs);
    const after = await browser.performanceMetrics();
    if (after.TaskDuration - before.TaskDuration < 0.02) return true;
  }
  return false;
};

export const scrollerOf = (selectorExpression) =>
  "(() => { let node = document.querySelector(" +
  JSON.stringify(selectorExpression) +
  "); while (node) { const style = getComputedStyle(node); if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node; node = node.parentElement } return null })()";
