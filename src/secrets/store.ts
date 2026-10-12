import fs from "node:fs";
import path from "node:path";
import type { Profile } from "../types.js";
import { acctConfigDir, redactSecret, debugLog } from "../util/paths.js";
import {
  atomicWriteFileSync,
  ensureAcctDir,
  withFileLock,
} from "../util/fs-safe.js";

const SERVICE = "acct-github";

export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export function canonicalHost(host: string): string { return host.toLowerCase().replace(/:443$/, ""); }
export function accountKey(profile: Profile): string {
  return `${canonicalHost(profile.host)}::${profile.githubUser.toLowerCase()}`;
}
export class SecretStoreError extends Error {
  constructor(readonly code: "NOT_FOUND" | "CORRUPT" | "DENIED" | "UNAVAILABLE") {
    super(code === "CORRUPT" ? "Corrupt secrets.json; repair the secret store and re-import the token" : `Secret store ${code.toLowerCase()}`);
    this.name = "SecretStoreError";
  }
}
export function assertValidToken(token: unknown): asserts token is string {
  if (typeof token !== "string" || !token || /[\s\0]/u.test(token)) throw new Error("Invalid token: expected a nonempty string without whitespace or NUL");
}

/** In-memory store for tests */
export class MemorySecretStore implements SecretStore {
  private map = new Map<string, string>();
  async get(account: string): Promise<string | null> {
    return this.map.get(account) ?? null;
  }
  async set(account: string, secret: string): Promise<void> {
    this.map.set(account, secret);
  }
  async delete(account: string): Promise<void> {
    this.map.delete(account);
  }
}

/**
 * File-backed store under ACCT_CONFIG_DIR/secrets.json (mode 0600).
 * Only used when ACCT_SECRET_BACKEND=file (explicit opt-in).
 * Never writes tokens into config.yaml (I13).
 *
 * Concurrent writers serialize via secrets.json.lock; writes are atomic
 * (tmp → fsync → rename). Corrupt JSON throws (does not return {}).
 */
export class FileSecretStore implements SecretStore {
  constructor(private readonly filePath: string) {}

  private lockPath(): string {
    return `${this.filePath}.lock`;
  }

  private backupPath(): string {
    return `${this.filePath}.bak`;
  }

  private readUnlocked(): Record<string, string> {
    if (!fs.existsSync(this.filePath)) return {};
    const raw = fs.readFileSync(this.filePath, "utf8");
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("not an object");
      }
      for (const value of Object.values(parsed)) { try { assertValidToken(value); } catch { throw new SecretStoreError("CORRUPT"); } }
      return parsed as Record<string, string>;
    } catch { throw new SecretStoreError("CORRUPT"); }
  }

  private writeUnlocked(data: Record<string, string>): void {
    ensureAcctDir(path.dirname(this.filePath));
    fs.rmSync(this.backupPath(), {force: true});
    if (Object.keys(data).length === 0) fs.rmSync(this.filePath, {force: true});
    else atomicWriteFileSync(this.filePath, JSON.stringify(data), 0o600);
  }

  private withLock<T>(fn: () => T): T {
    return withFileLock(this.lockPath(), fn);
  }

  async migrateTo(primary: SecretStore): Promise<void> {
    await this.withLock(async () => {
      const data = this.readUnlocked();
      for (const [legacy, secret] of Object.entries(data)) {
        const [host, user] = legacy.split("::");
        const key = user ? `${canonicalHost(host!)}::${user.toLowerCase()}` : legacy;
        try {
          if (await primary.get(key) == null) await primary.set(key, secret);
          delete data[legacy];
        } catch { console.error("acct warning: secret migration incomplete; run acct doctor"); }
      }
      this.writeUnlocked(data);
    });
  }

  async get(account: string): Promise<string | null> {
    return this.withLock(() => this.readUnlocked()[account] ?? null);
  }

  async set(account: string, secret: string): Promise<void> {
    assertValidToken(secret);
    this.withLock(() => {
      const data = this.readUnlocked();
      data[account] = secret;
      this.writeUnlocked(data);
    });
  }

  async delete(account: string): Promise<void> {
    this.withLock(() => {
      const data = this.readUnlocked();
      delete data[account];
      this.writeUnlocked(data);
    });
  }
}

let overrideStore: SecretStore | null = null;

export function setSecretStoreForTests(store: SecretStore | null): void {
  overrideStore = store;
}

export function secretStoreOverriddenForTests(): boolean {
  return overrideStore !== null;
}

function fileStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(acctConfigDir(env), "secrets.json");
}

async function keyringStore(): Promise<SecretStore> {
  let Entry: typeof import("@napi-rs/keyring").Entry;
  try { ({Entry} = await import("@napi-rs/keyring")); } catch { throw new SecretStoreError("UNAVAILABLE"); }
  const failure = (e: unknown) => new SecretStoreError(/denied|permission|locked/i.test(e instanceof Error ? e.message : "") ? "DENIED" : "UNAVAILABLE");
  // Installed @napi-rs/keyring index.d.ts: getPassword returns null for absence;
  // deleteCredential returns false for absence. Other errors must propagate.
  // https://github.com/Brooooooklyn/keyring-node
  return {
    async get(account) { try { return new Entry(SERVICE, account).getPassword(); } catch (e) { throw failure(e); } },
    async set(account, secret) { try { new Entry(SERVICE, account).setPassword(secret); } catch (e) { throw failure(e); } },
    async delete(account) { try { new Entry(SERVICE, account).deleteCredential(); } catch (e) { throw failure(e); } },
  };
}

/**
 * Prefer OS keyring. Read may fall back to file for one-time migration.
 * Successful set/delete always clears any file copy so tokens do not linger
 * on disk after moving to keyring.
 */
export class PreferKeyringStore implements SecretStore {
  private migration: Promise<void> | null = null;
  constructor(private readonly primary: SecretStore, private readonly fileFallback: SecretStore) {}
  private ready(): Promise<void> {
    return this.migration ??= this.fileFallback instanceof FileSecretStore ? this.fileFallback.migrateTo(this.primary) : Promise.resolve();
  }
  async get(account: string): Promise<string | null> {
    await this.ready();
    return await this.primary.get(account) ?? await this.fileFallback.get(account);
  }
  async set(account: string, secret: string): Promise<void> {
    await this.ready(); await this.primary.set(account, secret); await this.fileFallback.delete(account);
  }
  async delete(account: string): Promise<void> {
    await this.ready(); await this.primary.delete(account); await this.fileFallback.delete(account);
  }
}
const autoStores = new Map<string, Promise<SecretStore>>();

export async function getSecretStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecretStore> {
  if (overrideStore) return overrideStore;
  const backend = (env.ACCT_SECRET_BACKEND || "auto").toLowerCase();
  const file = new FileSecretStore(fileStorePath(env));
  if (backend === "file") return file;
  if (backend === "keyring") return keyringStore();
  // One sweep on first access for this configuration directory in a process.
  const key = fileStorePath(env);
  let store = autoStores.get(key);
  if (!store) { store = keyringStore().then(primary => new PreferKeyringStore(primary, file)); autoStores.set(key, store); }
  return store;
}

export async function getProfileToken(profile: Profile, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const store = await getSecretStore(env);
  let token = await store.get(accountKey(profile));
  const legacy = `${profile.host}::${profile.githubUser}`;
  if (!token && legacy !== accountKey(profile)) {
    token = await store.get(legacy);
    if (token) { await store.set(accountKey(profile), token); await store.delete(legacy); }
  }
  if (token && process.env.ACCT_DEBUG) {
    // Never interpolate token material — even redacted prefixes are forbidden.
    debugLog(
      `loaded token for ${accountKey(profile)}=${redactSecret(token)}`,
    );
  }
  return token;
}

export async function setProfileToken(
  profile: Profile,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  assertValidToken(token);
  const store = await getSecretStore(env);
  await store.set(accountKey(profile), token);
}

export async function deleteProfileToken(profile: Profile): Promise<void> {
  const store = await getSecretStore();
  await store.delete(accountKey(profile));
  const legacy = `${profile.host}::${profile.githubUser}`;
  if (legacy !== accountKey(profile)) await store.delete(legacy);
}

export function isGithubDotComFamily(host: string): boolean {
  const h = canonicalHost(host);
  return h === "github.com" || h.endsWith(".ghe.com");
}

export function secretsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return fileStorePath(env);
}
