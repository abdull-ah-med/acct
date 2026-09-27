import fs from "node:fs";
import path from "node:path";

/** Native PATH fixture: no .cmd/shebang execution assumptions on Windows.
 * https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows
 * https://nodejs.org/api/cli.html#node_optionsoptions
 * The preload only intercepts the copied executable, never the real acct Node.
 */
export function installNativeCommand(
  binDir: string,
  name: string,
  source: string,
): { executable: string; env: NodeJS.ProcessEnv } {
  fs.mkdirSync(binDir, { recursive: true });
  const executable = path.join(binDir, process.platform === "win32" ? `${name}.exe` : name);
  const script = path.join(binDir, `${name}.cjs`);
  const bootstrap = path.join(binDir, `${name}-bootstrap.cjs`);
  fs.copyFileSync(process.execPath, executable, fs.constants.COPYFILE_FICLONE);
  fs.chmodSync(executable, 0o755);
  fs.writeFileSync(script, source);
  fs.writeFileSync(bootstrap, `
const path = require("node:path");
const target = ${JSON.stringify(executable)};
const actual = process.execPath;
const same = process.platform === "win32"
  ? actual.toLowerCase() === target.toLowerCase()
  : actual === target;
if (same) {
  const command = path.basename(process.argv[1] || "");
  process.argv = [process.execPath, ${JSON.stringify(script)}, command, ...process.argv.slice(2)];
  require(${JSON.stringify(script)});
  process.exit(0);
}
`);
  return {
    executable,
    env: { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require ${JSON.stringify(bootstrap)}`.trim() },
  };
}
