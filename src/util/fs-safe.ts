import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

/**
 * Ensure an acct-owned directory exists with mode 0700.
 * mkdirSync mode only applies on create; always chmod existing dirs.
 * Cite: https://nodejs.org/docs/latest-v22.x/api/fs.html#fsmkdirsyncpath-options
 */
export function ensureAcctDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // best effort on Windows / non-POSIX
  }
}

/**
 * Atomic write: tmp file → fsync → rename over destination (same filesystem).
 * Cite: https://nodejs.org/docs/latest-v22.x/api/fs.html#fsrenamesyncoldpath-newpath
 */
export function atomicWriteFileSync(
  filePath: string,
  data: string | Buffer,
  mode = 0o600,
): void {
  const dir = path.dirname(filePath);
  ensureAcctDir(dir);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(tmp, mode);
  } catch {
    // best effort
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // best effort
  }
}

export function lockTimeout(env: NodeJS.ProcessEnv = process.env): number {
  return (env.NODE_ENV === "test" || env.VITEST) && env.ACCT_LOCK_TIMEOUT_MS
    ? Number(env.ACCT_LOCK_TIMEOUT_MS)
    : 10000;
}
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
interface LockOwner {
  pid: number;
  hostname: string;
  nonce: string;
  createdAt: number;
}
function owner(file: string): LockOwner | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as LockOwner;
  } catch {
    return null;
  }
}
function dead(record: LockOwner | null): boolean {
  if (
    !record ||
    record.hostname !== os.hostname() ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0
  )
    return false;
  try {
    process.kill(record.pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}
/** wx acquisition; only a provably dead owner may be recovered. No age-based stealing.
 * https://nodejs.org/api/process.html#processkillpid-signal
 */
export function acquireFileLock(
  file: string,
  timeout = lockTimeout(),
): () => void {
  ensureAcctDir(path.dirname(file));
  const nonce = randomUUID(),
    deadline = Date.now() + timeout;
  let delay = 10;
  for (;;) {
    let fd: number;
    try {
      fd = fs.openSync(file, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const record = owner(file);
      if (dead(record)) {
        const recovery = file + ".recovery";
        let recoveryFd: number | undefined;
        try {
          recoveryFd = fs.openSync(recovery, "wx", 0o600);
          const current = owner(file);
          if (current?.nonce === record?.nonce && dead(current))
            fs.unlinkSync(file);
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "EEXIST" &&
            (error as NodeJS.ErrnoException).code !== "ENOENT"
          )
            throw error;
        } finally {
          if (recoveryFd !== undefined) {
            fs.closeSync(recoveryFd);
            fs.rmSync(recovery, { force: true });
          }
        }
        if (!fs.existsSync(file)) continue;
      }
      if (Date.now() >= deadline)
        throw new Error(
          `Timed out waiting for lock ${file}; owner pid ${record?.pid ?? "unknown"}`,
        );
      sleepSync(Math.min(delay, Math.max(1, deadline - Date.now())));
      delay = Math.min(200, delay * 2);
      continue;
    }
    try {
      fs.writeFileSync(
        fd,
        JSON.stringify({
          pid: process.pid,
          hostname: os.hostname(),
          nonce,
          createdAt: Date.now(),
        }),
      );
      fs.fsyncSync(fd);
    } catch (error) {
      fs.closeSync(fd);
      fs.rmSync(file, { force: true });
      throw error;
    }
    fs.closeSync(fd);
    return () => {
      if (owner(file)?.nonce === nonce) fs.rmSync(file, { force: true });
    };
  }
}
export function withFileLock<T>(
  file: string,
  fn: () => T,
  timeout = lockTimeout(),
): T {
  const release = acquireFileLock(file, timeout);
  try {
    const result = fn();
    if (result && typeof (result as { then?: unknown }).then === "function")
      return Promise.resolve(result).finally(release) as T;
    release();
    return result;
  } catch (error) {
    release();
    throw error;
  }
}
