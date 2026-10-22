import { FRAME_BUDGET_MS, LONG_TASK_MS } from "./trace.mjs";

export const INPUT_BUDGET_MS = 16;

const check = (metric, value, budget, comparison) => ({
  metric,
  value,
  budget,
  pass:
    value === null || value === undefined
      ? null
      : comparison === "<="
        ? value <= budget
        : value < budget,
});

export const contractChecks = (capture) => {
  const { analysis } = capture;
  if (!analysis?.ok) return [];
  const checks = [
    check(
      "frame interval p95 (ms)",
      analysis.frames.intervalMs.p95,
      FRAME_BUDGET_MS,
      "<=",
    ),
    check(
      "share of frames over 6.94 ms",
      analysis.frames.intervalMs.shareOverBudget,
      0.05,
      "<=",
    ),
    check(
      "main-thread work per frame p95 (ms)",
      analysis.frames.mainWorkMs.p95,
      FRAME_BUDGET_MS,
      "<=",
    ),
    check(
      "longest main-thread task (ms)",
      analysis.mainThread.taskMs.max,
      LONG_TASK_MS,
      "<=",
    ),
  ];
  for (const [inputClass, summary] of Object.entries(
    analysis.inputLatencyMs.byClass,
  )) {
    if (inputClass === "other") continue;
    checks.push(
      check(
        "input latency p95, " + inputClass + " (ms)",
        summary.p95,
        INPUT_BUDGET_MS,
        "<=",
      ),
    );
  }
  for (const [inputClass, summary] of Object.entries(
    analysis.eventTimingMs.byClass,
  )) {
    if (inputClass === "other") continue;
    checks.push(
      check(
        "event timing p95, " + inputClass + " (ms)",
        summary.p95,
        INPUT_BUDGET_MS,
        "<=",
      ),
    );
  }
  return checks;
};

export const headlineFromCapture = (capture, prefix = "") => {
  const { analysis } = capture;
  if (!analysis?.ok) return {};
  const headline = {
    [prefix + "frameIntervalP95Ms"]: analysis.frames.intervalMs.p95,
    [prefix + "framesOverBudgetShare"]:
      analysis.frames.intervalMs.shareOverBudget,
    [prefix + "longestTaskMs"]: analysis.mainThread.taskMs.max,
    [prefix + "tasksOver50ms"]: analysis.mainThread.tasksOver50ms,
    [prefix + "mainBusyShare"]: analysis.mainThread.busyShare,
  };
  for (const [inputClass, summary] of Object.entries(
    analysis.inputLatencyMs.byClass,
  ))
    headline[prefix + "inputLatencyP95Ms." + inputClass] = summary.p95;
  return headline;
};
