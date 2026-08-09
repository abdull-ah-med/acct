import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hooksDir } from "../config/store.js";
import { ensureAcctDir } from "../util/fs-safe.js";
import { cmdEscapePath } from "../util/cmd-escape.js";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolve absolute paths to node + acct.js for hooks (I11b).
 * Always prefer process.execPath — never trust `which node` from PATH
 * (privilege escalation via rogue node earlier on PATH).
 * Override only via explicit ACCT_NODE_PATH (cross-arch scenarios).
 * Cite: https://git-scm.com/docs/githooks — hooks are executables; PATH not guaranteed.
 */
export function resolveAcctCliPaths(
  env: NodeJS.ProcessEnv = process.env,
): { node: string; acctJs: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const acctJs = path.resolve(here, "..", "..", "bin", "acct.js");
  const node = env.ACCT_NODE_PATH?.trim() || process.execPath;
  return { node, acctJs };
}

export function renderHookScript(
  hook: "pre-commit" | "pre-push",
  node: string,
  acctJs: string,
): string {
  return `#!/bin/sh
# acct managed ${hook} — absolute paths (I11b); do not rely on PATH
exec ${shellQuote(node)} ${shellQuote(acctJs)} hook-run ${hook}
`;
}

export function installHooks(env: NodeJS.ProcessEnv = process.env): string {
  const dir = hooksDir(env);
  ensureAcctDir(dir);
  const { node, acctJs } = resolveAcctCliPaths(env);
  const preCommit = path.join(dir, "pre-commit");
  const prePush = path.join(dir, "pre-push");
  fs.writeFileSync(preCommit, renderHookScript("pre-commit", node, acctJs), {
    mode: 0o755,
  });
  fs.writeFileSync(prePush, renderHookScript("pre-push", node, acctJs), {
    mode: 0o755,
  });

  if (process.platform === "win32") {
    const cmd = (hook: string) =>
      `@echo off\r\n"${cmdEscapePath(node)}" "${cmdEscapePath(acctJs)}" hook-run ${hook}\r\n`;
    fs.writeFileSync(preCommit + ".cmd", cmd("pre-commit"));
    fs.writeFileSync(prePush + ".cmd", cmd("pre-push"));
  }

  return dir;
}
