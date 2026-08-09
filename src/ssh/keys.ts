import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { acctConfigDir } from "../config/store.js";
import type { Profile } from "../types.js";
import { posixShellSingleQuote } from "../util/paths.js";

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
  const host = assertSafeSshHost(profile.host);
  return `ssh -i ${posixShellSingleQuote(key)} -o IdentitiesOnly=yes -o HostName=${host}`;
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
  fs.mkdirSync(path.dirname(privateKey), { recursive: true, mode: 0o700 });
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
 * Probe SSH auth for an attached key.
 * Requires sshKeyPath only — preferred protocol may remain https (I8b).
 */
export function testSshAuth(profile: Profile): {
  ok: boolean;
  output: string;
} {
  if (!profile.sshKeyPath) {
    return {
      ok: false,
      output:
        "No sshKeyPath on profile — attach with: acct profile ssh-key <id> --path <key> or --generate",
    };
  }
  try {
    assertSafeSshHost(profile.host);
  } catch (err) {
    return {
      ok: false,
      output: err instanceof Error ? err.message : String(err),
    };
  }
  if (!fs.existsSync(profile.sshKeyPath)) {
    return { ok: false, output: `SSH key file missing: ${profile.sshKeyPath}` };
  }
  try {
    const out = execFileSync(
      "ssh",
      [
        "-i",
        profile.sshKeyPath,
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-T",
        `git@${profile.host}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output: out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    // GitHub returns exit 1 even on success: "Hi user! You've successfully authenticated"
    const ok = /successfully authenticated/i.test(output);
    return { ok, output };
  }
}
