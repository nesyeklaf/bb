import { execFile, spawn } from "node:child_process";
import { expect, it } from "vitest";

const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const cim = (pid: number) =>
  "Get-CimInstance Win32_Process -Filter 'ProcessId = " + pid + "' | ForEach-Object { $_.CommandLine; $_.CreationDate }";

function run(label: string, file: string, args: string[], stdin: "pipe" | "ignore" = "pipe"): Promise<void> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: [stdin, "pipe", "pipe"], windowsHide: true });
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
  await Promise.all([
    run("ps-cim-stdin-ignore", ps, [...base, "-Command", cim(pid)], "ignore"),
    run("ps-cim-inputformat-none", ps, [...base, "-InputFormat", "None", "-Command", cim(pid)]),
    run("ps-wmiobject", ps, [...base, "-Command", "Get-WmiObject Win32_Process -Filter 'ProcessId = " + pid + "' | ForEach-Object { $_.CommandLine; $_.CreationDate }"]),
    run("pwsh7-cim", pwsh, [...base, "-Command", cim(pid)]),
    run("ps-getprocess", ps, [...base, "-Command", "(Get-Process -Id " + pid + ").StartTime.ToString('o')"]),
    run("ps-cim-nofilter-select", ps, [...base, "-Command", "Get-CimInstance -ClassName Win32_Process | Select-Object -First 2 ProcessId"]),
    run("ps-cim-os", ps, [...base, "-Command", "(Get-CimInstance Win32_OperatingSystem).Caption"]),
    run("cmd-wmic", "cmd.exe", ["/c", "wmic process where processid=" + pid + " get commandline,creationdate"]),
  ]);
  target.kill();
  expect(true).toBe(true);
}, 120_000);
