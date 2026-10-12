import fs from "node:fs";
import path from "node:path";
interface Snapshot {
  file: string;
  data: Buffer | null;
  mode: number;
  link?: string;
}
/** Explicit file snapshots restore in reverse order, including absent artifacts. */
export class Transaction {
  private snapshots: Snapshot[] = [];
  private seen = new Set<string>();
  private directories: { dir: string; files: Set<string> }[] = [];
  capture(file: string): void {
    if (this.seen.has(file)) return;
    this.seen.add(file);
    try {
      const st = fs.lstatSync(file);
      this.snapshots.push({
        file,
        data: st.isSymbolicLink() ? null : fs.readFileSync(file),
        mode: st.mode & 0o777,
        link: st.isSymbolicLink() ? fs.readlinkSync(file) : undefined,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.snapshots.push({ file, data: null, mode: 0o600 });
    }
  }
  captureTree(dir: string): void {
    const files = new Set<string>();
    const walk = (at: string) => {
      if (!fs.existsSync(at)) return;
      for (const name of fs.readdirSync(at)) {
        const file = path.join(at, name);
        if (/\.(lock|recovery)$/.test(file)) continue;
        if (fs.lstatSync(file).isDirectory()) walk(file);
        else {
          files.add(file);
          this.capture(file);
        }
      }
    };
    walk(dir);
    this.directories.push({ dir, files });
  }
  rollback(): void {
    const errors: string[] = [];
    for (const { dir, files } of this.directories) {
      const clean = (at: string) => {
        if (!fs.existsSync(at)) return;
        for (const name of fs.readdirSync(at)) {
          const file = path.join(at, name);
          if (/\.(lock|recovery)$/.test(file)) continue;
          if (fs.lstatSync(file).isDirectory()) {
            clean(file);
            try {
              fs.rmdirSync(file);
            } catch {
              /* nonempty */
            }
          } else if (!files.has(file)) fs.rmSync(file, { force: true });
        }
      };
      try {
        clean(dir);
      } catch {
        errors.push(dir);
      }
    }
    for (const snap of [...this.snapshots].reverse()) {
      try {
        if (snap.link !== undefined) {
          fs.rmSync(snap.file, { force: true });
          fs.symlinkSync(snap.link, snap.file);
        } else if (snap.data === null) fs.rmSync(snap.file, { force: true });
        else {
          fs.mkdirSync(path.dirname(snap.file), { recursive: true });
          fs.writeFileSync(snap.file, snap.data, { mode: snap.mode });
          fs.chmodSync(snap.file, snap.mode);
        }
      } catch {
        errors.push(snap.file);
      }
    }
    if (errors.length)
      throw new Error("Transaction rollback failed for: " + errors.join(", "));
  }
}
export function failAt(
  stage: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (
    (env.NODE_ENV === "test" || env.VITEST) &&
    env.ACCT_TEST_FAIL_AT === stage
  )
    throw new Error("Injected transaction failure at " + stage);
}
