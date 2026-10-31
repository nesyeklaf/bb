import { execHostFile } from "./host-process.js";
import path from "node:path";

const execFileAsync = execHostFile;

export interface ProcessIdentity {
  command: string | null;
  startedAt: number | null;
}

export async function readProcessIdentity(
  pid: number,
): Promise<ProcessIdentity | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32") return readWindowsProcess(pid);
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-p", String(pid), "-o", "etime=", "-o", "command="],
      {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const match = stdout.trim().match(/^(\S+)\s+([\s\S]+)$/u);
    if (match === null) return null;
    const elapsed = parseElapsedSeconds(match[1] ?? "");
    return {
      command: match[2] ?? null,
      startedAt: elapsed === null ? null : Date.now() - elapsed * 1_000,
    };
  } catch {
    return null;
  }
}

const WINDOWS_READ_ATTEMPTS = 3;
const WINDOWS_READ_TIMEOUT_MS = 10_000;

async function readWindowsProcess(
  pid: number,
): Promise<ProcessIdentity | null> {
  for (let attempt = 0; attempt < WINDOWS_READ_ATTEMPTS; attempt++) {
    const identity = await readWindowsProcessOnce(pid);
    if (identity !== null) return identity;
  }
  return null;
}

async function readWindowsProcessOnce(
  pid: number,
): Promise<ProcessIdentity | null> {
  try {
    const pending = execFileAsync(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
          `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | ForEach-Object { @{ command = $_.CommandLine; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`,
        ].join("; "),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: WINDOWS_READ_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      },
    );
    pending.child.stdin?.end();
    const { stdout } = await pending;
    process.stderr.write(`DIAG stdout ${stdout}\n`);
    const value: unknown = JSON.parse(stdout);
    if (
      typeof value !== "object" ||
      value === null ||
      !("command" in value) ||
      !("startedAt" in value) ||
      (typeof value.command !== "string" && value.command !== null) ||
      typeof value.startedAt !== "number" ||
      !Number.isFinite(value.startedAt)
    )
      return null;
    return { command: value.command, startedAt: value.startedAt };
  } catch (error) {
    process.stderr.write(`DIAG readWindowsProcessOnce ${String(error)} ${JSON.stringify(error)}\n`);
    return null;
  }
}

export function parseElapsedSeconds(rawElapsed: string): number | null {
  const match = rawElapsed
    .trim()
    .match(/^(?:(?:(\d+)-)?(\d+):)?(\d{1,2}):(\d{2})$/u);
  if (match === null) {
    return null;
  }
  const days = Number(match[1] ?? "0");
  const hours = Number(match[2] ?? "0");
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}
