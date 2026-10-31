import { spawn } from "node:child_process";
import { expect, it } from "vitest";

const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const cim = (pid: number) =>
  "Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "' | ForEach-Object { $_.CommandLine; $_.CreationDate }";

function run(label: string, file: string, args: string[], stdin: "pipe" | "ignore" = "pipe", env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: [stdin, "pipe", "pipe"], windowsHide: true, env });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 20_000);
    child.on("error", (e) => { out += "ERR " + e; });
    child.on("close", (code) => {
      clearTimeout(timer);
      process.stderr.write("DIAGW " + label + " " + (Date.now() - start) + "ms code=" + code + " out=" + out.slice(0, 160).replace(/\s+/g, " ") + "\n");
      resolve();
    });
    if (stdin === "pipe") child.stdin?.end();
  });
}

it.runIf(process.platform === "win32")("diag", async () => {
  const target = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const pid = target.pid ?? 0;
  const base = ["-NoProfile", "-NonInteractive"];
  const cleanEnv = { ...process.env, PSModulePath: "C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules" };
  await run("ps-psmodulepath-print", ps, [...base, "-Command", "$env:PSModulePath"]);
  await run("ps-wmisearcher", ps, [...base, "-Command", "([wmisearcher]\"select CommandLine,CreationDate from Win32_Process where ProcessId=" + pid + "\").Get() | ForEach-Object { $_.CommandLine; $_.CreationDate }"]);
  await run("ps-dotnet-starttime", ps, [...base, "-Command", "[System.Diagnostics.Process]::GetProcessById(" + pid + ").StartTime.ToString('o')"]);
  await run("ps-getprocess-cleanmodules", ps, [...base, "-Command", "(Get-Process -Id " + pid + ").StartTime.ToString('o')"], "pipe", cleanEnv);
  await run("ps-cim-cleanmodules", ps, [...base, "-Command", cim(pid)], "pipe", cleanEnv);
  await run("ps-getprocess-plain", ps, [...base, "-Command", "(Get-Process -Id " + pid + ").StartTime.ToString('o')"]);
  target.kill();
  expect(true).toBe(true);
}, 120_000);
