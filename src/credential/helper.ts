import { stdin as input, stdout as output } from "node:process";
import { resolveFromCwd } from "../resolution/fromCwd.js";
import { getProfileToken, setProfileToken, deleteProfileToken } from "../secrets/store.js";
import {
  parseCredentialInput,
  formatCredentialOutput,
  isSafeHost,
  hostAllowed,
} from "./protocol.js";
import { debugLog } from "../util/paths.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * git-credential-acct entrypoint.
 * On strict failure: emit quit=true with no password (fail closed).
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

  const resolved = resolveFromCwd(cwd, process.env);
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
      if (enforce === "strict") {
        output.write(formatCredentialOutput({ quit: "1" }));
      }
      return;
    }

    if (attrs.protocol && attrs.protocol !== "https" && attrs.protocol !== "http") {
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

    output.write(
      formatCredentialOutput({
        username: profile.githubUser,
        password: token,
      }),
    );
    return;
  }

  if (op === "store") {
    if (!profile || !attrs.password || !isSafeHost(attrs.host)) return;
    if (!hostAllowed(attrs.host!, profile.host)) return;
    if (attrs.username && attrs.username !== profile.githubUser) return;
    await setProfileToken(profile, attrs.password);
    return;
  }

  if (op === "erase") {
    if (!profile) return;
    if (attrs.host && isSafeHost(attrs.host) && !hostAllowed(attrs.host, profile.host)) {
      return;
    }
    await deleteProfileToken(profile);
  }
}
