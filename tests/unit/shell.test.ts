import { describe, expect, it } from "vitest";
import { hookScript, shellEnvExports } from "../../src/shell/hooks.js";
import { resolveAcctCliPaths } from "../../src/enforce/hooks.js";
import { posixShellSingleQuote } from "../../src/util/paths.js";

describe("shell hooks", () => {
  it("emits hooks for all supported shells", () => {
    for (const s of ["bash", "zsh", "fish", "powershell"] as const) {
      const script = hookScript(s);
      expect(script.length).toBeGreaterThan(20);
      expect(script.toLowerCase()).toContain("acct");
    }
  });

  it("exports and unsets env vars", () => {
    const sh = shellEnvExports({
      ACCT_PROFILE: "work",
      GH_TOKEN: "gho_TEST_ONLY",
      GITHUB_TOKEN: null,
    });
    expect(sh).toContain("export ACCT_PROFILE=");
    expect(sh).toContain("unset GITHUB_TOKEN");
    expect(sh).toContain("acct hook");
  });

  it("powershell hook preserves prior prompt when present", () => {
    const script = hookScript("powershell");
    expect(script).toContain("acct_ApplyEnv");
    expect(script).toContain("acct__prevPrompt");
  });

  it("bash hook PROMPT_COMMAND prepend is idempotent", () => {
    const script = hookScript("bash");
    expect(script).toContain('case ":${PROMPT_COMMAND-}:" in');
    expect(script).toContain('*":acct_chpwd;"*)');
    // cwd-change gate
    expect(script).toContain('[ "$PWD" = "${_ACCT_LAST_PWD-}" ] && return');
  });

  it("invokes shell-env via absolute node + acct.js, not PATH acct (I11b)", () => {
    const script = hookScript("zsh");
    const { node, acctJs } = resolveAcctCliPaths();
    expect(script).toContain(
      `${posixShellSingleQuote(node)} ${posixShellSingleQuote(acctJs)} shell-env`,
    );
    expect(script).not.toContain("$(acct shell-env)");
    expect(script).not.toContain("`acct shell-env`");
  });

  it("powershell hook guards against re-wrapping prompt", () => {
    const script = hookScript("powershell");
    expect(script).toContain("Test-Path variable:acct__prevPrompt");
    // Only one function prompt definition after the sentinel
    const wraps = script.match(/function prompt/g) ?? [];
    expect(wraps.length).toBe(1);
  });
});
