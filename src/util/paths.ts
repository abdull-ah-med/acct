import os from "node:os";
import path from "node:path";

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") {
    return env.USERPROFILE || env.HOME || os.homedir();
  }
  return env.HOME || os.homedir();
}

export function acctConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ACCT_CONFIG_DIR) return path.resolve(env.ACCT_CONFIG_DIR);
  if (process.platform === "win32") {
    const base = env.APPDATA || path.join(homeDir(env), "AppData", "Roaming");
    return path.join(base, "acct");
  }
  if (env.XDG_CONFIG_HOME) {
    return path.join(env.XDG_CONFIG_HOME, "acct");
  }
  return path.join(homeDir(env), ".config", "acct");
}

export function normalizePath(p: string): string {
  return path.resolve(p).replace(/\\/g, "/");
}

export function pathIsPrefix(prefix: string, candidate: string): boolean {
  const a = normalizePath(prefix).replace(/\/+$/, "");
  const b = normalizePath(candidate).replace(/\/+$/, "");
  if (a === b) return true;
  return b.startsWith(a + "/");
}

/**
 * GitHub / common token shapes — shared by sanitizeDebugMessage and config guards.
 * Cite: https://github.blog/changelog/2021-03-31-authentication-token-format-updates/
 */
export const TOKEN_SHAPE =
  /\b(?:gh[pousrc]_|github_pat_)[A-Za-z0-9_]{16,}|\b[a-f0-9]{40}\b/gi;

/**
 * Redact a secret for debug output. Never keep a token prefix — presence only.
 * Cite: workspace security-secrets rule; ACCT_DEBUG must not leak credentials.
 */
export function redactSecret(_value: string): string {
  return "[REDACTED]";
}

/** Sanitize an entire debug line (defense in depth if callers forget redactSecret). */
export function sanitizeDebugMessage(message: string): string {
  return message
    .replace(TOKEN_SHAPE, "[REDACTED]")
    .replace(
      /\b(Authorization|authorization)\s*:\s*Bearer\s+\S+/gi,
      "$1: Bearer [REDACTED]",
    )
    .replace(
      /\bx-access-token:[^@\s]+@/gi,
      "x-access-token:[REDACTED]@",
    )
    .replace(
      /\b(password|token|secret|authorization)\s*=\s*([^\s]+)/gi,
      "$1=[REDACTED]",
    );
}

export function debugLog(
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!env.ACCT_DEBUG) return;
  console.error(`[acct] ${sanitizeDebugMessage(message)}`);
}

/**
 * POSIX single-quote for shell snippets (credential helper `!…`, ssh -i, hooks).
 * Cite: https://git-scm.com/docs/gitcredentials — helper values are executed by the shell.
 */
export function posixShellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
