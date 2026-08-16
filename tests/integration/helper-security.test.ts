import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { setProfileToken } from "../../src/secrets/store.js";
import {
  saveConfig,
  defaultConfig,
  upsertProfile,
  upsertBinding,
} from "../../src/config/store.js";
import type { Profile } from "../../src/types.js";

const HELPER = path.resolve("bin/git-credential-acct.js");

function helperGet(
  cwd: string,
  env: NodeJS.ProcessEnv,
  body = "protocol=https\nhost=github.com\n\n",
) {
  return spawnSync(process.execPath, [HELPER, "get"], {
    cwd,
    env: { ...process.env, ...env },
    input: body,
    encoding: "utf8",
  });
}

describe("credential helper security planes (I4/I6)", () => {
  let tmp: string;
  let workDir: string;
  let unboundDir: string;
  let configDir: string;
  let prevConfig: string | undefined;
  let prevBackend: string | undefined;

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
    githubUser: "me",
    host: "github.com",
    name: "Me",
    email: "me@example.com",
    protocol: "https",
  };

  beforeEach(async () => {
    // bin/git-credential-acct.js loads dist/ (gitignored) — ensure build exists
    const built = fs.existsSync(
      path.resolve("dist/credential/helper.js"),
    );
    if (!built) {
      const b = spawnSync("npm", ["run", "build"], {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      if (b.status !== 0) {
        throw new Error(`npm run build failed: ${b.stderr || b.stdout}`);
      }
    }

    tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-helper-sec-"));
    workDir = path.join(tmp, "work");
    unboundDir = path.join(tmp, "unbound");
    configDir = path.join(tmp, "config");
    fs.mkdirSync(workDir);
    fs.mkdirSync(unboundDir);
    prevConfig = process.env.ACCT_CONFIG_DIR;
    prevBackend = process.env.ACCT_SECRET_BACKEND;
    process.env.ACCT_CONFIG_DIR = configDir;
    process.env.ACCT_SECRET_BACKEND = "file";

    let config = defaultConfig();
    config = upsertProfile(config, work);
    config = upsertProfile(config, personal);
    config = upsertBinding(config, { path: workDir, profileId: "work" });
    saveConfig(config);

    // Child helper process reads file backend — do not use in-memory override
    await setProfileToken(work, "gho_TEST_ONLY_work_token");
    await setProfileToken(personal, "gho_TEST_ONLY_personal_token");
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.ACCT_CONFIG_DIR;
    else process.env.ACCT_CONFIG_DIR = prevConfig;
    if (prevBackend === undefined) delete process.env.ACCT_SECRET_BACKEND;
    else process.env.ACCT_SECRET_BACKEND = prevBackend;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("I4 ignores ambient ACCT_PROFILE in bound tree", () => {
    const r = helperGet(workDir, {
      ACCT_CONFIG_DIR: configDir,
      ACCT_SECRET_BACKEND: "file",
      ACCT_PROFILE: "personal",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("username=work-user");
    expect(r.stdout).toContain("gho_TEST_ONLY_work_token");
    expect(r.stdout).not.toContain("personal_token");
  });

  it("I6 unbound strict returns quit=1 with no password", () => {
    const r = helperGet(unboundDir, {
      ACCT_CONFIG_DIR: configDir,
      ACCT_SECRET_BACKEND: "file",
    });
    expect(r.stdout).toContain("quit=1");
    expect(r.stdout).not.toContain("password=");
  });

  it("I6 unbound off returns empty (no quit)", () => {
    let config = defaultConfig();
    config.defaultEnforce = "off";
    config = upsertProfile(config, work);
    config = upsertBinding(config, { path: workDir, profileId: "work" });
    saveConfig(config);

    const r = helperGet(unboundDir, {
      ACCT_CONFIG_DIR: configDir,
      ACCT_SECRET_BACKEND: "file",
    });
    expect(r.stdout).not.toContain("quit=1");
    expect(r.stdout).not.toContain("password=");
  });

  it("I16 http protocol get returns quit=1 with no password", () => {
    const r = helperGet(
      workDir,
      { ACCT_CONFIG_DIR: configDir, ACCT_SECRET_BACKEND: "file" },
      "protocol=http\nhost=github.com\n\n",
    );
    expect(r.stdout).toContain("quit=1");
    expect(r.stdout).not.toContain("password=");
  });

  it("I7 non-default port does not receive token", () => {
    const env = { ACCT_CONFIG_DIR: configDir, ACCT_SECRET_BACKEND: "file" };
    const bad = helperGet(
      workDir,
      env,
      "protocol=https\nhost=github.com:8443\n\n",
    );
    expect(bad.stdout).toContain("quit=1");
    expect(bad.stdout).not.toContain("password=");

    const ok443 = helperGet(
      workDir,
      env,
      "protocol=https\nhost=github.com:443\n\n",
    );
    expect(ok443.stdout).toContain("gho_TEST_ONLY_work_token");
  });

  it("I7 profile host github.com:443 still fills git's default host=github.com", async () => {
    const pinned: Profile = { ...work, host: "github.com:443" };
    let config = defaultConfig();
    config = upsertProfile(config, pinned);
    config = upsertBinding(config, { path: workDir, profileId: "work" });
    saveConfig(config);
    await setProfileToken(pinned, "gho_TEST_ONLY_work_token");
    const r = helperGet(
      workDir,
      { ACCT_CONFIG_DIR: configDir, ACCT_SECRET_BACKEND: "file" },
      "protocol=https\nhost=github.com\n\n",
    );
    expect(r.stdout).toContain("password=gho_TEST_ONLY_work_token");
    expect(r.stdout).not.toContain("quit=1");
  });

  it("I7 duplicate host lines fail closed", () => {
    const r = helperGet(
      workDir,
      { ACCT_CONFIG_DIR: configDir, ACCT_SECRET_BACKEND: "file" },
      "protocol=https\nhost=evil.com\nhost=github.com\n\n",
    );
    expect(r.stdout).toContain("quit=1");
    expect(r.stdout).not.toContain("password=");
  });

  it("I17 store is ignored (no cross-account poison)", async () => {
    const env = { ACCT_CONFIG_DIR: configDir, ACCT_SECRET_BACKEND: "file" };
    spawnSync(
      process.execPath,
      [HELPER, "store"],
      {
        cwd: workDir,
        env: { ...process.env, ...env },
        input:
          "protocol=https\nhost=github.com\nusername=work-user\npassword=gho_TEST_ONLY_personal_token\n\n",
        encoding: "utf8",
      },
    );
    const r = helperGet(workDir, env);
    expect(r.stdout).toContain("gho_TEST_ONLY_work_token");
    expect(r.stdout).not.toContain("personal_token");
  });

  it("I17 erase only when password matches stored token", async () => {
    const env = { ACCT_CONFIG_DIR: configDir, ACCT_SECRET_BACKEND: "file" };
    spawnSync(
      process.execPath,
      [HELPER, "erase"],
      {
        cwd: workDir,
        env: { ...process.env, ...env },
        input:
          "protocol=https\nhost=github.com\nusername=work-user\npassword=gho_WRONG\n\n",
        encoding: "utf8",
      },
    );
    let r = helperGet(workDir, env);
    expect(r.stdout).toContain("gho_TEST_ONLY_work_token");

    spawnSync(
      process.execPath,
      [HELPER, "erase"],
      {
        cwd: workDir,
        env: { ...process.env, ...env },
        input:
          "protocol=https\nhost=github.com\nusername=work-user\npassword=gho_TEST_ONLY_work_token\n\n",
        encoding: "utf8",
      },
    );
    r = helperGet(workDir, env);
    expect(r.stdout).toContain("quit=1");
    expect(r.stdout).not.toContain("password=");
  });
});
