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
});
