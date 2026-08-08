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

  it("I4 ACCT_PROFILE overrides local and binding", () => {
    const r = resolveProfile({
      cwd: "/Users/x/Work/repo",
      gitToplevel: "/Users/x/Work/repo",
      localAcct: { profile: "personal" },
      env: { ACCT_PROFILE: "work" },
      config: base,
    });
    expect(r.profile?.id).toBe("work");
    expect(r.reason).toBe("env");
  });

  it("I5 unbound returns null profile", () => {
    const r = resolveProfile({
      cwd: "/tmp/elsewhere",
      gitToplevel: "/tmp/elsewhere",
      config: base,
    });
    expect(r.profile).toBeNull();
    expect(r.reason).toBe("unbound");
    expect(r.enforce).toBe("off");
  });

  it("binding matches cwd even when git toplevel is an ancestor outside the binding", () => {
    const config: AcctConfig = {
      ...base,
      bindings: [{ path: "/Users/x/Work/.tmp-bound", profileId: "work" }],
    };
    const r = resolveProfile({
      cwd: "/Users/x/Work/.tmp-bound/nested",
      // Parent monorepo / test harness git root — must not hide the binding
      gitToplevel: "/Users/x/Work",
      config,
    });
    expect(r.profile?.id).toBe("work");
    expect(r.reason).toBe("binding");
  });
});
