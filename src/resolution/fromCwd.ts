import { findLocalAcct, loadConfig } from "../config/store.js";
import { resolveProfile } from "./resolve.js";
import type { ResolveResult } from "../types.js";

export interface ResolveFromCwdOptions {
  /** Explicit CLI --profile */
  forcedProfileId?: string;
  /**
   * Honor ambient ACCT_PROFILE. Default false for security planes (helper/hooks).
   */
  allowEnvProfile?: boolean;
}

export function resolveFromCwd(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveFromCwdOptions = {},
): ResolveResult {
  const config = loadConfig(env);
  // Nearest .acct from cwd upward (direnv find_up model) — works outside git repos.
  // Bindings match cwd, not git toplevel — do not spawn git here.
  // Cite: docs/research/local-acct-exec-deny-cites-2026-08-08.md
  const localAcct = findLocalAcct(cwd);
  return resolveProfile({
    cwd,
    env,
    localAcct,
    config,
    forcedProfileId: options.forcedProfileId,
    allowEnvProfile: options.allowEnvProfile ?? false,
  });
}
