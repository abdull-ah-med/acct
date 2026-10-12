import { writeGlobalGitconfig } from "../util/gitconfig.js";
import { failAt } from "../util/transaction.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AcctConfig, Profile } from "../types.js";
import { gitIncDir, backupDir, acctConfigDir } from "../config/store.js";
import { sshCommandFor } from "../ssh/keys.js";
import { canonicalHost } from "../secrets/store.js";
import { gitConfigValue, gitConfigSubsection } from "./serialize.js";
import {
  homeDir,
  normalizePath,
  posixShellSingleQuote,
  pathIsPrefix,
} from "../util/paths.js";
import {
  assertSafeBindPath,
  assertSafeProfileFields,
} from "../util/profile-fields.js";
import { atomicWriteFileSync, ensureAcctDir } from "../util/fs-safe.js";
import { renderCmdNodeInvoke } from "../util/cmd-escape.js";

const BEGIN = "# >>> acct managed begin >>>";
const END = "# <<< acct managed end <<<";

export function profileIncPath(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(gitIncDir(env), `${profile.id}.inc`);
}

/**
 * Always emit HTTPS helper reset + acct helper (I8 / I8b) so SSH key attach
 * cannot drop HTTPS isolation. Additionally emit sshCommand when sshKeyPath set.
 * Cite: https://git-scm.com/docs/gitcredentials (helper=""); ssh_config IdentitiesOnly
 */
export function renderProfileInclude(
  profile: Profile,
  helperCommand: string,
): string {
  assertSafeProfileFields({
    name: profile.name,
    email: profile.email,
    host: profile.host,
    user: profile.githubUser,
  });
  const lines = [
    `# acct profile ${profile.id} — do not edit by hand`,
    "[user]",
    `\tname = ${gitConfigValue(profile.name)}`,
    `\temail = ${gitConfigValue(profile.email)}`,
  ];
  for (const host of profileHosts(profile)) {
    lines.push(
      `[credential ${gitConfigSubsection("https://" + host)}]`,
      '\thelper = ""',
      `\thelper = ${gitConfigValue(quoteHelper(helperCommand))}`,
      "\tuseHttpPath = false",
      `\tusername = ${gitConfigValue(profile.githubUser)}`,
    );
  }
  const ssh = sshCommandFor(profile);
  if (ssh) lines.push("[core]", `\tsshCommand = ${gitConfigValue(ssh)}`);

  return lines.join("\n") + "\n";
}

/** Git runs helpers via the shell; paths with spaces need !'…' form. */
function quoteHelper(cmd: string): string {
  // Verified: helper = !'/path with spaces/x' works; bare absolute paths do not.
  // https://git-scm.com/docs/gitcredentials — "!" = shell snippet; empty helper resets list.
  if (cmd.startsWith("!")) return cmd;
  return `!${posixShellSingleQuote(cmd)}`;
}

export function writeProfileInclude(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir = gitIncDir(env);
  ensureAcctDir(dir);
  const helperCmd = resolveHelperConfigValue(env);
  const content = renderProfileInclude(profile, helperCmd);
  const file = profileIncPath(profile, env);
  atomicWriteFileSync(file, content, 0o600);
  return file;
}

/** Remove profile include + optional SSH key material after profile delete. */
export function removeProfileArtifacts(
  profile: Profile,
  env: NodeJS.ProcessEnv = process.env,
  remaining: Profile[] = [],
): void {
  const inc = profileIncPath(profile, env);
  try {
    if (fs.existsSync(inc)) fs.unlinkSync(inc);
  } catch {
    // best effort
  }
  const sshDir = path.join(acctConfigDir(env), "ssh");
  const key = profile.sshKeyPath ?? path.join(sshDir, profile.id);
  const real = (p: string) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  if (
    pathIsPrefix(real(sshDir), real(key)) &&
    !remaining.some((p) => p.sshKeyPath && real(p.sshKeyPath) === real(key))
  ) {
    fs.rmSync(key, { force: true });
    fs.rmSync(key + ".pub", { force: true });
  }
}

function resolveHelperConfigValue(env: NodeJS.ProcessEnv): string {
  return ensureCredentialShim(env);
}

/**
 * Write ~/.config/acct/bin/git-credential-acct → exec's the real package bin
 * with process.execPath (I11b). Git runs helpers via the shell.
 * Cite: https://git-scm.com/docs/gitcredentials ; https://nodejs.org/api/process.html#processexecpath
 */
export function ensureCredentialShim(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const dir = path.join(acctConfigDir(env), "bin");
  ensureAcctDir(dir);
  const shim = path.join(dir, "git-credential-acct");

  const here = path.dirname(fileURLToPath(import.meta.url));
  const realJs = path.resolve(
    here,
    "..",
    "..",
    "bin",
    "git-credential-acct.js",
  );
  // Fail closed if the packaged bin is missing — never PATH-search (I11b).
  const target = realJs;
  const node = env.ACCT_NODE_PATH?.trim() || process.execPath;

  if (process.platform === "win32") {
    const cmdPath = shim + ".cmd";
    fs.writeFileSync(cmdPath, renderCmdNodeInvoke(node, target));
    return cmdPath.replace(/\\/g, "/");
  }

  const script = `#!/bin/sh
exec ${posixShellSingleQuote(node)} ${posixShellSingleQuote(target)} "$@"
`;
  fs.writeFileSync(shim, script, { mode: 0o755 });
  return shim.replace(/\\/g, "/");
}

/**
 * Managed block: global helper reset + acct shim, then per-binding includeIf.
 * Global reset ensures unbound/strict quit cannot be bypassed by osxkeychain
 * that was configured outside includeIf.
 * Cite: https://git-scm.com/docs/gitcredentials ; git.git commit 24321375
 */
export function buildIncludeIfBlock(
  config: AcctConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const useInsensitive =
    process.platform === "win32" || process.platform === "darwin";
  const keyword = useInsensitive ? "gitdir/i" : "gitdir";
  const lines: string[] = [
    BEGIN,
    "[include]",
    `\tpath = ${gitConfigValue(path.join(gitIncDir(env), "_managed.inc").replace(/\\/g, "/"))}`,
  ];
  for (const binding of [...config.bindings].sort(
    (a, b) =>
      normalizePath(a.path).length - normalizePath(b.path).length ||
      normalizePath(a.path).localeCompare(normalizePath(b.path)),
  )) {
    const profile = config.profiles.find((p) => p.id === binding.profileId);
    if (!profile) continue;
    assertSafeBindPath(binding.path);
    const gitdir = normalizePath(binding.path).replace(/\/+$/, "") + "/";
    lines.push(
      `[includeIf ${gitConfigSubsection(keyword + ":" + gitdir)}]`,
      `\tpath = ${gitConfigValue(profileIncPath(profile, env).replace(/\\/g, "/"))}`,
    );
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
  (() => {
    for (const profile of config.profiles) {
      writeProfileInclude(profile, env);
    }
    const hosts = [...new Set(config.profiles.flatMap(profileHosts))].sort();
    const helper = gitConfigValue(quoteHelper(ensureCredentialShim(env)));
    atomicWriteFileSync(
      path.join(gitIncDir(env), "_managed.inc"),
      hosts
        .map(
          (host) =>
            `[credential ${gitConfigSubsection("https://" + host)}]\n\thelper = ""\n\thelper = ${helper}\n`,
        )
        .join(""),
      0o600,
    );
    failAt("includes", env);
    const block = buildIncludeIfBlock(config, env);
    const gitconfig = globalGitconfigPath(env);
    let existing = fs.existsSync(gitconfig)
      ? fs.readFileSync(gitconfig, "utf8")
      : "";

    // backup once
    const bdir = backupDir(env);
    ensureAcctDir(bdir);
    const backupFile = path.join(bdir, "gitconfig.pre-acct");
    if (!fs.existsSync(backupFile) && existing) {
      atomicWriteFileSync(backupFile, existing, 0o600);
    }

    existing = stripManagedBlock(existing);
    const next = existing.trimEnd() + "\n\n" + block;
    const final = next.startsWith("\n") ? next.slice(1) : next;
    writeGlobalGitconfig(gitconfig, final, env);
    failAt("gitconfig", env);
  })();
}

export function uninstallIncludeIf(env: NodeJS.ProcessEnv = process.env): void {
  (() => {
    const gitconfig = globalGitconfigPath(env);
    if (fs.existsSync(gitconfig)) {
      const existing = fs.readFileSync(gitconfig, "utf8");
      const next = stripManagedBlock(existing);
      writeGlobalGitconfig(gitconfig, next, env);
      failAt("gitconfig", env);
    }
    ensureAcctDir(acctConfigDir(env));
    // Clean orphan .inc files under git/
    const gdir = gitIncDir(env);
    if (fs.existsSync(gdir)) {
      for (const name of fs.readdirSync(gdir)) {
        if (name.endsWith(".inc")) {
          try {
            fs.unlinkSync(path.join(gdir, name));
          } catch {
            // ignore
          }
        }
      }
    }
  })();
}

export function restoreGitconfigBackup(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const backupFile = path.join(backupDir(env), "gitconfig.pre-acct");
  const gitconfig = globalGitconfigPath(env);
  if (!fs.existsSync(backupFile)) return false;
  return (() => {
    writeGlobalGitconfig(gitconfig, fs.readFileSync(backupFile, "utf8"), env);
    return true;
  })();
}

export function stripManagedBlock(text: string): string {
  const begin = text.indexOf(BEGIN);
  if (begin === -1) return text;
  const end = text.indexOf(END, begin);
  if (end === -1) return text;
  const after = end + END.length;
  return (text.slice(0, begin) + text.slice(after)).replace(/\n{3,}/g, "\n\n");
}

export function profileHosts(profile: Profile): string[] {
  const host = canonicalHost(profile.host);
  return host === "github.com" ? [host, "gist.github.com"] : [host];
}
export function acctHelperValue(env: NodeJS.ProcessEnv): string {
  const shim = path
    .join(
      acctConfigDir(env),
      "bin",
      process.platform === "win32"
        ? "git-credential-acct.cmd"
        : "git-credential-acct",
    )
    .replace(/\\/g, "/");
  return quoteHelper(shim);
}
