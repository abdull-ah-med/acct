import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acctConfigDir, hooksDir } from "../config/store.js";
import { canonicalPath, pathIsPrefix } from "../util/paths.js";
import { resolveGitContext } from "../resolution/gitContext.js";
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
export function repoHooksDir(
  commonDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const digest = createHash("sha256")
    .update(canonicalPath(commonDir))
    .digest("hex")
    .slice(0, 16);
  return path.join(acctConfigDir(env), "hooks-repo", digest);
}
export function isAcctHooksDir(
  target: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    pathIsPrefix(hooksDir(env), target) ||
    pathIsPrefix(path.join(acctConfigDir(env), "hooks-repo"), target)
  );
}

/** https://git-scm.com/docs/githooks: cwd, argv and stdin belong to the hook contract. */
export function renderHookScript(
  hook: string,
  node: string,
  acctJs: string,
  dir = hooksDir(),
  chain = "",
  acctDir = path.dirname(dir),
): string {
  const checked = ["pre-commit", "pre-merge-commit", "pre-push"].includes(hook);
  const bufferStdin = `umask 077
stdin_file=$(mktemp "\${TMPDIR:-/tmp}/acct-hook.XXXXXX") || exit 1
trap 'rm -f "$stdin_file"' EXIT HUP INT TERM
cat > "$stdin_file" || exit 1`;
  const stdin = ["pre-push", "post-rewrite", "reference-transaction"].includes(
    hook,
  );
  const ownGlobal = shellQuote(path.join(acctDir, "hooks"));
  const ownRepos = shellQuote(path.join(acctDir, "hooks-repo"));
  return `#!/bin/sh
# acct managed hook v3
${hook === "pre-push" ? bufferStdin : ""}
${checked ? `${shellQuote(node)} ${shellQuote(acctJs)} hook-run ${hook} "$@"${hook === "pre-push" ? ' < "$stdin_file"' : ""} || exit $?` : ""}
${
  chain
    ? `target=${shellQuote(chain)}`
    : `if [ -d .git ] && { [ -z "\${GIT_DIR:-}" ] || [ "$GIT_DIR" = .git ] || [ "$GIT_DIR" = "$PWD/.git" ]; }; then
  target=.git/hooks
else
  common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
  target="$common_dir/hooks"
fi
case "$target" in
  ${ownGlobal}|${ownGlobal}/*|${ownRepos}|${ownRepos}/*) exit 0 ;;
esac`
}
[ -x "$target/${hook}" ] || exit 0
${stdin && hook !== "pre-push" ? bufferStdin : ""}
${stdin ? 'exec 0< "$stdin_file"\nrm -f "$stdin_file"\ntrap - EXIT HUP INT TERM' : ""}
exec "$target/${hook}" "$@"
`;
}
export function installHooks(
  env: NodeJS.ProcessEnv = process.env,
  opts: { repo?: boolean; cwd?: string } = {},
): string {
  const cwd = opts.cwd ?? process.cwd();
  const context = opts.repo ? resolveGitContext(cwd, env) : null;
  if (opts.repo && !context)
    throw new Error("acct install --repo requires a Git repository");
  const dir = context ? repoHooksDir(context.commonDir, env) : hooksDir(env);
  const read = (key: string): string => {
    try {
      return execFileSync(
        "git",
        ["config", opts.repo ? "--local" : "--global", "--get", key],
        {
          cwd,
          env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trimEnd();
    } catch {
      return "";
    }
  };
  let chain = read("core.hooksPath");
  if (chain && isAcctHooksDir(path.resolve(cwd, chain), env))
    chain = read("acct.chainHooksPath");
  if (chain && isAcctHooksDir(path.resolve(cwd, chain), env)) chain = "";
  ensureAcctDir(dir);
  const { node, acctJs } = resolveAcctCliPaths(env);
  for (const hook of CLIENT_HOOKS) {
    const file = path.join(dir, hook);
    fs.writeFileSync(
      file,
      renderHookScript(hook, node, acctJs, dir, chain, acctConfigDir(env)),
      {
        mode: 0o755,
      },
    );
    fs.chmodSync(file, 0o755);
  }
  failAt("hooks", env);
  return dir;
}
