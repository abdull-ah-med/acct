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

export function redactSecret(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(20, value.length - 4))}`;
}

export function debugLog(message: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!env.ACCT_DEBUG) return;
  console.error(`[acct] ${message}`);
}
