import { stdin as input, stdout as output } from "node:process";
import { timingSafeEqual } from "node:crypto";
import { resolveFromCwd } from "../resolution/fromCwd.js";
import { getProfileToken, deleteProfileToken } from "../secrets/store.js";
import {
  parseCredentialInput,
  formatCredentialOutput,
  isSafeHost,
  hostAllowed,
} from "./protocol.js";
import { debugLog } from "../util/paths.js";

function passwordsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** GitHub HTTPS only — protocol contexts match exactly (gitcredentials). */
function isHttpsProtocol(protocol: string | undefined): boolean {
  return protocol === "https";
}

/**
 * git-credential-acct entrypoint.
 * On strict failure: emit quit=true with no password (fail closed).
 * Ambient ACCT_PROFILE is ignored — directory / .acct win (I4).
 * Host port: hostname-only profiles accept bare host or :443 only (I7).
 * Cite: https://git-scm.com/docs/gitcredentials (quit=true; helper=""; read-only store)
 * Cite: docs/research/host-port-local-acct-cites-2026-08-08.md
 */
export async function runCredentialHelper(argv: string[]): Promise<void> {
  const op = argv[0];
  if (!op || !["get", "store", "erase", "capability"].includes(op)) {
    // Unknown ops: silently ignore per gitcredentials docs
    return;
  }

  if (op === "capability") {
    output.write("version 0\n");
    return;
  }

  const raw = await readStdin();
  const attrs = parseCredentialInput(raw);
  // Git invokes helpers with cwd in the work tree; resolveFromCwd finds toplevel.
  // Do not prefer $PWD — it can disagree with the process cwd after chdir.
  const cwd = process.cwd();

  // I4: never allowEnvProfile for the credential helper
  const resolved = resolveFromCwd(cwd, process.env, { allowEnvProfile: false });
  const profile = resolved.profile;
  const enforce = resolved.enforce;

  if (op === "get") {
    if (!isSafeHost(attrs.host)) {
      debugLog("credential get: rejecting unsafe/empty host");
      if (enforce === "strict" || profile) {
        output.write(formatCredentialOutput({ quit: "1" }));
      }
      return;
    }

    if (!profile) {
      // I6: unbound + strict → quit so osxkeychain/gh cannot answer
      if (enforce === "strict") {
        output.write(formatCredentialOutput({ quit: "1" }));
      }
      return;
    }

    // I16: never return HTTPS profile tokens for http (or other) contexts
    if (!isHttpsProtocol(attrs.protocol)) {
      debugLog(`credential get: refusing protocol=${attrs.protocol ?? "(missing)"}`);
      output.write(formatCredentialOutput({ quit: "1" }));
      return;
    }

    if (!hostAllowed(attrs.host!, profile.host)) {
      debugLog(
        `credential get: host mismatch want=${profile.host} got=${attrs.host}`,
      );
      output.write(formatCredentialOutput({ quit: "1" }));
      return;
    }

    const token = await getProfileToken(profile);
    if (!token) {
      debugLog(`credential get: no token for ${profile.id}`);
      if (enforce === "strict") {
        output.write(formatCredentialOutput({ quit: "1" }));
      }
      return;
    }

    // Directory binding wins over any username git asked for (I4 / isolation).
    // Always emit profile.githubUser so the password is paired with the correct
    // principal — never return another account's username with this token.
    // Cite: https://git-scm.com/docs/gitcredentials (helper may set username)
    if (attrs.username && attrs.username !== profile.githubUser) {
      debugLog(
        `credential get: ignoring requested username=${attrs.username}; using profile ${profile.githubUser}`,
      );
    }

    output.write(
      formatCredentialOutput({
        username: profile.githubUser,
        password: token,
      }),
    );
    return;
  }

  if (op === "store") {
    // I17: read-only helper — silently ignore store (gitcredentials).
    // Token writes only via `acct profile token` / --import-gh / --stdin.
    // Prevents cross-account poison via `git credential approve`.
    debugLog("credential store: ignored (acct owns token lifecycle)");
    return;
  }

  if (op === "erase") {
    if (!profile) return;
    if (!attrs.host || !isSafeHost(attrs.host) || !hostAllowed(attrs.host, profile.host)) {
      return;
    }
    if (!isHttpsProtocol(attrs.protocol)) {
      return;
    }
    if (attrs.username && attrs.username !== profile.githubUser) {
      return;
    }
    const current = await getProfileToken(profile);
    if (!current) return;
    // Only erase when reject confirms our stored credential (password match).
    // Cite: git-credential reject feeds the failed credential description.
    if (!attrs.password || !passwordsEqual(attrs.password, current)) {
      debugLog("credential erase: ignored (password does not match stored token)");
      return;
    }
    await deleteProfileToken(profile);
  }
}
