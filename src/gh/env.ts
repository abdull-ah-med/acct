import { execFileSync } from "node:child_process";
import type { Profile } from "../types.js";
import {
  getProfileToken,
  isGithubDotComFamily,
  setProfileToken,
} from "../secrets/store.js";

export function importTokenFromGh(profile: Profile): string {
  const args = [
    "auth",
    "token",
    "--hostname",
    profile.host,
    "--user",
    profile.githubUser,
  ];
  const token = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!token) throw new Error("gh auth token returned empty");
  return token;
}

export async function importAndStoreToken(profile: Profile): Promise<void> {
  const token = importTokenFromGh(profile);
  await setProfileToken(profile, token);
}

/**
 * Build env for running gh/git without mutating global gh active account.
 * Spec: GH_TOKEN overrides stored credentials — https://cli.github.com/manual/gh_help_environment
 */
export async function envForProfile(
  profile: Profile,
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...base };
  env.ACCT_PROFILE = profile.id;
  const token = await getProfileToken(profile);
  if (token) {
    if (isGithubDotComFamily(profile.host)) {
      env.GH_TOKEN = token;
      delete env.GITHUB_TOKEN;
      delete env.GH_ENTERPRISE_TOKEN;
      delete env.GITHUB_ENTERPRISE_TOKEN;
    } else {
      env.GH_ENTERPRISE_TOKEN = token;
      env.GH_HOST = profile.host;
      delete env.GH_TOKEN;
      delete env.GITHUB_TOKEN;
    }
  } else {
    // Clear stale tokens so they cannot override
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    delete env.GH_ENTERPRISE_TOKEN;
    delete env.GITHUB_ENTERPRISE_TOKEN;
  }
  if (profile.host !== "github.com") {
    env.GH_HOST = profile.host;
  }
  return env;
}

export async function envForUnbound(
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.ACCT_PROFILE;
  // Do not clear user's GH_TOKEN when unbound — only when switching profiles
  return env;
}

export function ghApiLogin(env: NodeJS.ProcessEnv): string | null {
  try {
    const out = execFileSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function isDangerousGhArgv(argv: string[]): boolean {
  if (argv[0] !== "gh") return false;
  return (
    (argv[1] === "auth" && argv[2] === "switch") ||
    (argv[1] === "auth" && argv[2] === "setup-git")
  );
}
