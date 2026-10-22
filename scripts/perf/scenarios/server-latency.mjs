import { summarize, round } from "../lib/metrics.mjs";
import { processCpuDuring } from "../lib/proc.mjs";

const WARM_SAMPLES = 20;
const BURST = 24;

const sample = async (api, path, count) => {
  const times = [];
  let bytes = 0;
  for (let index = 0; index < count; index += 1) {
    const result = await api.timed(path);
    if (!result.ok)
      throw new Error("GET " + path + " answered " + result.status);
    times.push(result.totalMs);
    bytes = result.bytes;
  }
  return { times, bytes };
};

export default {
  name: "server-latency",
  description:
    "HTTP latency of the endpoints the app loads (sidebar bootstrap, thread, timeline of light and heavy threads): first call, warm p50/p95, concurrent burst, server CPU.",
  async run(context) {
    const { ledger, api } = context;
    const ranked = await api.rankSidebarThreads(60);
    ledger.record(
      "server-latency: the fixture has weighable threads",
      ranked.length >= 10,
      { found: ranked.length },
    );
    const heavy = ranked[0];
    const light = ranked.at(-1);
    const endpoints = [
      ["sidebar-bootstrap", "/sidebar-bootstrap"],
      ["threads list", "/threads"],
      ["heavy thread", "/threads/" + heavy.id],
      ["heavy timeline", "/threads/" + heavy.id + "/timeline"],
      ["light timeline", "/threads/" + light.id + "/timeline"],
    ];
    const results = {};
    for (const [name, path] of endpoints) {
      const first = await api.timed(path);
      ledger.record("server-latency: " + name + " answered 200", first.ok, {
        status: first.status,
      });
      const warm = await sample(api, path, WARM_SAMPLES);
      results[name] = {
        path,
        bytes: warm.bytes,
        firstMs: round(first.totalMs),
        warm: summarize(warm.times),
      };
    }
    let burstServer = null;
    const burstStartedAt = performance.now();
    const burstPromise = Promise.all(
      Array.from({ length: BURST }, (_, index) =>
        api.timed("/threads/" + ranked[index % ranked.length].id + "/timeline"),
      ),
    );
    if (context.dataDirPattern)
      burstServer = processCpuDuring(context.dataDirPattern, 1500);
    const burst = await burstPromise;
    const burstWallMs = performance.now() - burstStartedAt;
    ledger.record(
      "server-latency: every burst request succeeded",
      burst.every((result) => result.ok),
      { failed: burst.filter((result) => !result.ok).length },
    );
    const burstSummary = summarize(burst.map((result) => result.totalMs));
    return {
      headline: {
        sidebarBootstrapWarmP95Ms: results["sidebar-bootstrap"].warm.p95,
        heavyTimelineFirstMs: results["heavy timeline"].firstMs,
        heavyTimelineWarmP50Ms: results["heavy timeline"].warm.p50,
        heavyTimelineWarmP95Ms: results["heavy timeline"].warm.p95,
        burstP95Ms: burstSummary.p95,
        burstWallMs: round(burstWallMs),
      },
      data: {
        heavy,
        light,
        endpoints: results,
        burst: burstSummary,
        burstServer: burstServer ? await burstServer : null,
      },
    };
  },
};
