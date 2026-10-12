import fs from "node:fs";
import path from "node:path";
import { acctConfigDir } from "../util/paths.js";

function physical(p: string): string {
  try {
    return fs.realpathSync.native(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}
function equal(a: string, b: string): boolean {
  return process.platform === "darwin" || process.platform === "win32"
    ? physical(a).toLowerCase() === physical(b).toLowerCase()
    : physical(a) === physical(b);
}
export function withoutWrapPath(env: NodeJS.ProcessEnv): string {
  const wrap = path.join(acctConfigDir(env), "wrap-bin");
  return (env.PATH ?? "")
    .split(path.delimiter)
    .filter((p) => !equal(p || ".", wrap))
    .join(path.delimiter);
}
/** Resolve outside acct's wrapper, including symlinks to the wrapper.
 * https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
 */
export function resolveRealGh(env: NodeJS.ProcessEnv = process.env): string {
  const wrap = path.join(acctConfigDir(env), "wrap-bin");
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")
      : [""];
  for (const dir of withoutWrapPath(env).split(path.delimiter)) {
    for (const ext of extensions) {
      const candidate = path.resolve(dir || ".", "gh" + ext.toLowerCase());
      try {
        const real = physical(candidate);
        if (equal(path.dirname(real), wrap)) continue;
        if (!fs.statSync(real).isFile()) continue;
        fs.accessSync(
          candidate,
          process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
        );
        const header = fs.readFileSync(real).subarray(0, 4096).toString();
        if (/acct managed gh shim|exec[^\n]*acct\.js[^\n]*exec gh/.test(header))
          continue;
        return candidate;
      } catch {
        /* next executable */
      }
    }
  }
  throw new Error("real gh not found on PATH (excluding acct wrap-bin)");
}
