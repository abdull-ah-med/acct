import { describe, expect, it } from "vitest";
import { hookScript, shellEnvExports } from "../../src/shell/hooks.js";

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
  });

  it("powershell hook preserves prior prompt when present", () => {
    const script = hookScript("powershell");
    expect(script).toContain("acct_ApplyEnv");
    expect(script).toContain("acct__prevPrompt");
  });
});
