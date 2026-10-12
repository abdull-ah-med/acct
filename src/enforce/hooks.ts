import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hooksDir } from "../config/store.js";
import { ensureAcctDir } from "../util/fs-safe.js";
import { failAt } from "../util/transaction.js";

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
export function resolveAcctCliPaths(env: NodeJS.ProcessEnv = process.env): {
  node: string;
  acctJs: string;
} {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const acctJs = path.resolve(here, "..", "..", "bin", "acct.js");
  const node = env.ACCT_NODE_PATH?.trim() || process.execPath;
  return { node, acctJs };
}

export const CLIENT_HOOKS = [
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "post-index-change",
  "reference-transaction",
] as const;
/** https://git-scm.com/docs/githooks: cwd, argv and stdin belong to the hook contract. */
export function renderHookScript(
  hook: string,
  node: string,
  acctJs: string,
  dir = hooksDir(),
): string {
  const checked = [
    "pre-commit",
    "pre-merge-commit",
    "post-commit",
    "pre-push",
  ].includes(hook);
  const stdin = ["pre-push", "post-rewrite", "reference-transaction"].includes(
    hook,
  );
  return `#!/bin/sh
# acct managed hook v2
${stdin ? 'umask 077\nstdin_file=$(mktemp "${TMPDIR:-/tmp}/acct-hook.XXXXXX") || exit 1\ntrap \'rm -f "$stdin_file"\' EXIT HUP INT TERM\ncat > "$stdin_file" || exit 1' : ""}
${checked ? `${shellQuote(node)} ${shellQuote(acctJs)} hook-run ${hook} "$@"${stdin ? ' < "$stdin_file"' : ""} || exit $?` : ""}
target=$(git config --get acct.chainHooksPath) || target=""
if [ -z "$target" ]; then target="$(git rev-parse --git-common-dir)/hooks"; fi
if [ -d "$target" ] && [ "$(cd "$target" && pwd -P)" != ${shellQuote(dir)} ] && [ -x "$target/${hook}" ]; then
  ${stdin ? 'exec 0< "$stdin_file"\n  rm -f "$stdin_file"\n  trap - EXIT HUP INT TERM' : ""}
  exec "$target/${hook}" "$@"
fi
exit 0
`;
}
export function installHooks(env: NodeJS.ProcessEnv = process.env): string {
  const dir = hooksDir(env);
  ensureAcctDir(dir);
  const { node, acctJs } = resolveAcctCliPaths(env);
  for (const hook of CLIENT_HOOKS) {
    const file = path.join(dir, hook);
    fs.writeFileSync(file, renderHookScript(hook, node, acctJs, dir), {
      mode: 0o755,
    });
    fs.chmodSync(file, 0o755);
  }
  failAt("hooks", env);
  return dir;
}
