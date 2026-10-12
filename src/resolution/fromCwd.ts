import path from "node:path";
import { findLocalAcct, readLocalAcct, loadConfig } from "../config/store.js";
import { canonicalPath, pathIsPrefix } from "../util/paths.js";
import { resolveGitContext } from "./gitContext.js";
import { resolveProfile } from "./resolve.js";
import type { ResolveResult } from "../types.js";
export interface ResolveFromCwdOptions {
  forcedProfileId?: string;
  allowEnvProfile?: boolean;
}
export function resolveFromCwd(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveFromCwdOptions = {},
): ResolveResult {
  const config = loadConfig(env),
    gitContext = resolveGitContext(cwd, env);
  const anchor = gitContext?.workTree ?? canonicalPath(cwd);
  const localAcct = findLocalAcct(anchor);
  const result = resolveProfile({
    cwd: anchor,
    env,
    config,
    localAcct,
    ...options,
  });
  result.anchor = anchor;
  result.gitContext = gitContext;
  for (
    let dir = canonicalPath(cwd);
    dir !== anchor && pathIsPrefix(anchor, dir);
    dir = path.dirname(dir)
  ) {
    if (readLocalAcct(dir) != null) {
      result.ignoredLocalAcct = path.join(dir, ".acct");
      break;
    }
  }
  if (gitContext && localAcct == null && !options.forcedProfileId) {
    const applied = resolveProfile({ cwd: gitContext.gitDir, env, config });
    if (result.profile?.id !== applied.profile?.id) {
      result.conflict = {
        directoryProfile: result.profile?.id,
        gitProfile: applied.profile?.id,
        detail: `linked worktree at ${anchor} is bound to ${result.profile?.id ?? "(unbound)"} but its repository gitdir ${gitContext.gitDir} is under ${applied.profile?.id ?? "(unbound)"}'s binding; acct does not support cross-profile worktrees — move the worktree or align the bindings`,
      };
      result.profile = null;
      result.reason = "conflict";
    }
  }
  return result;
}
