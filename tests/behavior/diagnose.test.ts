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
