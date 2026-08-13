import type { EnforceMode, Protocol } from "../types.js";

export type IssueSeverity = "error" | "warn";
export type Outlook = "allowed" | "blocked" | "risk" | "leak";

export type DiagnoseIssueCode =
  | "token-missing"
  | "principal-mismatch"
  | "principal-unknown"
  | "commit-identity-mismatch";

export interface DiagnoseInput {
  profileId: string;
  githubUser: string;
  host: string;
  name: string;
  email: string;
  protocol: Protocol;
  enforce: EnforceMode;
  hasToken: boolean;
  /** Live `gh api user` login under profile env, or null if not queried / failed. */
  authPrincipal: string | null;
  /** False when the caller skipped the network principal check (doctor without --online). */
  principalChecked: boolean;
  commitName: string;
  commitEmail: string;
}

export interface DiagnoseIssue {
  code: DiagnoseIssueCode;
  severity: IssueSeverity;
  summary: string;
  detail?: string;
}

export interface PlaneOutlook {
  outlook: Outlook;
  explanation: string;
}

export interface DiagnoseReport {
  ok: boolean;
  issues: DiagnoseIssue[];
  fixes: string[];
  commit: PlaneOutlook;
  push: PlaneOutlook;
  gh: PlaneOutlook;
}

function identityMatches(input: DiagnoseInput): boolean {
  return input.commitEmail === input.email && input.commitName === input.name;
}

function principalMatches(input: DiagnoseInput): boolean {
  return !!input.authPrincipal && input.authPrincipal === input.githubUser;
}

/**
 * Explain cwd profile problems: what's wrong, commands to fix, and whether
 * commit / push / raw gh will proceed (and as whom).
 */
export function diagnose(input: DiagnoseInput): DiagnoseReport {
  const issues: DiagnoseIssue[] = [];

  if (!input.hasToken) {
    issues.push({
      code: "token-missing",
      severity: "error",
      summary: `profile "${input.profileId}" has no token in the OS keychain`,
      detail:
        "HTTPS git and `acct exec` cannot inject this profile's credentials until you store a PAT.",
    });
  }

  if (input.principalChecked && input.authPrincipal && input.authPrincipal !== input.githubUser) {
    issues.push({
      code: "principal-mismatch",
      severity: "error",
      summary: `gh is authenticated as ${input.authPrincipal}, but this folder expects ${input.githubUser}`,
      detail: input.hasToken
        ? `The stored PAT for profile "${input.profileId}" belongs to ${input.authPrincipal}, not ${input.githubUser}.`
        : `No profile token is stored, so gh falls through to your default GitHub login (${input.authPrincipal}).`,
    });
  } else if (input.principalChecked && input.hasToken && !input.authPrincipal) {
    issues.push({
      code: "principal-unknown",
      severity: "warn",
      summary: `could not verify GitHub auth for profile "${input.profileId}"`,
      detail:
        "gh api user failed (offline, timeout, or gh not logged in). Token is present in the keychain but the live principal was not checked.",
    });
  }

  if (!identityMatches(input)) {
    const seen = `${input.commitName || "(unset)"} <${input.commitEmail || "(unset)"}>`;
    const want = `${input.name} <${input.email}>`;
    issues.push({
      code: "commit-identity-mismatch",
      severity: input.enforce === "off" ? "warn" : "error",
      summary: `git identity is ${seen}, but profile "${input.profileId}" requires ${want}`,
      detail: "includeIf is missing, stale, or this repo overrides user.name / user.email.",
    });
  }

  const fixes = buildFixes(input, issues);
  const commit = commitOutlook(input);
  const push = pushOutlook(input);
  const gh = ghOutlook(input);
  const ok = issues.every((i) => i.severity !== "error");

  return { ok, issues, fixes, commit, push, gh };
}

function buildFixes(input: DiagnoseInput, issues: DiagnoseIssue[]): string[] {
  const codes = new Set(issues.map((i) => i.code));
  const fixes: string[] = [];

  if (codes.has("commit-identity-mismatch")) {
    fixes.push("acct install");
  }

  if (codes.has("token-missing") || codes.has("principal-mismatch")) {
    fixes.push(
      `gh auth login --hostname ${input.host} --user ${input.githubUser}`,
    );
    fixes.push(`acct profile token ${input.profileId} --import-gh`);
    fixes.push(
      `# or paste a PAT: acct profile token ${input.profileId} --stdin`,
    );
  }

  if (codes.has("principal-unknown")) {
    fixes.push(`acct doctor --online`);
  }

  if (fixes.length > 0) {
    fixes.push("acct status");
  }

  return fixes;
}

function commitOutlook(input: DiagnoseInput): PlaneOutlook {
  if (identityMatches(input)) {
    return {
      outlook: "allowed",
      explanation:
        `will go through as ${input.name} <${input.email}> ` +
        `(git author/committer from includeIf). Git commit does not use GitHub auth` +
        (input.authPrincipal && input.authPrincipal !== input.githubUser
          ? ` — it will not use ${input.authPrincipal}.`
          : "."),
    };
  }
  if (input.enforce === "strict") {
    return {
      outlook: "blocked",
      explanation:
        `pre-commit will refuse (I11). Author would have been ` +
        `${input.commitName || "(unset)"} <${input.commitEmail || "(unset)"}> ` +
        `instead of ${input.name} <${input.email}>.`,
    };
  }
  return {
    outlook: "risk",
    explanation:
      `enforce=${input.enforce}: hooks will not block. A commit would be recorded as ` +
      `${input.commitName || "(unset)"} <${input.commitEmail || "(unset)"}> ` +
      `— the wrong identity for profile "${input.profileId}".`,
  };
}

function pushOutlook(input: DiagnoseInput): PlaneOutlook {
  const wrongPrincipal =
    input.principalChecked &&
    input.authPrincipal &&
    input.authPrincipal !== input.githubUser
      ? input.authPrincipal
      : null;
  const unverified =
    input.principalChecked && input.hasToken && !input.authPrincipal;
  const authBroken = !input.hasToken || !!wrongPrincipal || unverified;
  const identityBroken = !identityMatches(input);

  if (input.enforce === "strict" && (authBroken || identityBroken)) {
    const parts: string[] = ["pre-push will refuse."];
    if (wrongPrincipal) {
      parts.push(
        `You will not push as ${wrongPrincipal} through acct-managed git.`,
      );
    } else if (!input.hasToken) {
      parts.push(
        `No profile token — GitHub auth for ${input.githubUser} cannot be proven.`,
      );
    }
    if (identityBroken) {
      parts.push("Commit identity also does not match this profile (I11).");
    }
    if (input.protocol === "https" && !input.hasToken) {
      parts.push(
        "HTTPS helper has no token and quits (I6) — even `git push --no-verify` will not send another account's credentials.",
      );
    } else if (input.protocol === "https" && wrongPrincipal && input.hasToken) {
      parts.push(
        `Warning: the stored PAT is ${wrongPrincipal}'s — \`git push --no-verify\` would bypass the hook and push as ${wrongPrincipal} (I15).`,
      );
    }
    return { outlook: "blocked", explanation: parts.join(" ") };
  }

  if (authBroken || identityBroken) {
    if (input.protocol === "https" && !input.hasToken) {
      return {
        outlook: "risk",
        explanation:
          `enforce=${input.enforce}: hooks will not block. HTTPS helper will not quit, so osxkeychain/gh/wincred may push as a cached github.com account` +
          (wrongPrincipal ? ` (likely ${wrongPrincipal})` : "") +
          ".",
      };
    }
    if (input.protocol === "https" && wrongPrincipal && input.hasToken) {
      return {
        outlook: "risk",
        explanation:
          `enforce=${input.enforce}: hooks will not block. The stored PAT authenticates as ${wrongPrincipal}, so HTTPS push would go through as ${wrongPrincipal}, not ${input.githubUser}.`,
      };
    }
    return {
      outlook: "risk",
      explanation:
        `enforce=${input.enforce}: hooks will not block. Auth/identity does not match profile "${input.profileId}"` +
        (input.protocol === "ssh"
          ? " — SSH may use a default agent key instead of this profile."
          : ".") +
        (wrongPrincipal ? ` Live principal is ${wrongPrincipal}.` : ""),
    };
  }

  return {
    outlook: "allowed",
    explanation: `will go through as ${input.githubUser} (profile token + hooks agree).`,
  };
}

function ghOutlook(input: DiagnoseInput): PlaneOutlook {
  if (!input.principalChecked) {
    return {
      outlook: input.hasToken ? "allowed" : "risk",
      explanation: input.hasToken
        ? "live principal not checked (pass --online). acct exec still injects the profile token."
        : "no profile token — raw gh uses your default gh login. Pass --online to see which user.",
    };
  }
  if (principalMatches(input) && input.hasToken) {
    return {
      outlook: "allowed",
      explanation: `acct exec / the shell hook injects ${input.githubUser}'s token. Raw gh without the hook still follows whatever GH_TOKEN / gh auth is in the shell.`,
    };
  }
  if (input.authPrincipal && input.authPrincipal !== input.githubUser) {
    return {
      outlook: "leak",
      explanation:
        `raw \`gh\` (not via \`acct exec\`) runs as ${input.authPrincipal}. ` +
        `Use: acct exec -- gh …`,
    };
  }
  if (!input.hasToken) {
    return {
      outlook: "risk",
      explanation:
        "no profile token, so raw gh uses your default gh login — not this profile. Use: acct exec -- gh … after importing a token.",
    };
  }
  return {
    outlook: "risk",
    explanation:
      "could not verify the live principal. Use `acct exec -- gh …` in this folder.",
  };
}

function outlookLabel(outlook: Outlook): string {
  switch (outlook) {
    case "allowed":
      return "allowed";
    case "blocked":
      return "blocked";
    case "risk":
      return "risk   ";
    case "leak":
      return "leak   ";
  }
}

/** Terminal block: what's wrong, fix commands, commit/push/gh impact. */
export function formatDiagnoseReport(report: DiagnoseReport): string {
  if (report.issues.length === 0) return "";

  const lines: string[] = ["what's wrong"];
  for (const issue of report.issues) {
    lines.push(`  ${issue.summary}`);
    if (issue.detail) lines.push(`    ${issue.detail}`);
  }

  if (report.fixes.length > 0) {
    lines.push("");
    lines.push("fix");
    for (const cmd of report.fixes) {
      lines.push(`  ${cmd}`);
    }
  }

  lines.push("");
  lines.push("commit / push in this state");
  lines.push(`  commit  ${outlookLabel(report.commit.outlook)}`);
  lines.push(`          ${report.commit.explanation}`);
  lines.push(`  push    ${outlookLabel(report.push.outlook)}`);
  lines.push(`          ${report.push.explanation}`);
  lines.push(`  gh      ${outlookLabel(report.gh.outlook)}`);
  lines.push(`          ${report.gh.explanation}`);
  return lines.join("\n");
}

export function diagnoseHasErrors(report: DiagnoseReport): boolean {
  return report.issues.some((i) => i.severity === "error");
}
