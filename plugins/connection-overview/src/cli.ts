import {
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { ConnectionState } from "./classify.js";
import { evaluateStatus, type SourceHealth } from "./coverage.js";
import { parseSince } from "./since.js";
import type { DestinationRow, Store } from "./store.js";

const SINCE = {
  type: "string",
  description:
    "Window start: a duration (30m, 24h, 7d) or an ISO time; default 24h",
} as const;
const JSON_FLAG = { type: "boolean", description: "Print JSON" } as const;
const RED = { type: "boolean", description: "Only red rows" } as const;

export const NOT_MEASURED = [
  "hosts that are not Linux",
  "remote and sandbox environments",
  "unreadable pids",
  "connections shorter than about 1 s",
  "unconnected UDP (sendto without connect)",
  "bb CLI processes started outside the server and daemon trees",
  "the clients themselves (browser, desktop, phone)",
];

function failure(error: unknown): PluginCliResult {
  return {
    exitCode: 1,
    stderr: (error instanceof Error ? error.message : String(error)) + "\n",
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function formatRows(rows: readonly DestinationRow[]): string {
  if (rows.length === 0) return "No rows in this window.\n";
  const lines = rows.map((row) => {
    const target = row.hostname ?? row.ip;
    const processes = [
      ...new Set(row.attributions.map((entry) => entry.comm)),
    ].join(",");
    return [
      row.state.toUpperCase().padEnd(12),
      row.direction.padEnd(4),
      `${row.proto}/${row.port}`.padEnd(10),
      target.padEnd(40),
      String(row.count).padStart(6),
      iso(row.lastSeen),
      row.sourceId,
      processes,
      row.reason,
    ].join("  ");
  });
  return lines.join("\n") + "\n";
}

export function registerCli(
  bb: BbPluginApi,
  deps: { store: Store; health: () => SourceHealth[]; now?: () => number },
) {
  const now = deps.now ?? Date.now;
  function listCommand(direction: "out" | "in", summary: string) {
    return cliCommand({
      summary,
      options: { since: SINCE, red: RED, json: JSON_FLAG },
      run: (input) => {
        try {
          const since = parseSince(input.options.since, now());
          const states: ConnectionState[] | undefined = input.options.red
            ? ["red"]
            : undefined;
          const rows = deps.store
            .list({ since, ...(states === undefined ? {} : { states }) })
            .filter((row) =>
              direction === "in"
                ? row.direction === "in"
                : row.direction !== "in",
            );
          return {
            exitCode: 0,
            stdout: input.options.json
              ? JSON.stringify(rows, null, 2) + "\n"
              : formatRows(rows),
          };
        } catch (error) {
          return failure(error);
        }
      },
    });
  }
  bb.cli.register(
    defineCli({
      name: "connections",
      summary:
        "Show where bb connects to and whether the measurement is healthy",
      root: cliCommand({
        summary: "Show connection commands",
        run: (input) => ({ exitCode: 0, stdout: input.help }),
      }),
      commands: {
        list: listCommand("out", "List outgoing destinations in a window"),
        incoming: listCommand("in", "List incoming peers in a window"),
        status: cliCommand({
          summary:
            "Exit 0 when coverage is healthy and nothing is red, 1 when coverage is unhealthy, 2 when red rows exist",
          options: { since: SINCE, json: JSON_FLAG },
          run: (input) => {
            try {
              const since = parseSince(input.options.since, now());
              const rows = deps.store.list({ since });
              const sources = deps.health();
              const gaps = deps.store.gaps(since);
              const result = evaluateStatus({
                sources,
                gaps,
                redCount: rows.filter((row) => row.state === "red").length,
                capReached: deps.store.capReached(),
              });
              const counts: Record<string, number> = {};
              for (const row of rows)
                counts[row.state] = (counts[row.state] ?? 0) + 1;
              const report = {
                exitCode: result.exitCode,
                since: iso(since),
                problems: result.problems,
                counts,
                sources,
                gaps,
                notMeasured: NOT_MEASURED,
              };
              const text = [
                `Window since ${report.since}: exit ${result.exitCode}`,
                ...result.problems.map((problem) => `  problem: ${problem}`),
                `  rows: ${
                  Object.entries(counts)
                    .map(([state, count]) => `${state} ${count}`)
                    .join(", ") || "none"
                }`,
                ...sources.map(
                  (source) =>
                    `  source ${source.label}: collector ${source.collector}, transport ${source.transport}, ${source.treeSize} processes, ${source.unreadablePids} unreadable${source.error === null ? "" : ", error " + source.error}`,
                ),
                `  not measured: ${NOT_MEASURED.join("; ")}`,
              ].join("\n");
              return {
                exitCode: result.exitCode,
                stdout: input.options.json
                  ? JSON.stringify(report, null, 2) + "\n"
                  : text + "\n",
              };
            } catch (error) {
              return failure(error);
            }
          },
        }),
      },
    }),
  );
}
