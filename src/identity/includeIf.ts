import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AcctConfig, Profile } from "../types.js";
import { gitIncDir, backupDir, acctConfigDir } from "../config/store.js";
import { assertSafeSshHost } from "../ssh/keys.js";
import { homeDir, normalizePath } from "../util/paths.js";

const BEGIN = "# >>> acct managed begin >>>";
const END = "# <<< acct managed end <<<";

export function profileIncPath(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(gitIncDir(env), `${profile.id}.inc`);
}

export function renderProfileInclude(
  profile: Profile,
  helperCommand: string,
): string {
  const helperValue = quoteHelper(helperCommand);
  const lines: string[] = [
    `# acct profile ${profile.id} — do not edit by hand`,
    "[user]",
    `\tname = ${profile.name}`,
    `\temail = ${profile.email}`,
  ];

  if (profile.protocol === "https") {
    lines.push(
      "[credential]",
      '\thelper = ""',
      `\thelper = ${helperValue}`,
      "[credential \"https://" + profile.host + "\"]",
      "\tuseHttpPath = false",
      `\tusername = ${profile.githubUser}`,
    );
  }

  if (profile.protocol === "ssh" && profile.sshKeyPath) {
    const key = profile.sshKeyPath.replace(/\\/g, "/");
    const host = assertSafeSshHost(profile.host);
    // IdentitiesOnly=yes — https://man.openbsd.org/ssh_config.5
    lines.push(
      "[core]",
      `\tsshCommand = ssh -i ${shellQuote(key)} -o IdentitiesOnly=yes -o HostName=${host}`,
    );
  }

  return lines.join("\n") + "\n";
}

/** Git runs helpers via the shell; paths with spaces need !'…' form. */
function quoteHelper(cmd: string): string {
  // Verified: helper = !'/path with spaces/x' works; bare absolute paths do not.
  // https://git-scm.com/docs/gitcredentials
  if (cmd.startsWith("!")) return cmd;
  const escaped = cmd.replace(/'/g, `'\"'\"'`);
  return `!'${escaped}'`;
}

function shellQuote(s: string): string {
  if (/[\s"'$`\\]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

export function writeProfileInclude(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir = gitIncDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const helperCmd = resolveHelperConfigValue(env);
  const content = renderProfileInclude(profile, helperCmd);
  const file = profileIncPath(profile, env);
  fs.writeFileSync(file, content, "utf8");
  return file;
}

function resolveHelperConfigValue(env: NodeJS.ProcessEnv): string {
  // Always install a shim under ACCT_CONFIG_DIR/bin (paths without spaces are
  // reliable). Git appends the operation and runs via the shell; spaces in the
  // project path ("untitled folder 3") break unquoted absolute helpers.
  // Spec: https://git-scm.com/docs/gitcredentials
  return ensureCredentialShim(env);
}

/**
 * Write ~/.config/acct/bin/git-credential-acct → exec's the real package bin.
 */
export function ensureCredentialShim(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir = path.join(acctConfigDir(env), "bin");
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(dir, "git-credential-acct");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const realJs = path.resolve(here, "..", "..", "bin", "git-credential-acct.js");
  const target = fs.existsSync(realJs)
    ? realJs
    : (() => {
        try {
          const cmd = process.platform === "win32" ? "where" : "which";
          return execFileSync(cmd, ["git-credential-acct"], {
            encoding: "utf8",
            env,
          })
            .trim()
            .split(/\r?\n/)[0]!;
        } catch {
          return realJs;
        }
      })();

  if (process.platform === "win32") {
    const cmdPath = shim + ".cmd";
    fs.writeFileSync(
      cmdPath,
      `@echo off\r\nnode "${target.replace(/"/g, "")}" %*\r\n`,
    );
    return cmdPath.replace(/\\/g, "/");
  }

  const script = `#!/bin/sh
exec node ${shellQuote(target)} "$@"
`;
  fs.writeFileSync(shim, script, { mode: 0o755 });
  return shim.replace(/\\/g, "/");
}

export function buildIncludeIfBlock(
  config: AcctConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const useInsensitive =
    process.platform === "win32" || process.platform === "darwin";
  const keyword = useInsensitive ? "gitdir/i" : "gitdir";
  const lines: string[] = [BEGIN, "# Managed by acct — do not edit", ""];

  for (const binding of config.bindings) {
    const profile = config.profiles.find((p) => p.id === binding.profileId);
    if (!profile) continue;
    const inc = profileIncPath(profile, env).replace(/\\/g, "/");
    const gitdir = normalizePath(binding.path).replace(/\/+$/, "") + "/";
    lines.push(`[includeIf "${keyword}:${gitdir}"]`);
    lines.push(`\tpath = ${inc}`);
    lines.push("");
  }

  lines.push(END);
  return lines.join("\n") + "\n";
}

export function globalGitconfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.GIT_CONFIG_GLOBAL) return env.GIT_CONFIG_GLOBAL;
  return path.join(homeDir(env), ".gitconfig");
}

export function installIncludeIf(
  config: AcctConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const profile of config.profiles) {
    writeProfileInclude(profile, env);
  }
  const block = buildIncludeIfBlock(config, env);
  const gitconfig = globalGitconfigPath(env);
  let existing = fs.existsSync(gitconfig)
    ? fs.readFileSync(gitconfig, "utf8")
    : "";

  // backup once
  const bdir = backupDir(env);
  fs.mkdirSync(bdir, { recursive: true });
  const backupFile = path.join(bdir, "gitconfig.pre-acct");
  if (!fs.existsSync(backupFile) && existing) {
    fs.writeFileSync(backupFile, existing);
  }

  existing = stripManagedBlock(existing);
  const next = existing.trimEnd() + "\n\n" + block;
  fs.writeFileSync(gitconfig, next.startsWith("\n") ? next.slice(1) : next);
}

export function uninstallIncludeIf(env: NodeJS.ProcessEnv = process.env): void {
  const gitconfig = globalGitconfigPath(env);
  if (!fs.existsSync(gitconfig)) return;
  const existing = fs.readFileSync(gitconfig, "utf8");
  const next = stripManagedBlock(existing);
  fs.writeFileSync(gitconfig, next);
  fs.mkdirSync(acctConfigDir(env), { recursive: true });
}

export function restoreGitconfigBackup(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const backupFile = path.join(backupDir(env), "gitconfig.pre-acct");
  const gitconfig = globalGitconfigPath(env);
  if (!fs.existsSync(backupFile)) return false;
  fs.copyFileSync(backupFile, gitconfig);
  return true;
}

export function stripManagedBlock(text: string): string {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return text;
  const end = text.indexOf(END, begin);
  if (end === -1) return text;
  const after = end + END.length;
  return (text.slice(0, begin) + text.slice(after)).replace(/\n{3,}/g, "\n\n");
}
