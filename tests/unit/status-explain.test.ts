import { describe, expect, it } from "vitest";
import {
  diagnose,
  formatDiagnoseReport,
  diagnoseHasErrors,
  type DiagnoseInput,
} from "../../src/status/explain.js";

/** The inbox-triage / mair vs abdull-ah-med leak-risk snapshot. */
function leakRiskInput(over: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    profileId: "mair",
    githubUser: "reachrazamair",
    host: "github.com",
    name: "reachrazamair",
    email: "mairahmed007@gmail.com",
    protocol: "https",
    enforce: "strict",
    hasToken: false,
    authPrincipal: "abdull-ah-med",
    principalChecked: true,
    commitName: "reachrazamair",
    commitEmail: "mairahmed007@gmail.com",
    ...over,
  };
}

describe("diagnose cwd problems", () => {
  it("explains token-missing + wrong gh principal: commit ok, push blocked, no wrong-account push", () => {
    const report = diagnose(leakRiskInput());
    expect(diagnoseHasErrors(report)).toBe(true);
    expect(report.issues.map((i) => i.code)).toEqual([
      "token-missing",
      "principal-mismatch",
    ]);
    expect(report.commit.outlook).toBe("allowed");
    expect(report.commit.explanation).toMatch(/reachrazamair <mairahmed007@gmail.com>/);
    expect(report.commit.explanation).toMatch(/will not use abdull-ah-med/);
    expect(report.push.outlook).toBe("blocked");
    expect(report.push.explanation).toMatch(/will not push as abdull-ah-med/);
    expect(report.push.explanation).toMatch(/quit/);
    expect(report.gh.outlook).toBe("leak");
    expect(report.gh.explanation).toMatch(/abdull-ah-med/);
    expect(report.fixes).toContain(
      "gh auth login --hostname github.com --user reachrazamair",
    );
    expect(report.fixes).toContain("acct profile token mair --import-gh");
    expect(report.fixes).toContain("acct status");
  });

  it("formats a terminal block covering what's wrong, fix, and commit/push", () => {
    const text = formatDiagnoseReport(diagnose(leakRiskInput()));
    expect(text).toMatch(/what's wrong/);
    expect(text).toMatch(/no token in the OS keychain/);
    expect(text).toMatch(/abdull-ah-med/);
    expect(text).toMatch(/reachrazamair/);
    expect(text).toMatch(/fix/);
    expect(text).toMatch(/acct profile token mair --import-gh/);
    expect(text).toMatch(/commit \/ push in this state/);
    expect(text).toMatch(/commit\s+allowed/);
    expect(text).toMatch(/push\s+blocked/);
    expect(text).toMatch(/gh\s+leak/);
  });

  it("warn+missing token: HTTPS push may fall through to the wrong cached account", () => {
    const report = diagnose(leakRiskInput({ enforce: "warn" }));
    expect(report.push.outlook).toBe("risk");
    expect(report.push.explanation).toMatch(/will not block/);
    expect(report.push.explanation).toMatch(/osxkeychain|wincred|cached/);
    expect(report.commit.outlook).toBe("allowed");
  });

  it("wrong stored PAT in strict: push blocked, --no-verify would leak", () => {
    const report = diagnose(
      leakRiskInput({ hasToken: true, authPrincipal: "abdull-ah-med" }),
    );
    expect(report.issues.some((i) => i.code === "principal-mismatch")).toBe(
      true,
    );
    expect(report.push.outlook).toBe("blocked");
    expect(report.push.explanation).toMatch(/--no-verify/);
    expect(report.push.explanation).toMatch(/abdull-ah-med/);
  });

  it("wrong stored PAT in warn: push would go through as the other account", () => {
    const report = diagnose(
      leakRiskInput({
        hasToken: true,
        authPrincipal: "abdull-ah-med",
        enforce: "warn",
      }),
    );
    expect(report.push.outlook).toBe("risk");
    expect(report.push.explanation).toMatch(/would go through as abdull-ah-med/);
  });

  it("commit identity mismatch in strict blocks commit", () => {
    const report = diagnose(
      leakRiskInput({
        hasToken: true,
        authPrincipal: "reachrazamair",
        commitName: "Abdullah",
        commitEmail: "abdullah@example.com",
      }),
    );
    expect(report.issues.some((i) => i.code === "commit-identity-mismatch")).toBe(
      true,
    );
    expect(report.commit.outlook).toBe("blocked");
    expect(report.fixes).toContain("acct install");
  });

  it("healthy profile is ok with no extra issues", () => {
    const report = diagnose(
      leakRiskInput({
        hasToken: true,
        authPrincipal: "reachrazamair",
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.commit.outlook).toBe("allowed");
    expect(report.push.outlook).toBe("allowed");
    expect(formatDiagnoseReport(report)).toBe("");
  });

  it("skips principal issues when the live check was not run", () => {
    const report = diagnose(
      leakRiskInput({
        authPrincipal: null,
        principalChecked: false,
      }),
    );
    expect(report.issues.map((i) => i.code)).toEqual(["token-missing"]);
    expect(report.push.outlook).toBe("blocked");
    expect(report.gh.outlook).toBe("risk");
  });
});
