import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acctConfigDir } from "../config/store.js";
import type { Profile } from "../types.js";
import { posixShellSingleQuote } from "../util/paths.js";
import { splitHostPort } from "../credential/protocol.js";
import { ensureAcctDir } from "../util/fs-safe.js";

export function defaultKeyPath(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(acctConfigDir(env), "ssh", `id_ed25519_${profile.id}`);
}

/** Hostname safe for embedding in ssh -o HostName=… (no option injection). */
export function assertSafeSshHost(host: string): string {
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) {
    throw new Error(
      `Invalid SSH host "${host}": only letters, digits, dot, and hyphen are allowed`,
    );
  }
  return host;
}

/**
 * Build core.sshCommand when a key is attached.
 * Independent of preferred clone protocol (HTTPS vs SSH) — I8b dual plane.
 * Cite: IdentitiesOnly https://man.openbsd.org/ssh_config.5
 *       core.sshCommand https://git-scm.com/docs/git-config
 */
export function sshCommandFor(profile: Profile): string | null {
  if (!profile.sshKeyPath) return null;
  const key = profile.sshKeyPath.replace(/\\/g, "/");
  return `ssh -i ${posixShellSingleQuote(key)} -o IdentitiesOnly=yes`;
}

/**
 * Generate an ed25519 key.
 * Uses an empty passphrase for automation; doctor warns that the key is
 * unprotected at rest under the acct config directory.
 */
export function generateSshKey(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): { privateKey: string; publicKey: string } {
  const privateKey = defaultKeyPath(profile, env);
  ensureAcctDir(path.dirname(privateKey));
  if (fs.existsSync(privateKey)) {
    throw new Error(`SSH key already exists: ${privateKey}`);
  }
  const comment = `${profile.email}-acct`;
  execFileSync(
    "ssh-keygen",
    ["-t", "ed25519", "-f", privateKey, "-N", "", "-C", comment],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  fs.chmodSync(privateKey, 0o600);
  const publicKey = privateKey + ".pub";
  return { privateKey, publicKey };
}

export function readPublicKey(privateKeyPath: string): string {
  const pub = privateKeyPath + ".pub";
  if (!fs.existsSync(pub)) {
    throw new Error(`Missing public key: ${pub}`);
  }
  return fs.readFileSync(pub, "utf8").trim();
}

/**
 * Bundled github.com known_hosts for StrictHostKeyChecking=yes.
 * Cite: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints
 */
export function githubKnownHostsPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "data", "github_known_hosts");
}

/**
 * Probe SSH auth for an attached key.
 * Requires sshKeyPath only — preferred protocol may remain https (I8b).
 * For github.com uses StrictHostKeyChecking=yes + bundled known_hosts.
 * Other hosts keep accept-new with a warning.
 */
/** GitHub returns exit 1 on successful authentication; the greeting identifies the account.
 * https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection
 */
export function parseSshLogin(output: string): string | null {
  return /\bHi ([A-Za-z0-9-]+)!/.exec(output)?.[1] ?? null;
}
export function testSshAuth(profile: Profile): { ok: boolean; output: string } {
  if (!profile.sshKeyPath)
    return {
      ok: false,
      output:
        "No sshKeyPath on profile — attach with: acct profile ssh-key <id> --path <key> or --generate",
    };
  const host = assertSafeSshHost(splitHostPort(profile.host).hostname);
  if (!fs.existsSync(profile.sshKeyPath))
    return { ok: false, output: `SSH key file missing: ${profile.sshKeyPath}` };
  const known = githubKnownHostsPath();
  const hostKeyArgs =
    host.toLowerCase() === "github.com"
      ? [
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          `UserKnownHostsFile=${known}`,
          "-o",
          "GlobalKnownHostsFile=/dev/null",
        ]
      : ["-o", "StrictHostKeyChecking=accept-new"];
  let output = "";
  try {
    output = execFileSync(
      "ssh",
      [
        "-i",
        profile.sshKeyPath,
        "-o",
        "IdentitiesOnly=yes",
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        ...hostKeyArgs,
        `git@${host}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
    );
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    output = (e.stdout ?? "") + (e.stderr ?? "");
  }
  const login = parseSshLogin(output);
  return {
    ok: login?.toLowerCase() === profile.githubUser.toLowerCase(),
    output: `expected=${profile.githubUser} actual=${login ?? "unknown"}\n${output}`,
  };
}
