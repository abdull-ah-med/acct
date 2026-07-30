import fs from "node:fs";
import path from "node:path";
import { acctConfigDir } from "../config/store.js";

/**
 * Optional strongest guarantee: shims on PATH that route git/gh through acct exec.
 */
export function wrapBinDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(acctConfigDir(env), "wrap-bin");
}

export function installWrapShims(env: NodeJS.ProcessEnv = process.env): string {
  const dir = wrapBinDir(env);
  fs.mkdirSync(dir, { recursive: true });

  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(dir, "gh.cmd"),
      `@echo off\r\nacct exec gh %*\r\n`,
    );
    fs.writeFileSync(
      path.join(dir, "git.cmd"),
      `@echo off\r\nREM Prefer real git for most ops; credential helper handles auth\r\nwhere /Q git && goto run\r\necho git not found\r\nexit /b 1\r\n:run\r\nfor /f "delims=" %%i in ('where git') do set REALGIT=%%i & goto found\r\n:found\r\n"%REALGIT%" %*\r\n`,
    );
  } else {
    const gh = `#!/bin/sh\nexec acct exec gh "$@"\n`;
    fs.writeFileSync(path.join(dir, "gh"), gh, { mode: 0o755 });
    // Do not shadow git by default — credential helper + hooks are enough.
    // Provide acct-git for explicit wrapping.
    const acctGit = `#!/bin/sh\nexec acct exec git "$@"\n`;
    fs.writeFileSync(path.join(dir, "acct-git"), acctGit, { mode: 0o755 });
  }

  return dir;
}

export function wrapPathExport(dir: string, powershell = false): string {
  if (powershell) {
    return `$env:Path = '${dir.replace(/'/g, "''")};' + $env:Path\n`;
  }
  return `export PATH='${dir.replace(/'/g, `'\\''`)}':"$PATH"\n`;
}
