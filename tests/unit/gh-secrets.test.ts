import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  MemorySecretStore,
  setSecretStoreForTests,
  setProfileToken,
  getProfileToken,
} from "../../src/secrets/store.js";
import { envForProfile, isDangerousGhArgv } from "../../src/gh/env.js";
import type { Profile } from "../../src/types.js";

const profile: Profile = {
  id: "work",
  githubUser: "work-user",
  host: "github.com",
  name: "Work",
  email: "work@corp.com",
  protocol: "https",
};

describe("secrets + gh env", () => {
  beforeEach(() => {
    setSecretStoreForTests(new MemorySecretStore());
  });
  afterEach(() => {
    setSecretStoreForTests(null);
  });

  it("stores tokens only in secret store", async () => {
    await setProfileToken(profile, "gho_TEST_ONLY_abc");
    expect(await getProfileToken(profile)).toBe("gho_TEST_ONLY_abc");
  });

  it("injects GH_TOKEN without requiring gh auth switch", async () => {
    await setProfileToken(profile, "gho_TEST_ONLY_abc");
    const env = await envForProfile(profile, {
      GH_TOKEN: "gho_STALE_OTHER",
      GITHUB_TOKEN: "gho_STALE_OTHER",
    });
    expect(env.GH_TOKEN).toBe("gho_TEST_ONLY_abc");
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.ACCT_PROFILE).toBe("work");
  });

  it("blocks dangerous gh subcommands detection", () => {
    expect(isDangerousGhArgv(["gh", "auth", "switch"])).toBe(true);
    expect(isDangerousGhArgv(["gh", "auth", "setup-git"])).toBe(true);
    expect(isDangerousGhArgv(["gh", "pr", "list"])).toBe(false);
  });
});
