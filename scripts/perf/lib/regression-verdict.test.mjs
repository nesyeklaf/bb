import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareMedians } from "./ab-stats.mjs";
import {
  REPORT_MARKER,
  evaluateBudgets,
  judgeComparison,
  renderMarkdown,
} from "./regression-verdict.mjs";

const BASE = [980, 1010, 995, 1003, 990, 1007, 998, 1012, 985, 1001, 993, 1005];
const shift = (values, by) => values.map((value) => value + by);
const comparison = (kind, visit, a, b, attempts = {}) => ({
  kind,
  visit,
  samples: { a: a.length, b: b.length },
  attempts: { a: attempts.a ?? a.length, b: attempts.b ?? b.length },
  ...compareMedians(a, b),
});
const BUDGET = { budgetMs: 50, budgetPct: 4, ceilingMs: 1500 };

describe("regression verdict", () => {
  it("fails a metric that is surely slower by more than both budgets", () => {
    const row = comparison("switch", "first", BASE, shift(BASE, 80));
    assert.equal(judgeComparison(row, BUDGET).status, "fail");
  });

  it("passes a surely slower metric that stays within either budget", () => {
    const row = comparison("switch", "first", BASE, shift(BASE, 30));
    assert.equal(row.verdict, "b slower");
    assert.equal(judgeComparison(row, BUDGET).status, "slower-within-budget");
    assert.equal(
      judgeComparison(row, { ...BUDGET, budgetMs: 10, budgetPct: 5 }).status,
      "slower-within-budget",
    );
  });

  it("does not fail a large median delta whose interval includes zero", () => {
    const noisyHead = [
      700, 1500, 900, 1400, 820, 1300, 1250, 760, 1350, 990, 1100, 1200,
    ];
    const row = comparison("switch", "first", BASE, noisyHead);
    assert.ok(row.delta > BUDGET.budgetMs);
    assert.ok(row.low <= 0);
    assert.equal(judgeComparison(row, BUDGET).status, "same");
  });

  it("fails when the head loses actions the base completed", () => {
    const row = comparison("open", "first", BASE, BASE.slice(0, 6), {
      b: BASE.length,
    });
    const judgement = judgeComparison(row, BUDGET);
    assert.equal(judgement.status, "fail");
    assert.match(judgement.reason, /head finished 6 of 12/);
  });

  it("reports no data for an unbudgeted metric with too few samples", () => {
    const row = comparison("open", "first", [100, 110], [100, 120]);
    assert.equal(judgeComparison(row, null).status, "no-data");
  });

  it("is inconclusive when a budgeted metric has too few samples", () => {
    const row = comparison("open", "first", [100, 110], [100, 120]);
    assert.equal(judgeComparison(row, BUDGET).status, "inconclusive");
  });

  it("is inconclusive when a probe broke both variants alike", () => {
    const report = {
      rounds: 8,
      cpuThrottle: 4,
      viewport: "1600,1000",
      comparisons: [
        comparison("switch", "first", BASE, BASE),
        comparison("open", "first", [], [], { a: 32, b: 32 }),
      ],
    };
    const budgets = {
      cpuThrottle: 4,
      metrics: { "switch first": BUDGET, "open first": BUDGET },
    };
    const evaluation = evaluateBudgets(report, budgets);
    assert.equal(evaluation.rows[1].status, "inconclusive");
    assert.equal(evaluation.verdict, "INCONCLUSIVE");
    assert.ok(
      evaluation.inconclusive.some((line) => line.includes("open first")),
    );
    const markdown = renderMarkdown({
      evaluation,
      base: { ref: "origin/main", sha: "a".repeat(40) },
      head: { ref: "HEAD", sha: "b".repeat(40) },
      report,
    });
    assert.match(markdown, /check: INCONCLUSIVE/);
    assert.match(markdown, /0\/32, 0\/32 \| \*\*INCONCLUSIVE\*\*/);
  });

  it("is inconclusive when a budgeted metric was not measured or no round ran", () => {
    const budgets = {
      cpuThrottle: 4,
      metrics: { "switch first": BUDGET, "open first": BUDGET },
    };
    const missing = evaluateBudgets(
      {
        rounds: 6,
        cpuThrottle: 4,
        viewport: "1600,1000",
        comparisons: [comparison("switch", "first", BASE, BASE)],
      },
      budgets,
    );
    assert.equal(missing.verdict, "INCONCLUSIVE");
    assert.ok(
      missing.inconclusive.includes(
        "open first has a budget but was not measured.",
      ),
    );
    const empty = evaluateBudgets(
      { rounds: 0, cpuThrottle: 4, viewport: "1600,1000", comparisons: [] },
      { cpuThrottle: 4, metrics: {} },
    );
    assert.equal(empty.verdict, "INCONCLUSIVE");
  });

  it("warns on a ceiling only at the throttle the ceilings are set for", () => {
    const report = {
      rounds: 6,
      cpuThrottle: 4,
      viewport: "1600,1000",
      comparisons: [comparison("switch", "first", BASE, BASE)],
    };
    const budgets = {
      cpuThrottle: 4,
      metrics: { "switch first": { ...BUDGET, ceilingMs: 900 } },
    };
    const evaluation = evaluateBudgets(report, budgets);
    assert.equal(evaluation.verdict, "PASS");
    assert.equal(evaluation.rows[0].ceilingExceeded, true);
    assert.ok(evaluation.warnings.some((line) => line.includes("ceiling")));
    const unthrottled = evaluateBudgets({ ...report, cpuThrottle: 1 }, budgets);
    assert.equal(unthrottled.rows[0].ceilingExceeded, false);
  });

  it("fails the run when any metric fails and renders it as markdown", () => {
    const report = {
      rounds: 6,
      cpuThrottle: 4,
      viewport: "1600,1000",
      comparisons: [
        comparison("switch", "first", BASE, BASE),
        comparison("switch", "revisit", BASE, shift(BASE, 120)),
      ],
    };
    const budgets = {
      cpuThrottle: 4,
      metrics: {
        "switch first": BUDGET,
        "switch revisit": { ...BUDGET, label: "Thread switch, revisit" },
        "open first": BUDGET,
      },
    };
    const evaluation = evaluateBudgets(report, budgets);
    assert.equal(evaluation.verdict, "FAIL");
    assert.ok(
      evaluation.inconclusive.includes(
        "open first has a budget but was not measured.",
      ),
    );
    const markdown = renderMarkdown({
      evaluation,
      base: { ref: "origin/main", sha: "a".repeat(40) },
      head: { ref: "HEAD", sha: "b".repeat(40) },
      report,
    });
    assert.ok(markdown.startsWith(REPORT_MARKER));
    assert.match(markdown, /check: FAIL/);
    assert.match(
      markdown,
      /\| Thread switch, revisit \| 1000 \| 1120 \| \+120 \(\+12%\)/,
    );
  });
});
