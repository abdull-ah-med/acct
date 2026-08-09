import { execFileSync } from "node:child_process";
import { findLocalAcct, loadConfig } from "../config/store.js";
import { resolveProfile } from "./resolve.js";
import type { ResolveResult } from "../types.js";

export function gitToplevel(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

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
  const toplevel = gitToplevel(cwd);
  // Nearest .acct from cwd upward (direnv find_up model) — works outside git repos.
  // Cite: docs/research/local-acct-exec-deny-cites-2026-08-08.md
  const localAcct = findLocalAcct(cwd);
  return resolveProfile({
    cwd,
    env,
    gitToplevel: toplevel,
    localAcct,
    config,
    forcedProfileId: options.forcedProfileId,
    allowEnvProfile: options.allowEnvProfile ?? false,
  });
}
