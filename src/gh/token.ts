import { execFileSync } from "node:child_process";
import type { Profile } from "../types.js";
import {
  getProfileToken,
  setProfileToken,
  secretStoreOverriddenForTests,
} from "../secrets/store.js";

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
  try {
    const out = execFileSync(
      "gh",
      [
        "auth",
        "token",
        "--hostname",
        profile.host,
        "--user",
        profile.githubUser,
      ],
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

/**
 * Token for git HTTPS / GH_TOKEN injection.
 * When follow-gh is on, prefer a live `gh auth token --user` (no `gh auth switch`)
 * and refresh the keychain copy so `acct profile token --import-gh` is not required
 * after `gh auth refresh` / re-login.
 */
export async function resolveProfileToken(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const stored = await getProfileToken(profile);
  if (!shouldFollowGh(profile, env)) return stored;

  const live = readGhAuthToken(profile, env);
  if (!live) return stored;
  if (live !== stored) {
    try {
      await setProfileToken(profile, live);
    } catch {
      // Still use the live token even if the keychain write fails.
    }
  }
  return live;
}

export function importTokenFromGh(profile: Profile): string {
  const token = readGhAuthToken(profile);
  if (!token) throw new Error("gh auth token returned empty");
  return token;
}
