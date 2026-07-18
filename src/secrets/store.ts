import fs from "node:fs";
import path from "node:path";
import type { Profile } from "../types.js";
import { acctConfigDir, redactSecret, debugLog } from "../util/paths.js";

const SERVICE = "acct-github";

export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

function accountKey(profile: Profile): string {
  return `${profile.host}::${profile.githubUser}`;
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
 */
export class FileSecretStore implements SecretStore {
  constructor(private readonly filePath: string) {}

  private read(): Record<string, string> {
    if (!fs.existsSync(this.filePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  }

  private write(data: Record<string, string>): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.filePath, JSON.stringify(data), { mode: 0o600 });
  }

  async get(account: string): Promise<string | null> {
    return this.read()[account] ?? null;
  }
  async set(account: string, secret: string): Promise<void> {
    const data = this.read();
    data[account] = secret;
    this.write(data);
  }
  async delete(account: string): Promise<void> {
    const data = this.read();
    delete data[account];
    this.write(data);
  }
}

let overrideStore: SecretStore | null = null;

export function setSecretStoreForTests(store: SecretStore | null): void {
  overrideStore = store;
}

function fileStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(acctConfigDir(env), "secrets.json");
}

async function keyringStore(): Promise<SecretStore> {
  const { Entry } = await import("@napi-rs/keyring");
  return {
    async get(account: string) {
      try {
        const entry = new Entry(SERVICE, account);
        return entry.getPassword();
      } catch {
        return null;
      }
    },
    async set(account: string, secret: string) {
      const entry = new Entry(SERVICE, account);
      entry.setPassword(secret);
    },
    async delete(account: string) {
      try {
        const entry = new Entry(SERVICE, account);
        entry.deletePassword();
      } catch {
        // missing is fine
      }
    },
  };
}

/**
 * Prefer OS keyring. Read may fall back to file for one-time migration.
 * Successful set/delete always clears any file copy so tokens do not linger
 * on disk after moving to keyring.
 */
export class PreferKeyringStore implements SecretStore {
  constructor(
    private readonly primary: SecretStore,
    private readonly fileFallback: SecretStore,
  ) {}

  async get(account: string): Promise<string | null> {
    try {
      const v = await this.primary.get(account);
      if (v != null) return v;
    } catch {
      // fall through to migration read
    }
    return this.fileFallback.get(account);
  }

  async set(account: string, secret: string): Promise<void> {
    await this.primary.set(account, secret);
    await this.fileFallback.delete(account);
  }

  async delete(account: string): Promise<void> {
    try {
      await this.primary.delete(account);
    } catch {
      // ignore
    }
    await this.fileFallback.delete(account);
  }
}

export async function getSecretStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecretStore> {
  if (overrideStore) return overrideStore;
  const backend = (env.ACCT_SECRET_BACKEND || "auto").toLowerCase();
  const file = new FileSecretStore(fileStorePath(env));
  if (backend === "file") return file;
  if (backend === "keyring") return keyringStore();
  // auto: keyring required; file only for migration reads, never for new writes
  try {
    const primary = await keyringStore();
    return new PreferKeyringStore(primary, file);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `OS keychain unavailable (${detail}). Set ACCT_SECRET_BACKEND=file only if you accept plaintext secrets.json under the acct config dir.`,
    );
  }
}

export async function getProfileToken(profile: Profile): Promise<string | null> {
  const store = await getSecretStore();
  const token = await store.get(accountKey(profile));
  if (token && process.env.ACCT_DEBUG) {
    debugLog(`loaded token for ${accountKey(profile)}=${redactSecret(token)}`);
  }
  return token;
}

export async function setProfileToken(
  profile: Profile,
  token: string,
): Promise<void> {
  if (!token.trim()) throw new Error("Refusing to store empty token");
  const store = await getSecretStore();
  await store.set(accountKey(profile), token.trim());
}

export async function deleteProfileToken(profile: Profile): Promise<void> {
  const store = await getSecretStore();
  await store.delete(accountKey(profile));
}

export function isGithubDotComFamily(host: string): boolean {
  const h = host.toLowerCase();
  return h === "github.com" || h.endsWith(".ghe.com");
}

export function secretsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return fileStorePath(env);
}
