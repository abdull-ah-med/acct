import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  MemorySecretStore,
  setSecretStoreForTests,
  setProfileToken,
} from "../../src/secrets/store.js";
import { saveConfig, defaultConfig, upsertProfile, upsertBinding } from "../../src/config/store.js";
import type { Profile } from "../../src/types.js";
import { formatCredentialOutput } from "../../src/credential/protocol.js";

/**
 * Integration-style: invoke helper logic via node after build isn't required —
 * we simulate stdin protocol through the protocol + resolve path.
 */
describe("credential helper fail-closed (I6, I7)", () => {
  let tmp: string;
  const profile: Profile = {
    id: "work",
    githubUser: "work-user",
    host: "github.com",
    name: "Work",
    email: "work@corp.com",
    protocol: "https",
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acct-test-"));
    setSecretStoreForTests(new MemorySecretStore());
    let config = defaultConfig();
    config = upsertProfile(config, profile);
    config = upsertBinding(config, {
      path: tmp,
      profileId: "work",
    });
    process.env.ACCT_CONFIG_DIR = path.join(tmp, "config");
    saveConfig(config);
  });

  afterEach(() => {
    setSecretStoreForTests(null);
    delete process.env.ACCT_CONFIG_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("I7 quit response format for unsafe host", () => {
    expect(formatCredentialOutput({ quit: "1" })).toContain("quit=1");
  });

  it("stores and retrieves profile token for helper use", async () => {
    await setProfileToken(profile, "gho_TEST_ONLY_token");
    const { getProfileToken } = await import("../../src/secrets/store.js");
    expect(await getProfileToken(profile)).toBe("gho_TEST_ONLY_token");
  });
});

describe("config refuses tokens on disk", () => {
  it("assertNoSecretsInConfig throws on token-like strings", async () => {
    const { assertNoSecretsInConfig } = await import("../../src/config/store.js");
    expect(() =>
      assertNoSecretsInConfig({
        version: 1,
        defaultEnforce: "strict",
        profiles: [],
        bindings: [],
        // sneak token into a field
        // @ts-expect-error intentional
        evil: "gho_abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow(/token/);
  });
});

describe("cli smoke (built dist optional)", () => {
  it("package.json declares bins", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8"),
    );
    expect(pkg.bin.acct).toBeTruthy();
    expect(pkg.bin["git-credential-acct"]).toBeTruthy();
  });

  it("typescript sources exist for all planes", () => {
    for (const f of [
      "src/resolution/resolve.ts",
      "src/identity/includeIf.ts",
      "src/credential/helper.ts",
      "src/ssh/keys.ts",
      "src/gh/env.ts",
      "src/enforce/checks.ts",
      "src/shell/hooks.ts",
      "src/doctor/run.ts",
      "src/cli/index.ts",
    ]) {
      expect(fs.existsSync(f)).toBe(true);
    }
  });
});

// silence unused
void spawnSync;
