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
import type { Profile } from "../../src/types.js";

const profile: Profile = {
  id: "personal",
  githubUser: "abdull-ah-med",
  host: "github.com",
  name: "Abdullah Ahmed",
  email: "contactabdullahahmed@gmail.com",
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
    await store.set("github.com::abdull-ah-med", "tok-a");
    await store.set("github.com::aqsa-05", "tok-b");
    expect(await store.get("github.com::abdull-ah-med")).toBe("tok-a");
    expect(await store.get("github.com::aqsa-05")).toBe("tok-b");
  });

  it("getSecretStore respects ACCT_SECRET_BACKEND=file", async () => {
    const store = await getSecretStore(process.env);
    await store.set("github.com::abdull-ah-med", "tok");
    expect(await store.get("github.com::abdull-ah-med")).toBe("tok");
  });
});
