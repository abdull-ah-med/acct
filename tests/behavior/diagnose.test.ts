import { describe, expect, it } from "vitest";
import { diagnose, formatDiagnoseReport, type DiagnoseInput } from "../../src/status/explain.js";
import {
  illegalGhFlags,
  parseGhAuthInvocations,
} from "../harness/parse-gh-fixes.js";

function scenario(over: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    profileId: "work",
    githubUser: "user-a",
    host: "github.com",
    name: "User A",
    email: "user-a@example.com",
    protocol: "https",
    enforce: "strict",
    hasToken: false,
    authPrincipal: "user-b",
    principalChecked: true,
    commitName: "User A",
    commitEmail: "user-a@example.com",
    ...over,
  };
}

describe("diagnose: commit/push/gh outlook (product rules)", () => {
  it("strict + missing token + matching includeIf: commit allowed, push blocked, no push as the other user", () => {
    const report = diagnose(scenario());
    expect(report.commit.outlook).toBe("allowed");
    expect(report.push.outlook).toBe("blocked");
    expect(report.gh.outlook).toBe("leak");
    expect(report.issues.map((i) => i.code).sort()).toEqual([
      "principal-mismatch",
      "token-missing",
    ]);
    expect(report.push.explanation).toContain("user-b");
    expect(report.commit.explanation).toContain("user-a@example.com");
    expect(report.commit.explanation).toContain("user-b");
  });

  it("strict + matching token/principal/identity: no issues, commit and push allowed", () => {
    const report = diagnose(
      scenario({ hasToken: true, authPrincipal: "user-a" }),
    );
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.commit.outlook).toBe("allowed");
    expect(report.push.outlook).toBe("allowed");
    expect(formatDiagnoseReport(report)).toBe("");
  });

  it("warn + missing HTTPS token: push is a fallthrough risk, not a hard block", () => {
    const report = diagnose(scenario({ enforce: "warn" }));
    expect(report.push.outlook).toBe("risk");
    expect(report.commit.outlook).toBe("allowed");
  });

  it("strict + includeIf mismatch: commit blocked", () => {
    const report = diagnose(
      scenario({
        hasToken: true,
        authPrincipal: "user-a",
        commitName: "Other",
        commitEmail: "other@example.com",
      }),
    );
    expect(report.commit.outlook).toBe("blocked");
    expect(report.issues.some((i) => i.code === "commit-identity-mismatch")).toBe(
      true,
    );
  });

  it("strict + stored PAT for the other user: push blocked; --no-verify would leak", () => {
    const report = diagnose(
      scenario({ hasToken: true, authPrincipal: "user-b" }),
    );
    expect(report.push.outlook).toBe("blocked");
    expect(report.push.explanation).toMatch(/--no-verify/);
    expect(report.push.explanation).toContain("user-b");
  });

  it("warn + stored PAT for the other user: push would go through as that user", () => {
    const report = diagnose(
      scenario({ hasToken: true, authPrincipal: "user-b", enforce: "warn" }),
    );
    expect(report.push.outlook).toBe("risk");
    expect(report.push.explanation).toContain("user-b");
  });

  it("skips principal issues when the live check was not run", () => {
    const report = diagnose(
      scenario({ authPrincipal: null, principalChecked: false }),
    );
    expect(report.issues.map((i) => i.code)).toEqual(["token-missing"]);
    expect(report.push.outlook).toBe("blocked");
    expect(report.gh.outlook).toBe("risk");
  });

  it("outside a git repo: unset identity is not a commit error and does not suggest acct install", () => {
    // includeIf gitdir only matches when $GIT_DIR matches the glob
    // (git-config Conditional includes). Binding-root status must not
    // treat expected-unset identity as I11.
    const report = diagnose(
      scenario({
        hasToken: true,
        authPrincipal: "user-a",
        commitName: "",
        commitEmail: "",
        inGitRepo: false,
      }),
    );
    expect(report.issues.map((i) => i.code)).not.toContain(
      "commit-identity-mismatch",
    );
    expect(report.ok).toBe(true);
    expect(report.fixes).not.toContain("acct install");
    expect(report.commit.outlook).toBe("n/a");
    expect(report.push.outlook).toBe("n/a");
  });

  it("local user.* override: fix unsets local config, not only acct install", () => {
    // git-config FILES: local last-wins. includeIf cannot override
    // $GIT_DIR/config user.name / user.email.
    const report = diagnose(
      scenario({
        hasToken: true,
        authPrincipal: "user-a",
        commitName: "Other",
        commitEmail: "other@example.com",
        inGitRepo: true,
        localIdentityOverride: true,
      }),
    );
    expect(report.commit.outlook).toBe("blocked");
    expect(report.issues.some((i) => i.code === "commit-identity-mismatch")).toBe(
      true,
    );
    expect(report.fixes).toContain(
      "git config --local --unset-all user.name",
    );
    expect(report.fixes).toContain(
      "git config --local --unset-all user.email",
    );
    expect(report.fixes.indexOf("git config --local --unset-all user.email")).toBeLessThan(
      report.fixes.indexOf("acct install") === -1
        ? Number.POSITIVE_INFINITY
        : report.fixes.indexOf("acct install"),
    );
  });

  it("gh stored active account ≠ profile: warn + switch path; do not treat raw gh as the profile user", () => {
    // I10: acct injects GH_TOKEN and does not call gh auth switch.
    // authPrincipal can still be the profile user. Raw gh without the
    // hook follows the stored active account
    // (https://cli.github.com/manual/gh_auth_status).
    const report = diagnose(
      scenario({
        hasToken: true,
        authPrincipal: "user-a",
        ghActiveUser: "user-b",
        ghActiveChecked: true,
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.issues.map((i) => i.code)).toEqual(["gh-active-mismatch"]);
    expect(report.gh.outlook).toBe("risk");
    expect(report.gh.explanation).toContain("user-b");
    expect(report.fixes).toContain(
      "gh auth switch --hostname github.com --user user-a",
    );
    expect(report.fixes.some((c) => c.startsWith("acct exec"))).toBe(true);
  });
});

describe("diagnose: emitted gh commands vs GitHub CLI manuals", () => {
  it("every gh auth flag in the fix list is in tests/fixtures/gh-auth-flags.json", () => {
    const report = diagnose(scenario());
    const invocations = parseGhAuthInvocations(report.fixes);
    expect(invocations.length).toBeGreaterThan(0);
    expect(illegalGhFlags(invocations)).toEqual([]);
    expect(invocations.some((i) => i.verb === "login" && i.flags.includes("user"))).toBe(
      false,
    );
    expect(
      invocations.some((i) => i.verb === "refresh" && i.flags.includes("user")),
    ).toBe(false);
  });

  it("formatted report never suggests flags the manuals reject", () => {
    const text = formatDiagnoseReport(diagnose(scenario()));
    expect(text).toMatch(/what's wrong/i);
    expect(text).toMatch(/fix/i);
    expect(text).toMatch(/commit\s+allowed/);
    expect(text).toMatch(/push\s+blocked/);
    expect(illegalGhFlags(parseGhAuthInvocations(text.split("\n")))).toEqual(
      [],
    );
  });

  it("rejects login --user against the fixture (manuals do not list it)", () => {
    expect(
      illegalGhFlags([{ verb: "login", flags: ["hostname", "user"] }]),
    ).toEqual(["gh auth login does not support --user"]);
  });
});
