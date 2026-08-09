import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  MemorySecretStore,
  setSecretStoreForTests,
  setProfileToken,
  getProfileToken,
} from "../../src/secrets/store.js";
import { envForProfile, isDangerousGhArgv, shellScriptHasDangerousGhAuth } from "../../src/gh/env.js";
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

  it("blocks dangerous gh auth subcommands (login/logout/refresh/token/switch/setup-git)", () => {
    for (const sub of [
      "login",
      "logout",
      "refresh",
      "token",
      "switch",
      "setup-git",
    ]) {
      expect(isDangerousGhArgv(["gh", "auth", sub])).toBe(true);
    }
    expect(isDangerousGhArgv(["gh", "auth", "status"])).toBe(false);
    expect(isDangerousGhArgv(["gh", "pr", "list"])).toBe(false);
    expect(isDangerousGhArgv(["git", "auth", "token"])).toBe(false);
    expect(isDangerousGhArgv(["gh", "Auth", "token"])).toBe(true);
    expect(isDangerousGhArgv(["gh", "auth", "TOKEN"])).toBe(true);
  });

  it("I18: absolute gh path and env wrappers are denied", () => {
    expect(isDangerousGhArgv(["/usr/bin/gh", "auth", "token"])).toBe(true);
    expect(isDangerousGhArgv(["/opt/homebrew/bin/gh", "auth", "login"])).toBe(
      true,
    );
    expect(isDangerousGhArgv(["env", "gh", "auth", "token"])).toBe(true);
    expect(
      isDangerousGhArgv(["env", "FOO=1", "gh", "auth", "switch"]),
    ).toBe(true);
    expect(isDangerousGhArgv(["nice", "gh", "auth", "logout"])).toBe(true);
    expect(isDangerousGhArgv(["gh.exe", "auth", "token"])).toBe(true);
    expect(isDangerousGhArgv(["env", "gh", "auth", "status"])).toBe(false);
    expect(isDangerousGhArgv(["/usr/bin/gh", "pr", "list"])).toBe(false);
  });

  it("I18: xargs → gh or shell is fail-closed (stdin / -I{} invisible)", () => {
    // Stdin can append `auth token` — refuse any xargs whose utility is gh.
    expect(isDangerousGhArgv(["xargs", "gh"])).toBe(true);
    expect(isDangerousGhArgv(["xargs", "-n2", "gh"])).toBe(true);
    expect(isDangerousGhArgv(["xargs", "gh", "auth", "token"])).toBe(true);
    expect(isDangerousGhArgv(["xargs", "gh", "pr", "list"])).toBe(true);
    expect(
      isDangerousGhArgv(["xargs", "-I{}", "gh", "auth", "token"]),
    ).toBe(true);
    expect(
      isDangerousGhArgv(["xargs", "-I", "%", "gh", "auth", "login"]),
    ).toBe(true);
    expect(
      isDangerousGhArgv(["xargs", "-I{}", "/usr/bin/gh", "auth", "token"]),
    ).toBe(true);
    expect(isDangerousGhArgv(["xargs", "-I{}", "gh", "auth", "{}"])).toBe(
      true,
    );
    expect(isDangerousGhArgv(["env", "xargs", "-n2", "gh"])).toBe(true);
    expect(isDangerousGhArgv(["nice", "xargs", "gh"])).toBe(true);
    // Shell utility: -I{} can substitute into -c scripts after unset GH_TOKEN.
    expect(
      isDangerousGhArgv(["xargs", "-I{}", "bash", "-c", "gh auth token"]),
    ).toBe(true);
    expect(
      isDangerousGhArgv([
        "xargs",
        "-I{}",
        "sh",
        "-c",
        "unset GH_TOKEN; gh auth {} --user other",
      ]),
    ).toBe(true);
    expect(isDangerousGhArgv(["xargs", "bash", "-c", "echo hi"])).toBe(true);
    expect(isDangerousGhArgv(["xargs", "echo", "ok"])).toBe(false);
    expect(isDangerousGhArgv(["xargs", "rm", "-f"])).toBe(false);
  });

  it("I18: shell -c scripts invoking gh auth dangerous are denied", () => {
    expect(
      isDangerousGhArgv(["bash", "-c", "gh auth token"]),
    ).toBe(true);
    expect(
      isDangerousGhArgv(["sh", "-c", "gh auth token --user x"]),
    ).toBe(true);
    expect(
      isDangerousGhArgv(["zsh", "-lc", "/usr/bin/gh auth login"]),
    ).toBe(true);
    expect(
      isDangerousGhArgv(["bash", "-c", "echo hello && gh auth switch"]),
    ).toBe(true);
    expect(isDangerousGhArgv(["bash", "-c", "gh pr list"])).toBe(false);
    expect(isDangerousGhArgv(["bash", "-c", "echo ok"])).toBe(false);
    expect(isDangerousGhArgv(["bash", "-c", "gh auth status"])).toBe(false);
  });

  it("I18: shell -c obfuscation (quotes, expansions, xargs pipe) denied", () => {
    const denied = [
      `"gh" "auth" "token"`,
      `'gh' 'auth' 'switch'`,
      `g=gh; $g auth token`,
      `cmd=gh; $cmd auth login`,
      `x=auth; gh $x switch`,
      `unset GH_TOKEN GITHUB_TOKEN; x=auth; gh $x switch --user other`,
      `$(command -v gh) auth token`,
      `$(which gh) auth logout`,
      "`which gh` auth token",
      `echo auth token | xargs gh`,
      `printf '%s\\n' auth token | xargs gh`,
      `gh auth refres""h`,
      `f(){ gh auth token; }; f`,
      // Round-2 live bypasses (2026-08-08)
      `a=to; b=ken; gh auth $a$b`,
      `gh auth "$(echo token)"`,
      `gh auth $(echo token)`,
      `IFS=; gh$IFS auth$IFS token`,
      `IFS=; gh"$IFS" auth"$IFS" token`,
      String.raw`printf 'auth\ntoken\n' | xargs -n2 gh`,
      `printf 'auth\\ntoken\\n' | xargs -n2 gh`,
      `echo Z2ggYXV0aCB0b2tlbg== | base64 -d | sh`,
      `base64 -d <<<'Z2ggYXV0aCB0b2tlbg==' | bash`,
      `eval "$(base64 -d <<<'Z2ggYXV0aCB0b2tlbg==')"`,
    ];
    for (const script of denied) {
      expect(shellScriptHasDangerousGhAuth(script), script).toBe(true);
      expect(isDangerousGhArgv(["bash", "-c", script]), script).toBe(true);
      expect(isDangerousGhArgv(["zsh", "-c", script]), script).toBe(true);
    }

    const allowed = [
      `gh pr list`,
      `gh auth status`,
      `echo auth token`,
      `echo hello`,
      `xargs echo auth token`,
      `base64 -d <<<'aGVsbG8='`,
      `echo hello | cat`,
    ];
    for (const script of allowed) {
      expect(shellScriptHasDangerousGhAuth(script), script).toBe(false);
      expect(isDangerousGhArgv(["bash", "-c", script]), script).toBe(false);
    }
  });
});
