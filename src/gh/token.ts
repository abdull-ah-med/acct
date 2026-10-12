import { execFileSync } from "node:child_process";
import type { Profile } from "../types.js";
import {
  getProfileToken,
  setProfileToken,
  secretStoreOverriddenForTests,
  isGithubDotComFamily,
  canonicalHost,
  assertValidToken,
} from "../secrets/store.js";

import { resolveRealGh } from "./real.js";

export interface ResolveProfileTokenOptions {
  allowNetwork?: boolean;
  /**
   * When false, return a live `gh auth token` without writing the keychain.
   * Credential helper `get` must be read-only for secrets (I17).
   * Cite: https://git-scm.com/docs/gitcredentials
   */
  persist?: boolean;
}

/**
 * Read this profile's token from gh without switching the active account.
 * Strips GH_TOKEN* so a sticky env token cannot override `--user`.
 * Cite: https://cli.github.com/manual/gh_auth_token (`--hostname` `--user`)
 * Cite: https://cli.github.com/manual/gh_help_environment (GH_TOKEN wins)
 */
export function readGhAuthToken(
  profile: Profile,
  base: NodeJS.ProcessEnv = process.env,
): string | null {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.GH_ENTERPRISE_TOKEN;
  delete env.GITHUB_ENTERPRISE_TOKEN;
  let out: string;
  try {
    out = execFileSync(
      resolveRealGh(env),
      [
        "auth",
        "token",
        "--hostname",
        canonicalHost(profile.host),
        "--user",
        profile.githubUser,
      ],
      {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 3000,
      },
    );
  } catch {
    return null;
  }
  // Strip the command terminator only; whitespace inside a token is invalid.
  out = out.replace(/\n$/, "");
  if (!out) return null;
  assertValidToken(out);
  return out;
}

/**
 * Login for a candidate token via `gh api user --jq .login`.
 * Cite: https://cli.github.com/manual/gh_api ; https://cli.github.com/manual/gh_help_environment
 */
export function loginForToken(
  token: string,
  host: string,
  base: NodeJS.ProcessEnv = process.env,
): string | null {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.GH_ENTERPRISE_TOKEN;
  delete env.GITHUB_ENTERPRISE_TOKEN;
  env.GH_HOST = canonicalHost(host);
  if (isGithubDotComFamily(host)) {
    env.GH_TOKEN = token;
  } else {
    env.GH_ENTERPRISE_TOKEN = token;
    env.GH_HOST = canonicalHost(host);
  }
  try {
    const out = execFileSync(
      resolveRealGh(env),
      ["api", "user", "--jq", ".login"],
      {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 3000,
      },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function shouldFollowGh(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const flag = env.ACCT_FOLLOW_GH?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (profile.followGh === false) return false;
  // Force-on for behavior tests (file backend + fake gh on PATH).
  if (flag === "1" || flag === "true" || flag === "on") return true;
  if (secretStoreOverriddenForTests()) return false;
  if ((env.ACCT_SECRET_BACKEND || "").toLowerCase() === "file") return false;
  return true;
}

function principalMatches(profile: Profile, login: string | null): boolean {
  return !!login && login.toLowerCase() === profile.githubUser.toLowerCase();
}

/**
 * Token for git HTTPS / GH_TOKEN injection.
 * When follow-gh is on, prefer a live `gh auth token --user` (no `gh auth switch`).
 * Persisting a gh token requires a matching `gh api user` login (never persist
 * a PATH-`gh` token for a different principal). Helper `get` passes persist:false.
 * First-access plaintext migration independently moves existing token values.
 * Cite: https://cli.github.com/manual/gh_auth_token
 */
export async function resolveProfileToken(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
  opts: ResolveProfileTokenOptions = {},
): Promise<string | null> {
  const persist = opts.persist === true && opts.allowNetwork === true;
  const stored = await getProfileToken(profile, env);
  if (!shouldFollowGh(profile, env)) return stored;

  const live = readGhAuthToken(profile, env);
  if (!live) return stored;
  if (live === stored) return live;

  if (!persist) {
    // Helper get: return live for this request without gh token-value persistence.
    return live;
  }

  const login = loginForToken(live, profile.host, env);
  if (login && !principalMatches(profile, login)) {
    console.error(
      `acct warning: live gh token principal differs from profile ${profile.id}; using stored token`,
    );
    return stored;
  }
  if (!login) return live;
  try {
    await setProfileToken(profile, live, env);
  } catch {
    // Still use the live token even if the keychain write fails.
  }
  return live;
}

export function importTokenFromGh(profile: Profile): string {
  const token = readGhAuthToken(profile);
  if (!token) throw new Error("gh auth token returned empty");
  return token;
}
