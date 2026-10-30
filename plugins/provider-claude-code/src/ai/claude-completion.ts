import os from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { translateMissingClaudeCliError } from "../bridge/missing-cli-error.js";
import { getClaudeProviderHealth } from "../bridge/provider-maintenance.js";
import { resolveClaudeCodeExecutable } from "../bridge/session-options.js";
import type {
  ClaudeAiCompleteInput,
  ClaudeAiStatus,
  ClaudeAiTextResult,
} from "./host-contract.js";

const SIGN_IN_MESSAGE = "Run `claude` on the primary machine to sign in";

export async function completeWithClaude(
  input: ClaudeAiCompleteInput,
  signal: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const stop = (): void => controller.abort(signal.reason);
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  timer.unref();
  const env = process.env;
  try {
    const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable({ env });
    const session = query({
      prompt: input.prompt,
      options: {
        abortController: controller,
        cwd: os.tmpdir(),
        env,
        model: input.model,
        maxTurns: 1,
        tools: [],
        persistSession: false,
        settingSources: [],
        ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
      },
    });
    for await (const message of session) {
      if (message.type !== "result") continue;
      if (message.subtype === "success" && !message.is_error) {
        return message.result;
      }
      throw new Error(
        message.subtype === "success"
          ? message.result
          : `Claude Code stopped: ${message.subtype}`,
      );
    }
    throw new Error("Claude Code returned no result");
  } catch (error) {
    throw translateMissingClaudeCliError(error);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

export async function completeWithClaudeResult(
  input: ClaudeAiCompleteInput,
  signal: AbortSignal,
): Promise<ClaudeAiTextResult> {
  try {
    return { ok: true, text: await completeWithClaude(input, signal) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readClaudeAiStatus(): Promise<ClaudeAiStatus> {
  const result = await getClaudeProviderHealth();
  if (!result.supported) {
    return { ready: false, message: "Claude Code health is unavailable" };
  }
  switch (result.health.status) {
    case "ready":
      return { ready: true };
    case "not_installed":
      return { ready: false, message: "Claude Code is not installed" };
    case "unauthenticated":
    case "expired":
      return { ready: false, message: SIGN_IN_MESSAGE };
    default:
      return {
        ready: false,
        message: result.health.statusMessage ?? "Claude Code status unknown",
      };
  }
}
