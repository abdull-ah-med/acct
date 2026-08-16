import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Profile } from "../../src/types.js";
import { ensureDistBuild, installFakeGh } from "../harness/fake-gh.js";
import { helperGet, makeWorkspace } from "../harness/workspace.js";

const work: Profile = {
  id: "work",
  githubUser: "user-a",
  host: "github.com",
  name: "User A",
  email: "user-a@example.com",
  protocol: "https",
};

function tokenCalls(gh: ReturnType<typeof installFakeGh>) {
  return gh.calls().filter((c) => c.argv[0] === "auth" && c.argv[1] === "token");
}

function storedTokens(configDir: string): Record<string, string> {
  const file = path.join(configDir, "secrets.json");
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
}

describe("follow-gh at the credential-helper seam", () => {
  beforeAll(() => {
    ensureDistBuild();
  });

  it("HTTPS get uses gh auth token --user after gh rotates, without --import-gh", () => {
    const ws = makeWorkspace(work);
    const gh = installFakeGh(ws.root, {
      tokens: { "github.com::user-a": "gho_TEST_ONLY_first" },
    });
    const env = gh.env({
      ...ws.env,
      ACCT_FOLLOW_GH: "1",
      GH_TOKEN: "gho_TEST_ONLY_sticky_wrong",
    });
    try {
      const first = helperGet(ws.workDir, env);
      expect(first.status, first.stderr).toBe(0);
      expect(first.stdout).toContain("username=user-a");
      expect(first.stdout).toContain("password=gho_TEST_ONLY_first");
      expect(first.stdout).not.toContain("sticky_wrong");

      const tokenCall = tokenCalls(gh)[0];
      expect(tokenCall).toBeTruthy();
      expect(tokenCall!.argv).toEqual([
        "auth",
        "token",
        "--hostname",
        "github.com",
        "--user",
        "user-a",
      ]);
      expect(tokenCall!.hasGhToken).toBe(false);
      expect(tokenCall!.hasGithubToken).toBe(false);
      expect(
        gh.calls().some((c) => c.argv.includes("switch")),
      ).toBe(false);

      gh.setToken("user-a", "gho_TEST_ONLY_rotated");
      const second = helperGet(ws.workDir, env);
      expect(second.stdout).toContain("password=gho_TEST_ONLY_rotated");
      expect(second.stdout).not.toContain("gho_TEST_ONLY_first");
    } finally {
      ws.close();
    }
  });

  it("fills an empty keychain from gh without calling switch", () => {
    const ws = makeWorkspace(work);
    const gh = installFakeGh(ws.root, {
      tokens: { "github.com::user-a": "gho_TEST_ONLY_from_gh" },
    });
    const env = gh.env({ ...ws.env, ACCT_FOLLOW_GH: "1" });
    try {
      const r = helperGet(ws.workDir, env);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("password=gho_TEST_ONLY_from_gh");
      expect(tokenCalls(gh).length).toBeGreaterThan(0);
      expect(gh.calls().some((c) => c.argv[1] === "switch")).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("I17 HTTPS get returns the live token without writing secrets.json", () => {
    const ws = makeWorkspace(work);
    const gh = installFakeGh(ws.root, {
      tokens: { "github.com::user-a": "gho_TEST_ONLY_live_unpersisted" },
    });
    const env = gh.env({ ...ws.env, ACCT_FOLLOW_GH: "1" });
    try {
      expect(storedTokens(ws.configDir)).toEqual({});
      const r = helperGet(ws.workDir, env);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("username=user-a");
      expect(r.stdout).toContain("password=gho_TEST_ONLY_live_unpersisted");
      expect(storedTokens(ws.configDir)).toEqual({});
    } finally {
      ws.close();
    }
  });

  it("does not call gh or overwrite a --stdin PAT when followGh is false", () => {
    const ws = makeWorkspace({ ...work, followGh: false });
    const gh = installFakeGh(ws.root, {
      tokens: { "github.com::user-a": "gho_TEST_ONLY_from_gh" },
    });
    ws.putToken("gho_TEST_ONLY_stdin_pat");
    const env = gh.env({ ...ws.env, ACCT_FOLLOW_GH: "1" });
    try {
      const r = helperGet(ws.workDir, env);
      expect(r.stdout).toContain("password=gho_TEST_ONLY_stdin_pat");
      expect(r.stdout).not.toContain("from_gh");
      expect(gh.calls()).toEqual([]);
    } finally {
      ws.close();
    }
  });

  it("ACCT_FOLLOW_GH=0 keeps the file-store token even when fake gh has another", () => {
    const ws = makeWorkspace(work);
    const gh = installFakeGh(ws.root, {
      tokens: { "github.com::user-a": "gho_TEST_ONLY_from_gh" },
    });
    ws.putToken("gho_TEST_ONLY_file");
    const env = gh.env({ ...ws.env, ACCT_FOLLOW_GH: "0" });
    try {
      const r = helperGet(ws.workDir, env);
      expect(r.stdout).toContain("password=gho_TEST_ONLY_file");
      expect(r.stdout).not.toContain("from_gh");
      expect(gh.calls()).toEqual([]);
    } finally {
      ws.close();
    }
  });

  it("file backend without ACCT_FOLLOW_GH=1 does not spawn gh (CI default)", () => {
    const ws = makeWorkspace(work);
    const gh = installFakeGh(ws.root, {
      tokens: { "github.com::user-a": "gho_TEST_ONLY_from_gh" },
    });
    ws.putToken("gho_TEST_ONLY_file");
    const env = gh.env({ ...ws.env });
    delete env.ACCT_FOLLOW_GH;
    try {
      const r = helperGet(ws.workDir, env);
      expect(r.stdout).toContain("password=gho_TEST_ONLY_file");
      expect(gh.calls()).toEqual([]);
    } finally {
      ws.close();
    }
  });

  it("strict HTTPS get quits when neither keychain nor gh has a token", () => {
    const ws = makeWorkspace(work);
    const gh = installFakeGh(ws.root, { tokens: {} });
    const env = gh.env({ ...ws.env, ACCT_FOLLOW_GH: "1" });
    try {
      const r = helperGet(ws.workDir, env);
      expect(r.stdout).toContain("quit=1");
      expect(r.stdout).not.toContain("password=");
      expect(tokenCalls(gh).length).toBeGreaterThan(0);
    } finally {
      ws.close();
    }
  });
});
