import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AcctConfig } from "../types.js";
import { loadConfig, hooksDir, acctConfigDir } from "../config/store.js";
import { globalGitconfigPath } from "../identity/includeIf.js";
import { resolveFromCwd } from "../resolution/fromCwd.js";
import { secretsFilePath } from "../secrets/store.js";

export interface DoctorFinding {
  severity: "error" | "warn" | "ok";
  code: string;
  message: string;
  fix?: string;
}

export function runDoctor(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
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
  findings.push(...checkStaleGhToken(cwd, env, config));
  findings.push(...checkSshKeys(config, env));
  findings.push(...checkBindings(config));
  findings.push(...checkSecretBackend(env));
  findings.push(...checkGlobalHooksPath(env));

  if (findings.every((f) => f.severity === "ok") || findings.length === 0) {
    findings.push({
      severity: "ok",
      code: "healthy",
      message: "No issues detected",
    });
  }

  return findings;
}

function checkCredentialHelpers(env: NodeJS.ProcessEnv): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  try {
    const out = execFileSync("git", ["config", "--global", "--get-all", "credential.helper"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const helpers = out.split(/\r?\n/).filter(Boolean);
    if (helpers.some((h) => /\bgh\b/.test(h))) {
      findings.push({
        severity: "warn",
        code: "gh-credential-helper",
        message:
          "Global git credential.helper includes gh — active account can leak across directories",
        fix: "Prefer acct-managed helpers via includeIf; avoid gh auth setup-git for multi-account",
      });
    }
    if (helpers.length > 1) {
      findings.push({
        severity: "warn",
        code: "multiple-helpers",
        message: `Multiple global credential helpers: ${helpers.join(", ")}`,
        fix: "acct install rewrites helpers inside bound profiles; review global helpers",
      });
    }
  } catch {
    findings.push({
      severity: "ok",
      code: "no-global-helper",
      message: "No global credential.helper set",
    });
  }
  return findings;
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
        message: "acct includeIf block not present in global gitconfig",
        fix: "acct install",
      },
    ];
  }
  return [
    {
      severity: "ok",
      code: "installed",
      message: "acct managed includeIf block present",
    },
  ];
}

function checkStaleGhToken(
  cwd: string,
  env: NodeJS.ProcessEnv,
  _config: AcctConfig,
): DoctorFinding[] {
  const resolved = resolveFromCwd(cwd, env);
  if (!resolved.profile) return [];
  if (env.GH_TOKEN || env.GITHUB_TOKEN) {
    return [
      {
        severity: "warn",
        code: "env-token-present",
        message:
          "GH_TOKEN/GITHUB_TOKEN is set in the environment — ensure shell hook refreshed it for this profile",
        fix: "eval \"$(acct hook zsh)\" or use: acct exec -- <cmd>",
      },
    ];
  }
  return [];
}

function checkSshKeys(
  config: AcctConfig,
  env: NodeJS.ProcessEnv,
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const acctSshDir = path.join(acctConfigDir(env), "ssh");
  for (const p of config.profiles) {
    if (p.protocol !== "ssh") continue;
    if (!p.sshKeyPath) {
      findings.push({
        severity: "error",
        code: "ssh-missing-key",
        message: `Profile ${p.id} is ssh but has no sshKeyPath`,
        fix: `acct profile ssh-key ${p.id} --generate`,
      });
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
