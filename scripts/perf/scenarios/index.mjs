import coldStart from "./cold-start.mjs";
import composer from "./composer.mjs";
import drawersPanels from "./drawers-panels.mjs";
import idle from "./idle.mjs";
import serverLatency from "./server-latency.mjs";
import sidebarScroll from "./sidebar-scroll.mjs";
import streaming from "./streaming.mjs";
import threadSwitch from "./thread-switch.mjs";
import timelineScroll from "./timeline-scroll.mjs";

export const SCENARIOS = Object.fromEntries(
  [
    coldStart,
    idle,
    threadSwitch,
    sidebarScroll,
    timelineScroll,
    streaming,
    composer,
    drawersPanels,
    serverLatency,
  ].map((scenario) => [scenario.name, scenario]),
);
