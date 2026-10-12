import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalPath } from "../util/paths.js";
import { hooksDir } from "../config/store.js";
import { repoHooksDir } from "../enforce/hooks.js";
import { resolveGitContext } from "../resolution/gitContext.js";
import { ghActiveLogin } from "../gh/env.js";
export function activeHook(
  cwd: string,
  env: NodeJS.ProcessEnv,
  hook = "pre-commit",
): { active: boolean; reason: string } {
  try {
    const dir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
      { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    const context = resolveGitContext(cwd, env);
    const expected = [
      hooksDir(env),
      ...(context ? [repoHooksDir(context.commonDir, env)] : []),
    ];
    if (
      !expected.some((target) => canonicalPath(dir) === canonicalPath(target))
    )
      return {
        active: false,
        reason: `acct hooks not active in this repo (core.hooksPath=${dir}); run acct install --repo`,
      };
    const file = path.join(dir, hook);
    if (!fs.readFileSync(file, "utf8").includes("# acct managed hook v3"))
      return { active: false, reason: "stale hook; run acct install" };
    fs.accessSync(file, fs.constants.X_OK);
    return { active: true, reason: "active v3 hook" };
  } catch {
    return {
      active: false,
      reason: "hook absent or not executable; run acct install",
    };
  }
}
export function shellStartup(env: NodeJS.ProcessEnv): string {
  const shell = path
    .basename(env.SHELL ?? "zsh")
    .toLowerCase()
    .replace(/\.exe$/, "");
  if (shell === "bash") return 'eval "$(acct hook bash)"  # add to ~/.bashrc';
  if (shell === "fish")
    return "acct hook fish | source  # add to ~/.config/fish/config.fish";
  if (shell === "pwsh" || shell === "powershell")
    return "Invoke-Expression (& acct hook powershell | Out-String)  # add to $PROFILE";
  return 'eval "$(acct hook zsh)"  # add to ~/.zshrc';
}
export function shellHookWarning(
  host: string,
  env: NodeJS.ProcessEnv,
): string | null {
  if (env.ACCT_SHELL_HOOK) return null;
  return `shell hook not loaded in this shell — raw gh uses gh's global account (${ghActiveLogin(host, env) ?? "unknown"}); ${shellStartup(env)}`;
}
