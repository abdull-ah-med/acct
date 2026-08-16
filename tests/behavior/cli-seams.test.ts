import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Profile } from "../../src/types.js";
import { ensureDistBuild, installFakeGh } from "../harness/fake-gh.js";
import {
  acct,
  initGitIdentity,
  makeWorkspace,
} from "../harness/workspace.js";
import {
  illegalGhFlags,
  parseGhAuthInvocations,
} from "../harness/parse-gh-fixes.js";

const work: Profile = {
  id: "work",
  githubUser: "user-a",
  host: "github.com",
  name: "User A",
  email: "user-a@example.com",
  protocol: "https",
};

describe("acct status / whoami / shell-env at the CLI seam", () => {
  beforeAll(() => {
    ensureDistBuild();
  });

  it("status: missing token + other gh principal → leak, blocked push, legal gh flags", () => {
    const ws = makeWorkspace(work);
    initGitIdentity(ws.workDir, work.name, work.email);
    const gh = installFakeGh(ws.root, { apiUser: "user-b" });
    const env = gh.env({ ...ws.env, ACCT_FOLLOW_GH: "1" });
    try {
      const r = acct(["status"], env, ws.workDir);
      const out = `${r.stdout}\n${r.stderr}`;
      expect(r.status).toBe(1);
      expect(out).toMatch(/token:\s+missing/);
      expect(out).toContain("user-b");
      expect(out).toMatch(/LEAK RISK/i);
      expect(out).toMatch(/commit\s+allowed/);
      expect(out).toMatch(/push\s+blocked/);
      expect(out).not.toMatch(/gh auth login[^\n]*--user/);
      expect(out).not.toMatch(/gh auth refresh[^\n]*--user/);
      expect(illegalGhFlags(parseGhAuthInvocations(out.split("\n")))).toEqual(
        [],
      );

      const tokenCall = gh
        .calls()
        .find((c) => c.argv[0] === "auth" && c.argv[1] === "token");
      expect(tokenCall?.argv).toEqual([
        "auth",
        "token",
        "--hostname",
        "github.com",
        "--user",
        "user-a",
      ]);
      expect(gh.calls().some((c) => c.argv[0] === "api")).toBe(true);
      expect(gh.calls().some((c) => c.argv[1] === "switch")).toBe(false);
    } finally {
      ws.close();
    }
  });

  it("whoami prints expected vs actual and exits 1 on mismatch", () => {
    const ws = makeWorkspace(work);
    const gh = installFakeGh(ws.root, { apiUser: "user-b" });
    const env = gh.env({ ...ws.env, ACCT_FOLLOW_GH: "1" });
    try {
      const r = acct(["whoami"], env, ws.workDir);
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/expected=user-a/);
      expect(r.stdout).toMatch(/actual=user-b/);
      expect(r.stdout).toMatch(/acct status/);
    } finally {
      ws.close();
    }
  });

  it("shell-env exports the live gh token for the bound tree, not a sticky GH_TOKEN", () => {
    const ws = makeWorkspace(work);
    const gh = installFakeGh(ws.root, {
      tokens: { "github.com::user-a": "gho_TEST_ONLY_live" },
    });
    const env = gh.env({
      ...ws.env,
      ACCT_FOLLOW_GH: "1",
      GH_TOKEN: "gho_TEST_ONLY_sticky",
      ACCT_PROFILE: "someone-else",
    });
    try {
      const r = acct(["shell-env"], env, ws.workDir);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("gho_TEST_ONLY_live");
      expect(r.stdout).not.toContain("sticky");
      expect(r.stdout).toMatch(/ACCT_PROFILE.*work/);
      const secrets = path.join(ws.configDir, "secrets.json");
      expect(JSON.parse(fs.readFileSync(secrets, "utf8"))).toEqual({
        "github.com::user-a": "gho_TEST_ONLY_live",
      });
    } finally {
      ws.close();
    }
  });

  it("doctor does not call gh api user unless --online", () => {
    const ws = makeWorkspace(work);
    ws.putToken("gho_TEST_ONLY_file");
    const gh = installFakeGh(ws.root, { apiUser: "user-a" });
    const env = gh.env({ ...ws.env });
    try {
      acct(["doctor"], env, ws.workDir);
      expect(gh.calls().some((c) => c.argv[0] === "api")).toBe(false);

      acct(["doctor", "--online"], env, ws.workDir);
      expect(
        gh.calls().some(
          (c) => c.argv[0] === "api" && c.argv[1] === "user",
        ),
      ).toBe(true);
    } finally {
      ws.close();
    }
  });

  it("clone child does not receive GIT_CONFIG_COUNT/KEY/VALUE (I18)", () => {
    const ws = makeWorkspace(work);
    const binDir = path.join(ws.root, "fake-git");
    fs.mkdirSync(binDir, { recursive: true });
    const dump = path.join(ws.root, "git-env.txt");
    fs.writeFileSync(
      path.join(binDir, "git"),
      `#!/bin/sh\nenv | grep '^GIT_CONFIG' > "${dump}"\nexit 0\n`,
      { mode: 0o755 },
    );
    const env = {
      ...ws.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "alias.p",
      GIT_CONFIG_VALUE_0: "!gh auth token",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    try {
      const r = acct(
        ["clone", "https://github.com/example/repo.git"],
        env,
        ws.workDir,
      );
      expect(r.status, r.stderr).toBe(0);
      const dumped = fs.existsSync(dump) ? fs.readFileSync(dump, "utf8") : "";
      expect(dumped).toContain("GIT_CONFIG_NOSYSTEM=1");
      expect(dumped).not.toMatch(/^GIT_CONFIG_COUNT=/m);
      expect(dumped).not.toMatch(/^GIT_CONFIG_KEY_0=/m);
      expect(dumped).not.toMatch(/^GIT_CONFIG_VALUE_0=/m);
    } finally {
      ws.close();
    }
  });
});
