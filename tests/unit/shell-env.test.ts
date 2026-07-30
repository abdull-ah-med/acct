import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MemorySecretStore,
  setSecretStoreForTests,
  setProfileToken,
  PreferKeyringStore,
  FileSecretStore,
} from "../../src/secrets/store.js";
import {
  defaultConfig,
  saveConfig,
  upsertBinding,
  upsertProfile,
} from "../../src/config/store.js";
import { buildShellEnvExports } from "../../src/shell/env.js";
import type { Profile } from "../../src/types.js";

describe("shell-env exports (T2/T5)", () => {
  let tmp: string;
  let workDir: string;
  let personalDir: string;
  let unboundDir: string;
  let prevConfig: string | undefined;

  const work: Profile = {
    id: "work",
    githubUser: "work-user",
    host: "github.com",
    name: "Work",
    email: "work@corp.com",
    protocol: "https",
  };
  const personal: Profile = {
    id: "personal",
    githubUser: "personal-user",
    host: "github.com",
    name: "Personal",
    email: "me@example.com",
    protocol: "https",
  };

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-shell-env-"));
    workDir = path.join(tmp, "work");
    personalDir = path.join(tmp, "personal");
    unboundDir = path.join(tmp, "unbound");
    fs.mkdirSync(workDir);
    fs.mkdirSync(personalDir);
    fs.mkdirSync(unboundDir);

    prevConfig = process.env.ACCT_CONFIG_DIR;
    process.env.ACCT_CONFIG_DIR = path.join(tmp, "acct-config");

    setSecretStoreForTests(new MemorySecretStore());
    let config = defaultConfig();
    config = upsertProfile(config, work);
    config = upsertProfile(config, personal);
    config = upsertBinding(config, { path: workDir, profileId: "work" });
    config = upsertBinding(config, {
      path: personalDir,
      profileId: "personal",
    });
    saveConfig(config);

    await setProfileToken(work, "gho_TEST_ONLY_work");
    await setProfileToken(personal, "gho_TEST_ONLY_personal");
  });

  afterEach(() => {
    setSecretStoreForTests(null);
    if (prevConfig === undefined) delete process.env.ACCT_CONFIG_DIR;
    else process.env.ACCT_CONFIG_DIR = prevConfig;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ignores sticky ACCT_PROFILE so directory rebinding wins", async () => {
    const exports = await buildShellEnvExports(personalDir, {
      ...process.env,
      ACCT_PROFILE: "work",
      GH_TOKEN: "gho_TEST_ONLY_work",
    });
    expect(exports.ACCT_PROFILE).toBe("personal");
    expect(exports.GH_TOKEN).toBe("gho_TEST_ONLY_personal");
  });

  it("clears tokens when unbound (I5/T5)", async () => {
    const exports = await buildShellEnvExports(unboundDir, {
      ...process.env,
      ACCT_PROFILE: "work",
      GH_TOKEN: "gho_TEST_ONLY_work",
      GITHUB_TOKEN: "gho_TEST_ONLY_stale",
      GH_ENTERPRISE_TOKEN: "gho_TEST_ONLY_ent",
      GITHUB_ENTERPRISE_TOKEN: "gho_TEST_ONLY_ent2",
      GH_HOST: "github.example.com",
    });
    expect(exports.ACCT_PROFILE).toBeNull();
    expect(exports.GH_TOKEN).toBeNull();
    expect(exports.GITHUB_TOKEN).toBeNull();
    expect(exports.GH_ENTERPRISE_TOKEN).toBeNull();
    expect(exports.GITHUB_ENTERPRISE_TOKEN).toBeNull();
    expect(exports.GH_HOST).toBeNull();
  });

  it("unsets GITHUB_ENTERPRISE_TOKEN when bound to github.com", async () => {
    const exports = await buildShellEnvExports(workDir, {
      ...process.env,
      GITHUB_ENTERPRISE_TOKEN: "gho_TEST_ONLY_ent",
    });
    expect(exports.GH_TOKEN).toBe("gho_TEST_ONLY_work");
    expect(exports.GITHUB_ENTERPRISE_TOKEN).toBeNull();
  });
});

describe("PreferKeyringStore clears file copy on set", () => {
  it("deletes file fallback after successful primary set", async () => {
    const primary = new MemorySecretStore();
    const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-pref-key-"));
    const file = new FileSecretStore(path.join(dir, "secrets.json"));
    await file.set("github.com::u", "gho_TEST_ONLY_old");
    const store = new PreferKeyringStore(primary, file);
    await store.set("github.com::u", "gho_TEST_ONLY_new");
    expect(await primary.get("github.com::u")).toBe("gho_TEST_ONLY_new");
    expect(await file.get("github.com::u")).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
