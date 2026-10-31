import { execFile, spawn } from "node:child_process";
import { expect, it } from "vitest";
import { execHostFile } from "../src/host-process.js";

const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const query = (pid: number) =>
  "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "' | ForEach-Object { @{ command = $_.CommandLine; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }";

function raw(label: string, script: string): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = execFile(ps, ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 20_000, windowsHide: true }, (error, stdout) => {
      process.stderr.write("DIAGV " + label + " " + (Date.now() - start) + "ms err=" + String(error)?.slice(0, 80) + " out=" + stdout.slice(0, 120).replace(/\s+/g, " ") + "\n");
      resolve();
    });
    child.stdin?.end();
  });
}

async function host(label: string, script: string): Promise<void> {
  const start = Date.now();
  try {
    const pending = execHostFile(ps, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
    pending.child.stdin?.end();
    const { stdout } = await pending;
    process.stderr.write("DIAGV " + label + " " + (Date.now() - start) + "ms out=" + stdout.slice(0, 120).replace(/\s+/g, " ") + "\n");
  } catch (error) {
    process.stderr.write("DIAGV " + label + " " + (Date.now() - start) + "ms FAIL " + String(error).slice(0, 60) + "\n");
  }
}

it.runIf(process.platform === "win32")("diag", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await raw("raw-trivial", "1");
  await host("host-trivial", "1");
  await raw("raw-cim-self", query(process.pid));
  await host("host-cim-self", query(process.pid));
  await raw("raw-cim-child", query(child.pid ?? 0));
  await host("host-cim-child", query(child.pid ?? 0));
  child.kill();
  expect(true).toBe(true);
}, 150_000);
