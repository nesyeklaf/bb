// The sandy CLI of the merged SANDY plugin (sandy/work): every part's commands sit under `sandy work <part>`.
export type WorkCliPart = "delegate" | "track" | "workflows-plus";

export function workCliArgs(part: WorkCliPart, ...args: string[]): string[] {
  return ["work", part, ...args];
}
