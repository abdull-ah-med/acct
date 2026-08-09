import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FileSecretStore,
  getSecretStore,
  setProfileToken,
  getProfileToken,
  setSecretStoreForTests,
} from "../../src/secrets/store.js";
import { ensureAcctDir } from "../../src/util/fs-safe.js";
import type { Profile } from "../../src/types.js";

const profile: Profile = {
  id: "personal",
  githubUser: "user-a",
  host: "github.com",
  name: "User A",
  email: "user-a@example.com",
  protocol: "https",
};

describe("file secret backend", () => {
  let dir: string;
  let prev: string | undefined;

  beforeEach(() => {
    setSecretStoreForTests(null);
    dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-secrets-"));
    prev = process.env.ACCT_CONFIG_DIR;
    process.env.ACCT_CONFIG_DIR = dir;
    process.env.ACCT_SECRET_BACKEND = "file";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.ACCT_CONFIG_DIR;
    else process.env.ACCT_CONFIG_DIR = prev;
    delete process.env.ACCT_SECRET_BACKEND;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stores tokens in secrets.json not config.yaml", async () => {
    await setProfileToken(profile, "gho_TEST_ONLY_file_backend");
    expect(await getProfileToken(profile)).toBe("gho_TEST_ONLY_file_backend");
    const secrets = path.join(dir, "secrets.json");
    expect(fs.existsSync(secrets)).toBe(true);
    expect(fs.readFileSync(secrets, "utf8")).toContain("gho_TEST_ONLY_file_backend");
    expect(fs.existsSync(path.join(dir, "config.yaml"))).toBe(false);
  });

  it("isolates accounts by host::user key", async () => {
    const store = new FileSecretStore(path.join(dir, "secrets.json"));
    await store.set("github.com::user-a", "tok-a");
    await store.set("github.com::user-b", "tok-b");
    expect(await store.get("github.com::user-a")).toBe("tok-a");
    expect(await store.get("github.com::user-b")).toBe("tok-b");
  });

  it("getSecretStore respects ACCT_SECRET_BACKEND=file", async () => {
    const store = await getSecretStore(process.env);
    await store.set("github.com::user-a", "tok");
    expect(await store.get("github.com::user-a")).toBe("tok");
  });

  it("corrupt JSON throws instead of silently returning {}", async () => {
    const secrets = path.join(dir, "secrets.json");
    fs.writeFileSync(secrets, "{not-json", { mode: 0o600 });
    const store = new FileSecretStore(secrets);
    await expect(store.get("x")).rejects.toThrow(/corrupt secrets\.json/i);
  });

  it("concurrent writes do not lose data", async () => {
    const secrets = path.join(dir, "secrets.json");
    const store = new FileSecretStore(secrets);
    const n = 20;
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        store.set(`github.com::user-${i}`, `tok-${i}`),
      ),
    );
    for (let i = 0; i < n; i++) {
      expect(await store.get(`github.com::user-${i}`)).toBe(`tok-${i}`);
    }
  });

  it("writes directory mode 0700 and file mode 0600", async () => {
    if (process.platform === "win32") return;
    const secrets = path.join(dir, "secrets.json");
    const store = new FileSecretStore(secrets);
    await store.set("github.com::user-a", "tok");
    const dirMode = fs.statSync(dir).mode & 0o777;
    const fileMode = fs.statSync(secrets).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("ensureAcctDir tightens existing 0755 directory to 0700", () => {
    if (process.platform === "win32") return;
    const loose = path.join(dir, "loose");
    fs.mkdirSync(loose, { mode: 0o755 });
    fs.chmodSync(loose, 0o755);
    ensureAcctDir(loose);
    expect(fs.statSync(loose).mode & 0o777).toBe(0o700);
  });
});
