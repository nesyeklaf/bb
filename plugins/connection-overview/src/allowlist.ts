import { normalizeHost } from "./classify.js";

export const BUILTIN_ALLOWED_HOSTS = [
  "api.anthropic.com",
  "console.anthropic.com",
  "claude.ai",
  "platform.claude.com",
  "statsig.anthropic.com",
  "mcp-proxy.anthropic.com",
  "api.openai.com",
  "auth.openai.com",
  "chatgpt.com",
  "ab.chatgpt.com",
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
] as const;

export const INFERENCE_PROCESSES = new Set([
  "claude",
  "codex",
  "git",
  "git-remote-http",
  "git-remote-https",
  "gh",
  "ssh",
]);

export function parseExtraHosts(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map(normalizeHost)
    .filter((host) => host.length > 0);
}

export function validateExtraHosts(value: string): string | null {
  for (const host of parseExtraHosts(value))
    if (
      !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
        host,
      )
    )
      return `Not an exact host name: ${host}`;
  return null;
}

export function allowedHostSet(extra: string): Set<string> {
  return new Set([...BUILTIN_ALLOWED_HOSTS, ...parseExtraHosts(extra)]);
}

export function parseResolvConf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => /^\s*nameserver\s+(\S+)/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined);
}
