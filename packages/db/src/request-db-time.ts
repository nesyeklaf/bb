import { AsyncLocalStorage } from "node:async_hooks";

export interface DbTimeAccumulator {
  durationMs: number;
  queryCount: number;
}

const accumulators = new AsyncLocalStorage<DbTimeAccumulator>();

let activeOperationDepth = 0;

export function createDbTimeAccumulator(): DbTimeAccumulator {
  return { durationMs: 0, queryCount: 0 };
}

export function runWithDbTimeAccumulator<T>(
  accumulator: DbTimeAccumulator,
  work: () => T,
): T {
  return accumulators.run(accumulator, work);
}

export function beginDbOperation(): void {
  activeOperationDepth += 1;
}

export function endDbOperation(durationMs: number): void {
  activeOperationDepth -= 1;
  if (activeOperationDepth > 0) {
    return;
  }
  const accumulator = accumulators.getStore();
  if (accumulator === undefined) {
    return;
  }
  accumulator.durationMs += durationMs;
  accumulator.queryCount += 1;
}
