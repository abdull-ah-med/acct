import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AcctConfig } from "../types.js";
import { loadConfig, hooksDir, acctConfigDir, gitIncDir } from "../config/store.js";
import { globalGitconfigPath } from "../identity/includeIf.js";
import { resolveFromCwd } from "../resolution/fromCwd.js";
import { secretsFilePath } from "../secrets/store.js";
import { ghApiLogin } from "../gh/env.js";
import { listProfileIdCaseCollisions } from "../util/profile-id.js";
import { resolveAcctCliPaths } from "../enforce/hooks.js";

export interface DoctorFinding {
  severity: "error" | "warn" | "ok";
  code: string;
  message: string;
  fix?: string;
}

export interface DoctorOptions {
  /** When true, allow network (gh api user) for principal checks. Default: false. */
  online?: boolean;
}

export function runDoctor(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  opts: DoctorOptions = {},
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const config = loadConfig(env);

  if (config.profiles.length === 0) {
    findings.push({
      severity: "warn",
      code: "no-profiles",
      message: "No profiles configured",
      fix: "acct profile add <id> --user <github> --email <email> --name <name>",
    });
  }

  findings.push(...checkCredentialHelpers(env));
  findings.push(...checkManagedBlock(env));
  findings.push(...checkProfileIdCaseCollisions(config));
  findings.push(...checkStaleGhToken(cwd, env, config, opts));
  findings.push(...checkEnforceFallthrough(cwd, env, config));
  findings.push(...checkAmbientProfile(cwd, env));
  findings.push(...checkHooksAbsolute(env));
  findings.push(...checkHooksBypassable());
  findings.push(...checkSshKeys(config, env));
  findings.push(...checkBindings(config));
  findings.push(...checkSecretBackend(env));
  findings.push(...checkGlobalHooksPath(env));
  findings.push(...checkConfigDirPerms(env));
  findings.push(...checkOrphanIncFiles(config, env));
  findings.push(...checkPrePushHook(env));
  findings.push(...checkCredentialShim(env));
  findings.push(...checkStaleHookNodePath(env));

  if (findings.every((f) => f.severity === "ok") || findings.length === 0) {
    findings.push({
      severity: "ok",
      code: "healthy",
      message: "No issues detected",
    });
  }

  return findings;
}

/**
 * Simulate git's credential.helper list after empty-string resets.
 * Cite: https://git-scm.com/docs/gitcredentials ; git.git 24321375
 */
export function effectiveCredentialHelpers(helpers: string[]): string[] {
  let result: string[] = [];
  for (const h of helpers) {
    if (h === "") result = [];
    else result.push(h);
  }
  return result;
}

const COMPETING_HELPER_RE =
  /\b(osxkeychain|wincred|libsecret|manager-core|manager|store|cache|gh)\b/i;

function isAcctHelper(helper: string): boolean {
  return /git-credential-acct|credential-acct|\bacct\b/i.test(helper);
}

function checkCredentialHelpers(env: NodeJS.ProcessEnv): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  let helpers: string[] = [];
  try {
    // Prefer --show-origin so includeIf / system / global chain is visible.
    // Cite: https://git-scm.com/docs/git-config#Documentation/git-config.txt---show-origin
    let out = "";
    try {
      out = execFileSync(
        "git",
        ["config", "--show-origin", "--get-all", "credential.helper"],
        {
          encoding: "utf8",
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trim();
    } catch {
      out = execFileSync(
        "git",
        ["config", "--global", "--get-all", "credential.helper"],
        {
          encoding: "utf8",
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      ).trim();
    }
    // --show-origin lines look like: file:/path/to/.gitconfig\thelpervalue
    helpers = out
      .replace(/\r/g, "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t");
        return tab >= 0 ? line.slice(tab + 1) : line;
      });
  } catch {
    findings.push({
      severity: "ok",
      code: "no-global-helper",
      message: "No credential.helper set",
    });
    return findings;
  }

  const effective = effectiveCredentialHelpers(helpers);
  const competing = effective.filter(
    (h) => COMPETING_HELPER_RE.test(h) && !isAcctHelper(h),
  );
  const hasAcct = effective.some(isAcctHelper);

  if (competing.some((h) => /\bgh\b/i.test(h))) {
    findings.push({
      severity: "warn",
      code: "gh-credential-helper",
      message:
        "Effective git credential.helper includes gh — active gh account can leak across directories",
      fix: "Prefer acct-managed helpers via includeIf; avoid gh auth setup-git for multi-account",
    });
  }

  if (competing.some((h) => /osxkeychain|wincred|libsecret|manager/i.test(h))) {
    findings.push({
      severity: "warn",
      code: "competing-os-helper",
      message: `Effective credential helpers still include OS/store helpers: ${competing.join(", ")} — wrong-account HTTPS auth is possible outside acct fail-closed paths`,
      fix: "Run acct install (writes helper=\"\" then acct). Outside bound trees with enforce=off, competing helpers may answer.",
    });
  }

  if (!hasAcct && competing.length > 0) {
    findings.push({
      severity: "warn",
      code: "acct-helper-missing",
      message:
        "acct credential helper is not in the effective helper chain — machine keychain entries (any account) can answer HTTPS for github.com after uninstall or before install",
      fix: "acct install  # restores helper=\"\" then acct. To erase a cached github.com cred: printf 'protocol=https\\nhost=github.com\\n\\n' | git credential reject  (https://git-scm.com/docs/gitcredentials)",
    });
  }

  if (effective.length > 1) {
    findings.push({
      severity: "warn",
      code: "multiple-helpers",
      message: `Multiple effective credential helpers: ${effective.join(", ")}`,
      fix: "acct install rewrites helpers; review git config --get-all credential.helper",
    });
  } else if (hasAcct && competing.length === 0) {
    findings.push({
      severity: "ok",
      code: "helper-acct-only",
      message: "Effective credential helper chain is acct-only (after resets)",
    });
  }

  return findings;
}

function checkHooksBypassable(): DoctorFinding[] {
  return [
    {
      severity: "warn",
      code: "hooks-client-side-bypassable",
      message:
        "pre-commit/pre-push are client-side only — git commit/push --no-verify and -c core.hooksPath=… bypass them",
      fix: "Use organization/server branch protection and required status checks for non-bypassable policy (https://git-scm.com/docs/githooks)",
    },
  ];
}

function checkManagedBlock(env: NodeJS.ProcessEnv): DoctorFinding[] {
  const gitconfig = globalGitconfigPath(env);
  if (!fs.existsSync(gitconfig)) {
    return [
      {
        severity: "warn",
        code: "no-gitconfig",
        message: "No global gitconfig found",
        fix: "acct install",
      },
    ];
  }
  const text = fs.readFileSync(gitconfig, "utf8");
  if (!text.includes("# >>> acct managed begin >>>")) {
    return [
      {
        severity: "warn",
        code: "not-installed",
        message:
          "acct includeIf block not present in global gitconfig — OS credential helpers may answer for github.com with any cached account (post-uninstall residual)",
        fix: "acct install  # or clear cached creds: printf 'protocol=https\\nhost=github.com\\n\\n' | git credential reject",
      },
    ];
  }
  const findings: DoctorFinding[] = [
    {
      severity: "ok",
      code: "installed",
      message: "acct managed includeIf block present",
    },
  ];
  // Managed block must reset helpers then install acct (I8)
  const begin = text.indexOf("# >>> acct managed begin >>>");
  const end = text.indexOf("# <<< acct managed end <<<", begin);
  const managed = begin >= 0 && end > begin ? text.slice(begin, end) : "";
  if (!managed.includes('helper = ""') || !/helper = /.test(managed)) {
    findings.push({
      severity: "error",
      code: "managed-helper-reset-missing",
      message: "Managed gitconfig block lacks credential.helper reset + acct shim",
      fix: "acct install",
    });
  }
  return findings;
}

/**
 * Case-fold duplicate profile ids overwrite the same `git/<id>.inc` on
 * case-insensitive filesystems (APFS/NTFS).
 * Cite: https://git-scm.com/docs/git-config (gitdir/i, core.ignoreCase)
 * Cite: docs/research/i18-profile-case-round3-cites-2026-08-08.md
 */
function checkProfileIdCaseCollisions(config: AcctConfig): DoctorFinding[] {
  const pairs = listProfileIdCaseCollisions(config.profiles);
  if (!pairs.length) {
    return [
      {
        severity: "ok",
        code: "profile-id-case",
        message: "Profile ids are unique under case-folding",
      },
    ];
  }
  return pairs.map(([a, b]) => ({
    severity: "error" as const,
    code: "profile-id-case-collision",
    message: `Profile ids ${JSON.stringify(a)} and ${JSON.stringify(b)} collide under case-insensitive filesystems — include files overwrite each other`,
    fix: `acct profile remove ${b}   # keep one spelling; then acct install`,
  }));
}

function checkAmbientProfile(
  cwd: string,
  env: NodeJS.ProcessEnv,
): DoctorFinding[] {
  const ambient = env.ACCT_PROFILE?.trim();
  if (!ambient) return [];
  const resolved = resolveFromCwd(cwd, env, { allowEnvProfile: false });
  if (resolved.profile && resolved.profile.id !== ambient) {
    return [
      {
        severity: "warn",
        code: "ambient-acct-profile-ignored",
        message: `Ambient ACCT_PROFILE=${ambient} differs from cwd profile ${resolved.profile.id} — git auth follows cwd (I4)`,
        fix: "Unset ACCT_PROFILE, or cd / use .acct / acct exec --profile for gh only",
      },
    ];
  }
  return [
    {
      severity: "ok",
      code: "ambient-acct-profile",
      message: "Ambient ACCT_PROFILE matches cwd resolution (still ignored by helper)",
    },
  ];
}

function checkHooksAbsolute(env: NodeJS.ProcessEnv): DoctorFinding[] {
  const preCommit = path.join(hooksDir(env), "pre-commit");
  if (!fs.existsSync(preCommit)) return [];
  const body = fs.readFileSync(preCommit, "utf8");
  if (/^acct /m.test(body) || /\nacct /m.test(body)) {
    return [
      {
        severity: "error",
        code: "hooks-bare-acct",
        message: "Hooks call bare `acct` (PATH-dependent)",
        fix: "acct install  # rewrites absolute node + acct.js paths (I11b)",
      },
    ];
  }
  if (!body.includes("hook-run")) {
    return [
      {
        severity: "warn",
        code: "hooks-unexpected",
        message: "pre-commit hook does not look like acct-managed content",
        fix: "acct install",
      },
    ];
  }
  return [
    {
      severity: "ok",
      code: "hooks-absolute",
      message: "Enforce hooks use absolute acct invocation",
    },
  ];
}

function checkStaleGhToken(
  cwd: string,
  env: NodeJS.ProcessEnv,
  _config: AcctConfig,
  opts: DoctorOptions = {},
): DoctorFinding[] {
  const resolved = resolveFromCwd(cwd, env, { allowEnvProfile: false });
  const hasToken = !!(env.GH_TOKEN || env.GITHUB_TOKEN);

  // T5: unbound must not keep acct-injected tokens lingering in the shell
  if (!resolved.profile) {
    if (hasToken) {
      return [
        {
          severity: "warn",
          code: "env-token-unbound",
          message:
            "GH_TOKEN/GITHUB_TOKEN is set but cwd is unbound — raw gh may use a sticky token from a previous tree (T5)",
          fix: 'eval "$(acct hook zsh)"  # or: unset GH_TOKEN GITHUB_TOKEN',
        },
      ];
    }
    return [];
  }

  if (!hasToken) return [];

  // Network principal check is opt-in (--online) to avoid captive-portal hangs.
  if (!opts.online) {
    return [
      {
        severity: "ok",
        code: "env-token-present",
        message:
          "Ambient GH_TOKEN set for cwd profile (skipped live principal check; pass --online to verify)",
      },
    ];
  }

  // Compare ambient token principal to cwd profile (gh environment: GH_TOKEN wins).
  // Cite: https://cli.github.com/manual/gh_help_environment
  const login = ghApiLogin(env, { timeoutMs: 3000 });
  if (login && login !== resolved.profile.githubUser) {
    return [
      {
        severity: "warn",
        code: "env-token-principal-mismatch",
        message: `Ambient GH_TOKEN authenticates as ${login} but cwd profile expects ${resolved.profile.githubUser} — raw gh uses the sticky token; acct exec/helper/hooks follow cwd (T5/I4)`,
        fix: 'eval "$(acct hook zsh)"  # rebind on cd; or: unset GH_TOKEN; acct exec -- <cmd>',
      },
    ];
  }

  // Matching (or unverifiable offline) token is expected when the shell hook ran.
  return [];
}

/**
 * I6: unbound + enforce off returns empty without quit — later helpers
 * (osxkeychain, etc.) may answer with any cached github.com account.
 * Cite: https://git-scm.com/docs/gitcredentials (helper chain; quit=true)
 */
function checkEnforceFallthrough(
  cwd: string,
  env: NodeJS.ProcessEnv,
  config: AcctConfig,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  if (config.defaultEnforce === "off") {
    findings.push({
      severity: "warn",
      code: "default-enforce-off",
      message:
        "defaultEnforce=off — unbound directories do not quit the credential helper chain; OS helpers (osxkeychain/wincred/…) may return a cached github.com account (I6/T1)",
      fix: "acct enforce strict   # restore fail-closed unbound behavior",
    });
  }
  const resolved = resolveFromCwd(cwd, env, { allowEnvProfile: false });
  if (!resolved.profile && resolved.enforce === "off") {
    findings.push({
      severity: "warn",
      code: "unbound-enforce-off",
      message:
        "cwd is unbound with enforce=off — HTTPS get returns no password and does not quit; git may fall through to osxkeychain/other helpers (cross-account residual)",
      fix: "acct enforce strict  # or bind this directory; clear cache: printf 'protocol=https\\nhost=github.com\\n\\n' | git credential reject",
    });
  }
  return findings;
}

function checkSshKeys(
  config: AcctConfig,
  env: NodeJS.ProcessEnv,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const acctSshDir = path.join(acctConfigDir(env), "ssh");
  for (const p of config.profiles) {
    if (!p.sshKeyPath) {
      if (p.protocol === "ssh") {
        findings.push({
          severity: "error",
          code: "ssh-missing-key",
          message: `Profile ${p.id} is ssh but has no sshKeyPath`,
          fix: `acct profile ssh-key ${p.id} --generate`,
        });
      }
      continue;
    }
    if (!fs.existsSync(p.sshKeyPath)) {
      findings.push({
        severity: "error",
        code: "ssh-key-missing-file",
        message: `Profile ${p.id} ssh key not found: ${p.sshKeyPath}`,
      });
    } else {
      findings.push({
        severity: "ok",
        code: "ssh-key-ok",
        message: `Profile ${p.id} SSH key present`,
      });
      const keyResolved = path.resolve(p.sshKeyPath);
      if (keyResolved.startsWith(path.resolve(acctSshDir) + path.sep)) {
        findings.push({
          severity: "warn",
          code: "ssh-empty-passphrase",
          message: `Profile ${p.id} SSH key under acct config was generated with an empty passphrase`,
          fix: "Protect with: ssh-keygen -p -f <key>   or attach a passphrase-protected key via --path",
        });
      }
    }
  }
  return findings;
}

function checkBindings(config: AcctConfig): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const b of config.bindings) {
    if (!config.profiles.some((p) => p.id === b.profileId)) {
      findings.push({
        severity: "error",
        code: "orphan-binding",
        message: `Binding ${b.path} points to missing profile ${b.profileId}`,
        fix: "acct unbind <path> or recreate profile",
      });
    }
  }
  return findings;
}

function checkSecretBackend(env: NodeJS.ProcessEnv): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const backend = (env.ACCT_SECRET_BACKEND || "auto").toLowerCase();
  const secretsPath = secretsFilePath(env);
  if (backend === "file") {
    findings.push({
      severity: "warn",
      code: "secret-backend-file",
      message:
        "ACCT_SECRET_BACKEND=file stores tokens in plaintext secrets.json under the acct config dir",
      fix: "Prefer OS keychain (unset ACCT_SECRET_BACKEND) on machines with a keyring",
    });
  }
  if (fs.existsSync(secretsPath)) {
    findings.push({
      severity: "warn",
      code: "secrets-json-present",
      message: `Plaintext token file present: ${secretsPath}`,
      fix: "After keyring works, delete secrets.json and re-import tokens with acct profile token",
    });
  }
  return findings;
}

function checkGlobalHooksPath(env: NodeJS.ProcessEnv): DoctorFinding[] {
  try {
    const value = execFileSync(
      "git",
      ["config", "--global", "--get", "core.hooksPath"],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    if (!value) return [];
    const acctHooks = path.resolve(hooksDir(env));
    const normalized = path.resolve(value);
    if (normalized === acctHooks) {
      return [
        {
          severity: "warn",
          code: "global-hooks-path",
          message: `Global core.hooksPath=${value} — replaces hooks in every repository`,
          fix: "Prefer per-repo: unset global hooksPath, then run `acct install` inside each repo",
        },
      ];
    }
    return [
      {
        severity: "warn",
        code: "global-hooks-path-other",
        message: `Global core.hooksPath=${value} is set (may conflict with acct enforce hooks)`,
        fix: "Review whether acct pre-commit/pre-push are reachable",
      },
    ];
  } catch {
    return [];
  }
}

function checkConfigDirPerms(env: NodeJS.ProcessEnv): DoctorFinding[] {
  if (process.platform === "win32") return [];
  const dir = acctConfigDir(env);
  if (!fs.existsSync(dir)) return [];
  const mode = fs.statSync(dir).mode & 0o777;
  if (mode !== 0o700) {
    return [
      {
        severity: "warn",
        code: "config-dir-perms",
        message: `Config dir ${dir} mode is ${mode.toString(8)} (expected 700)`,
        fix: `chmod 700 ${dir}`,
      },
    ];
  }
  return [
    {
      severity: "ok",
      code: "config-dir-perms",
      message: "Config directory mode is 0700",
    },
  ];
}

function checkOrphanIncFiles(
  config: AcctConfig,
  env: NodeJS.ProcessEnv,
): DoctorFinding[] {
  const gdir = gitIncDir(env);
  if (!fs.existsSync(gdir)) return [];
  const known = new Set(config.profiles.map((p) => `${p.id}.inc`));
  const orphans: string[] = [];
  for (const name of fs.readdirSync(gdir)) {
    if (name.endsWith(".inc") && !known.has(name)) orphans.push(name);
  }
  if (!orphans.length) return [];
  return [
    {
      severity: "warn",
      code: "orphan-inc",
      message: `Orphan profile include files: ${orphans.join(", ")}`,
      fix: "Remove stale files under the acct git/ directory or re-run acct install after profile remove",
    },
  ];
}

function checkPrePushHook(env: NodeJS.ProcessEnv): DoctorFinding[] {
  const prePush = path.join(hooksDir(env), "pre-push");
  const preCommit = path.join(hooksDir(env), "pre-commit");
  if (!fs.existsSync(preCommit)) return [];
  if (!fs.existsSync(prePush)) {
    return [
      {
        severity: "warn",
        code: "hooks-pre-push-missing",
        message: "pre-commit present but pre-push hook missing",
        fix: "acct install",
      },
    ];
  }
  return [
    {
      severity: "ok",
      code: "hooks-pre-push",
      message: "pre-push hook present",
    },
  ];
}

function checkCredentialShim(env: NodeJS.ProcessEnv): DoctorFinding[] {
  const dir = path.join(acctConfigDir(env), "bin");
  const shim =
    process.platform === "win32"
      ? path.join(dir, "git-credential-acct.cmd")
      : path.join(dir, "git-credential-acct");
  if (!fs.existsSync(shim)) return [];
  try {
    const st = fs.lstatSync(shim);
    if (st.isSymbolicLink()) {
      return [
        {
          severity: "warn",
          code: "credential-shim-symlink",
          message: `Credential shim is a symlink: ${shim}`,
          fix: "acct install  # rewrite shim as a regular script",
        },
      ];
    }
    if (process.platform !== "win32") {
      const mode = st.mode & 0o777;
      if ((mode & 0o111) === 0) {
        return [
          {
            severity: "error",
            code: "credential-shim-perms",
            message: `Credential shim is not executable: ${shim}`,
            fix: `chmod 755 ${shim}`,
          },
        ];
      }
    }
  } catch {
    return [];
  }
  return [
    {
      severity: "ok",
      code: "credential-shim",
      message: "Credential shim is a regular executable (not a symlink)",
    },
  ];
}

function checkStaleHookNodePath(env: NodeJS.ProcessEnv): DoctorFinding[] {
  const preCommit = path.join(hooksDir(env), "pre-commit");
  if (!fs.existsSync(preCommit)) return [];
  const body = fs.readFileSync(preCommit, "utf8");
  const { node } = resolveAcctCliPaths(env);
  if (!body.includes(node)) {
    return [
      {
        severity: "warn",
        code: "hooks-stale-node",
        message: `Hooks bake a different node path than current process.execPath (${node})`,
        fix: "acct install  # rewrite hooks with current node",
      },
    ];
  }
  return [
    {
      severity: "ok",
      code: "hooks-node-path",
      message: "Hook node path matches current process.execPath",
    },
  ];
}
