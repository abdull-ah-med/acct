import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
let launcher;

/** A fixture executable must forward flags before Node parses them. A copied
 * node.exe with NODE_OPTIONS cannot intercept --version or --help.
 * https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows
 */
function windowsLauncher() {
  if (launcher) return launcher;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acct-fixture-launcher-"));
  process.once("exit", () => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, "launcher.cs");
  launcher = path.join(root, "launcher.exe");
  fs.writeFileSync(source, String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
class Launcher {
  static string Quote(string value) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
      else { result.Append('\\', slashes); result.Append(c); }
      slashes = 0;
    }
    result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
  }
  static int Main(string[] args) {
    string node = Environment.GetEnvironmentVariable("ACCT_TEST_NODE_NATIVE");
    if (String.IsNullOrEmpty(node)) return 2;
    string script = Path.ChangeExtension(Assembly.GetExecutingAssembly().Location, ".cjs");
    var command = new StringBuilder(Quote(script));
    foreach (string arg in args) command.Append(" ").Append(Quote(arg));
    var info = new ProcessStartInfo(node, command.ToString()); info.UseShellExecute = false;
    using (var child = Process.Start(info)) { child.WaitForExit(); return child.ExitCode; }
  }
}
`);
  const system = process.env.SystemRoot || "C:\\Windows";
  const compiler = ["Framework64", "Framework"].map(dir => path.join(system, "Microsoft.NET", dir, "v4.0.30319", "csc.exe")).find(file => fs.existsSync(file));
  if (!compiler) throw new Error("Windows fixture requires the .NET Framework C# compiler");
  const result = spawnSync(compiler, ["/nologo", "/target:exe", `/out:${launcher}`, source], {encoding: "utf8"});
  if (result.status !== 0) throw new Error(`Windows fixture compilation failed: ${result.stdout || result.stderr}`);
  return launcher;
}

export function installNativeCommand(binDir, name, source) {
  fs.mkdirSync(binDir, {recursive: true});
  const executable = path.join(binDir, process.platform === "win32" ? `${name}.exe` : name);
  const script = path.join(binDir, `${name}.cjs`);
  fs.writeFileSync(script, source);
  if (process.platform === "win32") {
    fs.copyFileSync(windowsLauncher(), executable);
    return {executable, env: {ACCT_TEST_NODE_NATIVE: process.execPath}};
  }
  const q = value => "'" + value.replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(executable, `#!/bin/sh\nexec ${q(process.execPath)} ${q(script)} "$@"\n`, {mode: 0o755});
  return {executable, env: {}};
}
