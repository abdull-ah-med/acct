import type { EnforceMode, Profile } from "../types.js";
import { resolveFromCwd } from "../resolution/fromCwd.js";
import { envForProfile, ghApiLogin } from "../gh/env.js";
import { execFileSync } from "node:child_process";

export interface CheckResult {
  ok: boolean;
  mode: EnforceMode;
  messages: string[];
}

export type GitConfigReader = (key: string, cwd: string) => string;

export function defaultGitConfigReader(key: string, cwd: string): string {
  try {
    return execFileSync("git", ["config", "--get", key], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

export async function checkCommitIdentity(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  readConfig: GitConfigReader = defaultGitConfigReader,
): Promise<CheckResult> {
  const resolved = resolveFromCwd(cwd, env);
  const messages: string[] = [];
  if (!resolved.profile) {
    return { ok: true, mode: resolved.enforce, messages };
  }
  if (resolved.enforce === "off") {
    return { ok: true, mode: resolved.enforce, messages };
  }

  const email = readConfig("user.email", cwd);
  const name = readConfig("user.name", cwd);
  const profile = resolved.profile;

  if (email !== profile.email) {
    messages.push(
      `Commit email is "${email || "(unset)"}" but profile "${profile.id}" requires "${profile.email}".`,
    );
  }
  if (name !== profile.name) {
    messages.push(
      `Commit name is "${name || "(unset)"}" but profile "${profile.id}" requires "${profile.name}".`,
    );
  }

  const ok = messages.length === 0;
  if (!ok && resolved.enforce === "warn") {
    for (const m of messages) console.error(`acct warn: ${m}`);
    return { ok: true, mode: resolved.enforce, messages };
  }
  return { ok, mode: resolved.enforce, messages };
}

export async function checkPushAuth(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  readConfig: GitConfigReader = defaultGitConfigReader,
): Promise<CheckResult> {
  const resolved = resolveFromCwd(cwd, env);
  const messages: string[] = [];
  if (!resolved.profile) {
    return { ok: true, mode: resolved.enforce, messages };
  }
  if (resolved.enforce === "off") {
    return { ok: true, mode: resolved.enforce, messages };
  }

  const profile = resolved.profile;
  const profileEnv = await envForProfile(profile, env);
  const login = ghApiLogin(profileEnv);
  if (!login) {
    messages.push(
      `Could not verify GitHub auth for profile "${profile.id}". Run: acct profile token ${profile.id}`,
    );
  } else if (login !== profile.githubUser) {
    messages.push(
      `Authenticated as "${login}" but profile "${profile.id}" expects "${profile.githubUser}".`,
    );
  }

  const identity = await checkCommitIdentity(cwd, env, readConfig);
  messages.push(...identity.messages.filter((m) => !messages.includes(m)));

  const ok = messages.length === 0;
  if (!ok && resolved.enforce === "warn") {
    for (const m of messages) console.error(`acct warn: ${m}`);
    return { ok: true, mode: resolved.enforce, messages };
  }
  return { ok, mode: resolved.enforce, messages };
}

export function formatBlockMessage(
  kind: "commit" | "push",
  profile: Profile | null,
  messages: string[],
): string {
  const header =
    kind === "commit"
      ? "acct blocked commit (strict identity mismatch)"
      : "acct blocked push (strict auth/identity mismatch)";
  const lines = [header, ...messages.map((m) => `  - ${m}`)];
  if (profile) {
    lines.push(
      `  Fix: ensure you are in the correct directory for profile "${profile.id}"`,
    );
    lines.push(`  Or: acct enforce warn   (temporarily)`);
    lines.push(
      "  Note: git --no-verify / -c core.hooksPath=… bypass client hooks (githooks); use server-side rules for non-bypassable policy",
    );
  }
  return lines.join("\n");
}
