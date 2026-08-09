import fs from "node:fs";
import path from "node:path";

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

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 25;

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin — avoid Atomics.wait (SharedArrayBuffer may be blocked) */
  }
}

/**
 * Serialize critical sections with an exclusive lockfile (`wx`).
 * Cite: https://nodejs.org/docs/latest-v22.x/api/fs.html#fsopensyncpath-flags-mode
 */
export function withFileLock<T>(
  lockPath: string,
  fn: () => T,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
): T {
  ensureAcctDir(path.dirname(lockPath));
  const deadline = Date.now() + timeoutMs;
  let fd: number | undefined;
  for (;;) {
    try {
      fd = fs.openSync(lockPath, "wx");
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for lock ${lockPath}`,
        );
      }
      // Stale lock from a dead process: if older than 2× timeout, steal.
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > timeoutMs * 2) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        // raced away
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    try {
      if (fd !== undefined) fs.closeSync(fd);
    } catch {
      // ignore
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}
