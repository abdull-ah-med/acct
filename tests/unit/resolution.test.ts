import { describe, expect, it } from "vitest";
import { resolveProfile } from "../../src/resolution/resolve.js";
import type { AcctConfig } from "../../src/types.js";

const base: AcctConfig = {
  version: 1,
  defaultEnforce: "strict",
  profiles: [
    {
      id: "work",
      githubUser: "work-user",
      host: "github.com",
      name: "Work",
      email: "work@corp.com",
      protocol: "https",
    },
    {
      id: "personal",
      githubUser: "me",
      host: "github.com",
      name: "Me",
      email: "me@example.com",
      protocol: "https",
    },
  ],
  bindings: [
    { path: "/Users/x/Work", profileId: "work" },
    { path: "/Users/x/Work/special", profileId: "personal" },
    { path: "/Users/x/Code", profileId: "personal" },
  ],
};

describe("resolution (invariants I1–I5)", () => {
  it("I1/I2 longest binding wins", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/special/repo",
      gitToplevel: "/Users/x/Work/special/repo",
      config: base,
    });
    expect(r.profile?.id).toBe("personal");
    expect(r.reason).toBe("binding");
  });

  it("I2 shorter prefix when not under longer", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/other",
      gitToplevel: "/Users/x/Work/other",
      config: base,
    });
    expect(r.profile?.id).toBe("work");
  });

  it("I3 local .acct overrides binding", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      gitToplevel: "/Users/x/Work/repo",
      localAcct: { profile: "personal" },
      config: base,
    });
    expect(r.profile?.id).toBe("personal");
    expect(r.reason).toBe("local");
  });

  it("I3 empty .acct does not fall through to parent binding", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      gitToplevel: "/Users/x/Work/repo",
      localAcct: { profile: "" },
      config: base,
    });
    expect(r.profile).toBeNull();
    expect(r.reason).toBe("local");
  });

  it("I3 whitespace-only .acct profile is local unbound", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      gitToplevel: "/Users/x/Work/repo",
      localAcct: { profile: "   " },
      config: base,
    });
    expect(r.profile).toBeNull();
    expect(r.reason).toBe("local");
  });

  it("I3 unknown .acct profile is local unbound (not parent)", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      gitToplevel: "/Users/x/Work/repo",
      localAcct: { profile: "does-not-exist" },
      config: base,
    });
    expect(r.profile).toBeNull();
    expect(r.reason).toBe("local");
  });

  it("I4 ambient ACCT_PROFILE is ignored by default (directory wins)", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      gitToplevel: "/Users/x/Work/repo",
      localAcct: { profile: "personal" },
      env: { ACCT_PROFILE: "work" },
      config: base,
    });
    expect(r.profile?.id).toBe("personal");
    expect(r.reason).toBe("local");
  });

  it("I4 CLI forcedProfileId selects profile", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      gitToplevel: "/Users/x/Work/repo",
      localAcct: { profile: "personal" },
      forcedProfileId: "work",
      config: base,
    });
    expect(r.profile?.id).toBe("work");
    expect(r.reason).toBe("cli");
  });

  it("I4 allowEnvProfile=true honors ambient (legacy/test only)", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      gitToplevel: "/Users/x/Work/repo",
      localAcct: { profile: "personal" },
      env: { ACCT_PROFILE: "work" },
      allowEnvProfile: true,
      config: base,
    });
    expect(r.profile?.id).toBe("work");
    expect(r.reason).toBe("env");
  });

  it("I5 unbound returns null profile with defaultEnforce", () => {
    const r = resolveProfile({
      cwd: "/tmp/elsewhere",
      gitToplevel: "/tmp/elsewhere",
      config: base,
    });
    expect(r.profile).toBeNull();
    expect(r.reason).toBe("unbound");
    expect(r.enforce).toBe("strict");
  });

  it("unbound uses config.defaultEnforce=off when configured", () => {
    const r = resolveProfile({
      cwd: "/tmp/elsewhere",
      config: { ...base, defaultEnforce: "off" },
    });
    expect(r.enforce).toBe("off");
  });

  it("binding matches cwd even when git toplevel is an ancestor outside the binding", () => {
    const config: AcctConfig = {
      ...base,
      bindings: [{ path: "/Users/x/Work/.tmp-bound", profileId: "work" }],
    };
    const r = resolveProfile({
      cwd: "/Users/x/Work/.tmp-bound/nested",
      gitToplevel: "/Users/x/Work",
      config,
    });
    expect(r.profile?.id).toBe("work");
    expect(r.reason).toBe("binding");
  });

  it("I3/I4 forced profile matches id only, not githubUser", () => {
    const r = resolveProfile({
      cwd: "/tmp",
      config: base,
      forcedProfileId: "work-user",
    });
    expect(r.profile).toBeNull();
    expect(r.reason).toBe("cli");
  });

  it("I3 .acct profile matches id only, not githubUser", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      localAcct: { profile: "work-user" },
      config: base,
    });
    expect(r.profile).toBeNull();
    expect(r.reason).toBe("local");
  });
});
