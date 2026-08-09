import fs from "node:fs";
import path from "node:path";
import { acctConfigDir } from "../config/store.js";
import { ensureAcctDir } from "../util/fs-safe.js";

/**
 * Optional strongest guarantee: shims on PATH that route git/gh through acct exec.
 */
export function wrapBinDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(acctConfigDir(env), "wrap-bin");
}

/**
 * Render Windows git.cmd that skips the shim's own directory when resolving
 * the real git via `where`, avoiding infinite self-recursion when wrap-bin
 * is prepended to PATH.
 * Cite: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/where
 */
export function renderGitCmd(): string {
  return [
    "@echo off",
    "setlocal EnableExtensions",
    'set "SELF=%~dp0"',
    "set \"REALGIT=\"",
    "for /f \"delims=\" %%i in ('where git 2^>nul') do (",
    "  echo %%i | findstr /I /C:\"%SELF%\" >nul",
    "  if errorlevel 1 (",
    "    set \"REALGIT=%%i\"",
    "    goto found",
    "  )",
    ")",
    ":found",
    "if not defined REALGIT (",
    "  echo acct: real git not found on PATH",
    "  exit /b 1",
    ")",
    "\"%REALGIT%\" %*",
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

export function installWrapShims(env: NodeJS.ProcessEnv = process.env): string {
  const dir = wrapBinDir(env);
  ensureAcctDir(dir);

  if (process.platform === "win32") {
    fs.writeFileSync(path.join(dir, "gh.cmd"), `@echo off\r\nacct exec gh %*\r\n`);
    fs.writeFileSync(path.join(dir, "git.cmd"), renderGitCmd());
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
