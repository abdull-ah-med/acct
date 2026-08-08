import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { hooksDir } from "../config/store.js";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolve absolute paths to node + acct.js for hooks (I11b).
 * Bare `acct` on PATH is unreliable under core.hooksPath.
 * Cite: https://git-scm.com/docs/githooks — hooks are executables; PATH not guaranteed.
 */
export function resolveAcctCliPaths(
  env: NodeJS.ProcessEnv = process.env,
): { node: string; acctJs: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const acctJs = path.resolve(here, "..", "..", "bin", "acct.js");
  let node = process.execPath;
  if (env.ACCT_NODE_PATH) {
    node = env.ACCT_NODE_PATH;
  } else {
    try {
      const which = process.platform === "win32" ? "where" : "which";
      const found = execFileSync(which, ["node"], {
        encoding: "utf8",
        env,
      })
        .trim()
        .split(/\r?\n/)[0];
      if (found) node = found;
    } catch {
      // keep process.execPath
    }
  }
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
  fs.mkdirSync(dir, { recursive: true });
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
      `@echo off\r\n"${node}" "${acctJs}" hook-run ${hook}\r\n`;
    fs.writeFileSync(preCommit + ".cmd", cmd("pre-commit"));
    fs.writeFileSync(prePush + ".cmd", cmd("pre-push"));
  }

  return dir;
}
