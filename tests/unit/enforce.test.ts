import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  checkCommitIdentity,
  formatBlockMessage,
} from "../../src/enforce/checks.js";
import {
  defaultConfig,
  saveConfig,
  upsertBinding,
  upsertProfile,
} from "../../src/config/store.js";
import type { Profile } from "../../src/types.js";

describe("enforcement", () => {
  let tmp: string;
  let prevConfig: string | undefined;

  const profile: Profile = {
    id: "work",
    githubUser: "work-user",
    host: "github.com",
    name: "Work User",
    email: "work@corp.com",
    protocol: "https",
    enforce: "strict",
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-acct-enf-"));
    prevConfig = process.env.ACCT_CONFIG_DIR;
    process.env.ACCT_CONFIG_DIR = path.join(tmp, "acct-config");
    let config = defaultConfig();
    config = upsertProfile(config, profile);
    config = upsertBinding(config, { path: tmp, profileId: "work" });
    saveConfig(config);
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.ACCT_CONFIG_DIR;
    else process.env.ACCT_CONFIG_DIR = prevConfig;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("I11 blocks wrong commit identity in strict mode", async () => {
    const result = await checkCommitIdentity(tmp, process.env, (key) => {
      if (key === "user.email") return "wrong@example.com";
      if (key === "user.name") return "Wrong";
      return "";
    });
    expect(result.ok).toBe(false);
    expect(result.messages.some((m) => m.includes("work@corp.com"))).toBe(
      true,
    );
    const msg = formatBlockMessage("commit", profile, result.messages);
    expect(msg).toContain("blocked commit");
  });

  it("allows matching identity", async () => {
    const result = await checkCommitIdentity(tmp, process.env, (key) => {
      if (key === "user.email") return profile.email;
      if (key === "user.name") return profile.name;
      return "";
    });
    expect(result.ok).toBe(true);
  });
});
