import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Profile } from "../types.js";
import {
  getProfileToken,
  isGithubDotComFamily,
  setProfileToken,
} from "../secrets/store.js";

export function importTokenFromGh(profile: Profile): string {
  const args = [
    "auth",
    "token",
    "--hostname",
    profile.host,
    "--user",
    profile.githubUser,
  ];
  const token = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!token) throw new Error("gh auth token returned empty");
  return token;
}

export async function importAndStoreToken(profile: Profile): Promise<void> {
  const token = importTokenFromGh(profile);
  await setProfileToken(profile, token);
}

/**
 * Build env for running gh/git without mutating global gh active account.
 * Spec: GH_TOKEN overrides stored credentials — https://cli.github.com/manual/gh_help_environment
 */
export async function envForProfile(
  profile: Profile,
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...base };
  env.ACCT_PROFILE = profile.id;
  const token = await getProfileToken(profile);
  if (token) {
    if (isGithubDotComFamily(profile.host)) {
      env.GH_TOKEN = token;
      delete env.GITHUB_TOKEN;
      delete env.GH_ENTERPRISE_TOKEN;
      delete env.GITHUB_ENTERPRISE_TOKEN;
    } else {
      env.GH_ENTERPRISE_TOKEN = token;
      env.GH_HOST = profile.host;
      delete env.GH_TOKEN;
      delete env.GITHUB_TOKEN;
    }
  } else {
    // Clear stale tokens so they cannot override
    delete env.GH_TOKEN;
    delete env.GITHUB_TOKEN;
    delete env.GH_ENTERPRISE_TOKEN;
    delete env.GITHUB_ENTERPRISE_TOKEN;
  }
  if (profile.host !== "github.com") {
    env.GH_HOST = profile.host;
  }
  return env;
}

export async function envForUnbound(
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...base };
  delete env.ACCT_PROFILE;
  // Do not clear user's GH_TOKEN when unbound — only when switching profiles
  return env;
}

export function ghApiLogin(env: NodeJS.ProcessEnv): string | null {
  try {
    const out = execFileSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * gh auth subcommands that mutate global gh/git auth state or dump tokens.
 * Cite: https://cli.github.com/manual/gh_auth_login (and logout/refresh/token/switch/setup-git)
 * Cite: docs/research/local-acct-exec-deny-cites-2026-08-08.md
 */
const DANGEROUS_GH_AUTH = new Set([
  "login",
  "logout",
  "refresh",
  "token",
  "switch",
  "setup-git",
]);

/**
 * POSIX / common wrappers that forward to a real argv.
 * Cite: docs/research/xargs-sticky-uninstall-delete-cites-2026-08-08.md
 * Cite: https://man7.org/linux/man-pages/man1/xargs.1.html
 */
const WRAPPER_BASENAMES = new Set([
  "env",
  "nice",
  "nohup",
  "time",
  "timeout",
  "stdbuf",
  "command",
  "builtin",
  "exec",
  "xargs",
]);

const SHELL_BASENAMES = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
]);

/** Basename of argv[0], lowercased, with Windows executable suffixes stripped. */
export function commandBasename(cmd: string): string {
  const base = path.basename(cmd).toLowerCase();
  return base.replace(/\.(exe|cmd|bat)$/i, "");
}

/**
 * Skip GNU/BSD `xargs` options so the following utility is visible to the deny-list.
 * Cite: https://man7.org/linux/man-pages/man1/xargs.1.html ; https://ss64.com/mac/xargs.html
 */
export function skipXargsOptions(argv: string[], start: number): number {
  let i = start;
  const takesArg = new Set([
    "-a",
    "--arg-file",
    "-d",
    "--delimiter",
    "-E",
    "-I",
    "-J",
    "-L",
    "--max-lines",
    "-n",
    "--max-args",
    "-P",
    "--max-procs",
    "-R",
    "-s",
    "--max-chars",
    "--process-slot-var",
  ]);
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === "--") return i + 1;
    if (!a.startsWith("-") || a === "-") return i;

    if (a.startsWith("--")) {
      if (a.includes("=")) {
        i++;
        continue;
      }
      if (takesArg.has(a)) {
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Attached-value shorts: -I{}, -i{}, -Eeof, -n1, -L2, -P4, -s99, -R5
    if (/^-[IiJE]/.test(a) && a.length > 2) {
      i++;
      continue;
    }
    if (/^-[IiJE]$/.test(a)) {
      i += 2;
      continue;
    }
    if (/^-[LnsPR]\d/.test(a)) {
      i++;
      continue;
    }
    if (/^-[LnsPRad]$/.test(a)) {
      i += 2;
      continue;
    }
    // Flag-only clusters: -0, -optx, -prt, …
    if (/^-[0eiloprtxz]+$/i.test(a)) {
      i++;
      continue;
    }
    // Unknown short option — skip one token (fail open toward seeing utility)
    i++;
  }
  return i;
}

/**
 * Skip `env`/`nice`/`xargs`/… prefixes so `/usr/bin/gh` and
 * `xargs -I{} gh auth token` still match the deny-list.
 */
export function stripWrapperArgv(argv: string[]): string[] {
  let i = 0;
  while (i < argv.length) {
    const base = commandBasename(argv[i]!);
    if (!WRAPPER_BASENAMES.has(base)) break;
    i++;
    if (base === "env") {
      while (i < argv.length) {
        const a = argv[i]!;
        if (a === "-i" || a === "-" || a === "-0" || a === "-v" || a === "-S") {
          i++;
          continue;
        }
        if (
          a === "-u" ||
          a === "-C" ||
          a === "--unset" ||
          a === "--chdir" ||
          a === "-s" ||
          a === "--split-string"
        ) {
          i += 2;
          continue;
        }
        if (a.startsWith("--unset=") || a.startsWith("--chdir=")) {
          i++;
          continue;
        }
        if (a.startsWith("-") && a !== "--") {
          i++;
          continue;
        }
        if (a.includes("=")) {
          i++;
          continue;
        }
        break;
      }
      continue;
    }
    if (base === "timeout") {
      while (i < argv.length && argv[i]!.startsWith("-")) {
        const f = argv[i]!;
        if (
          f === "-s" ||
          f === "--signal" ||
          f === "-k" ||
          f === "--kill-after"
        ) {
          i += 2;
        } else {
          i++;
        }
      }
      // duration
      if (i < argv.length && !argv[i]!.startsWith("-")) i++;
      continue;
    }
    if (base === "stdbuf") {
      while (i < argv.length && argv[i]!.startsWith("-")) {
        const f = argv[i]!;
        if (f === "-i" || f === "-o" || f === "-e") i += 2;
        else i++;
      }
      continue;
    }
    if (base === "nice") {
      if (i < argv.length && (argv[i] === "-n" || argv[i]!.startsWith("-"))) {
        if (argv[i] === "-n") i += 2;
        else i++;
      }
      continue;
    }
    if (base === "xargs") {
      i = skipXargsOptions(argv, i);
      continue;
    }
    // nohup / time / command / builtin / exec → next token is the command
  }
  return argv.slice(i);
}

/**
 * True when this argv segment looks like xargs options that perform stdin
 * replacement into initial-arguments (`-I` / `-i` / `-J` and long forms).
 * Cite: https://man7.org/linux/man-pages/man1/xargs.1.html ; https://ss64.com/mac/xargs.html
 */
function xargsOptionsUseReplace(argv: string[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const a = argv[i]!;
    if (a === "--") break;
    if (a === "-I" || a === "-i" || a === "-J") return true;
    if (a.startsWith("-I") || a.startsWith("-i") || a.startsWith("-J")) return true;
    if (a === "--replace" || a.startsWith("--replace=")) return true;
  }
  return false;
}

/**
 * Fail-closed scan for `xargs` under `acct exec`.
 *
 * xargs builds the final argv from **stdin** (append) or `-I`/`-J` replacement.
 * Those words are invisible at deny time, so matching only `gh auth token` in
 * argv is insufficient:
 *   `printf 'auth\ntoken\n' | acct exec xargs gh`
 *   `printf 'switch\n' | acct exec xargs -I{} sh -c 'unset GH_TOKEN; gh auth {} …'`
 *
 * Policy (I18 / T13):
 * - Effective utility is `gh` → refuse (use `acct exec gh …` directly).
 * - Effective utility is a shell → refuse (substitution into `-c` scripts).
 *
 * Cite: https://man7.org/linux/man-pages/man1/xargs.1.html
 * Cite: https://ss64.com/mac/xargs.html
 * Cite: docs/research/i18-xargs-stdin-bypass-cites-2026-08-08.md
 */
function xargsArgvHasDangerousGh(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    if (commandBasename(argv[i]!) !== "xargs") continue;

    const optStart = i + 1;
    const utilIdx = skipXargsOptions(argv, optStart);
    // No utility → xargs defaults to `echo` (safe).
    if (utilIdx >= argv.length) continue;

    const utilAndArgs = argv.slice(utilIdx);
    const rest = stripWrapperArgv(utilAndArgs);
    if (!rest.length) {
      // Nested wrappers only (e.g. `xargs env`) — still fail-closed if replace
      // opts are present (stdin can complete a later gh via a wrapper chain we
      // did not fully peel). Without replace, empty rest after wrappers is rare.
      if (xargsOptionsUseReplace(argv, optStart, utilIdx)) return true;
      continue;
    }

    const base = commandBasename(rest[0]!);
    if (base === "gh") return true;
    if (SHELL_BASENAMES.has(base)) return true;

    // Belt: literal `gh auth <dangerous>` still in argv after a non-gh utility
    // (should already be caught above when utility is gh; keep for odd shapes).
    for (let j = 0; j < rest.length; j++) {
      if (commandBasename(rest[j]!) !== "gh") continue;
      if (
        rest[j + 1]?.toLowerCase() === "auth" &&
        !!rest[j + 2] &&
        DANGEROUS_GH_AUTH.has(rest[j + 2]!.toLowerCase())
      ) {
        return true;
      }
    }
    for (let j = 0; j < rest.length; j++) {
      if (!SHELL_BASENAMES.has(commandBasename(rest[j]!))) continue;
      for (let k = j + 1; k < rest.length; k++) {
        const a = rest[k]!;
        if (shellFlagTakesScript(a)) {
          const script = rest[k + 1];
          if (script && shellScriptHasDangerousGhAuth(script)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Strip obfuscation so deny matching sees reconstructed `gh auth <dangerous>`.
 *
 * - Empty quote concatenations: `refres""h` / `tok''en`
 * - POSIX/C escapes that printf/echo turn into whitespace for xargs:
 *   `\n` `\t` `\r` `\v` `\f` `\0` and octal `\ddd`
 *   (https://pubs.opengroup.org/onlinepubs/9699919799/utilities/printf.html)
 * - Empty-IFS gluing: `gh$IFS auth$IFS token` → `gh auth token`
 *   (bash Word Splitting: null IFS → unquoted empty expansions removed)
 *
 * Cite: docs/research/i18-shell-obfuscation-cites-2026-08-08.md
 * Cite: docs/research/i18-shell-bypass-round2-cites-2026-08-08.md
 */
export function normalizeShellScriptForAuthDeny(script: string): string {
  let out = script;
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/""/g, "").replace(/''/g, "");
  }
  // printf / C escapes → whitespace so `\btoken\b` matches after `auth\ntoken`
  out = out
    .replace(/\\[nrtvf0]/gi, " ")
    .replace(/\\[0-7]{1,3}/g, " ");
  // Strip IFS expansions used as empty glue (quoted or bare).
  out = out.replace(/\$\{IFS\}|\$IFS|"\$\{IFS\}"|'\$\{IFS\}'|"\$IFS"|'\$IFS'/g, "");
  return out;
}

/** Path-tolerant `gh` / `"gh"` / `'gh'` literal (not expansions). */
const GH_LIT = String.raw`(?:["'](?:\S*/)?gh(?:\.exe)?["']|(?:\S*/)?gh(?:\.exe)?)`;
/** `auth` / `"auth"` / `'auth'`. */
const AUTH_LIT = String.raw`(?:["']auth["']|auth)`;
/** `$var` / `${…}` / `$(…)` / backticks, optionally double- or single-quoted. */
const SHELL_EXP_INNER = String.raw`(?:\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\}|\$\([^)]+\)|\`[^\`]+\`)`;
const SHELL_EXP = String.raw`(?:["']${SHELL_EXP_INNER}["']|${SHELL_EXP_INNER})`;
/** One or more glued expansions: `$a$b`, `"$(echo token)"`. */
const SHELL_EXP_GLUE = String.raw`(?:${SHELL_EXP})+`;

const DECODER_RE =
  /\b(?:base64|base32|xxd|uudecode|openssl)\b/i;

/**
 * Detect denied `gh auth <dangerous>` inside a shell `-c` script string.
 *
 * Covers literal `/usr/bin/gh auth token`, quoted `"gh" "auth" "token"`,
 * expansions (`$g auth token`, `gh $x switch`, `gh auth $a$b`, `$(…)` as
 * subcommand), empty-quote / `$IFS` gluing, printf `\n` → xargs reconstruction,
 * and decoder|shell nested execution (`base64 -d | sh`).
 *
 * Cite: https://cli.github.com/manual/gh_auth_token (and login/switch/…)
 * Cite: https://man7.org/linux/man-pages/man1/xargs.1.html
 * Cite: https://pubs.opengroup.org/onlinepubs/9699919799/utilities/printf.html
 * Cite: docs/research/i18-shell-obfuscation-cites-2026-08-08.md
 * Cite: docs/research/i18-shell-bypass-round2-cites-2026-08-08.md
 */
export function shellScriptHasDangerousGhAuth(script: string): boolean {
  const s = normalizeShellScriptForAuthDeny(script);
  const subs = [...DANGEROUS_GH_AUTH].join("|");
  const dangerLit = String.raw`(?:["'](?:${subs})["']|(?:${subs})\b)`;
  const sep = String.raw`(?:\s+)+`;
  const boundary = String.raw`(^|[^A-Za-z0-9_])`;
  const shellAlts = [...SHELL_BASENAMES].join("|");
  const pipeToShell = new RegExp(
    String.raw`\|\s*(?:\S*/)?(?:${shellAlts})\b`,
    "i",
  );

  // Nested shell via decoder pipeline / eval — reconstructs arbitrary argv.
  // Cite: live bypass `echo … | base64 -d | sh` (2026-08-08)
  if (DECODER_RE.test(s) && (pipeToShell.test(s) || /\beval\b/i.test(s))) {
    return true;
  }

  const triplePatterns = [
    // Literal / path / quoted: gh auth token
    new RegExp(
      `${boundary}${GH_LIT}${sep}${AUTH_LIT}${sep}${dangerLit}`,
      "i",
    ),
    // Expansion as argv0: $g auth token ; $(which gh) auth login
    new RegExp(
      `${boundary}${SHELL_EXP}${sep}${AUTH_LIT}${sep}${dangerLit}`,
      "i",
    ),
    // Expansion as auth: gh $x switch
    new RegExp(
      `${boundary}${GH_LIT}${sep}${SHELL_EXP}${sep}${dangerLit}`,
      "i",
    ),
    // Expansion(s) as dangerous subcommand: gh auth $(echo token) ; gh auth $a$b
    new RegExp(
      `${boundary}${GH_LIT}${sep}${AUTH_LIT}${sep}${SHELL_EXP_GLUE}`,
      "i",
    ),
  ];
  if (triplePatterns.some((re) => re.test(s))) return true;

  // xargs stdin reconstruction (any order of auth+danger with xargs+gh).
  // Fail-closed: secondary order regexes previously missed `printf 'auth\ntoken\n' | xargs -n2 gh`
  // when escapes were still literal. Cite: https://man7.org/linux/man-pages/man1/xargs.1.html
  const hasDangerWord = new RegExp(`\\b(?:${subs})\\b`, "i").test(s);
  const hasAuthWord = /\bauth\b/i.test(s);
  const hasGhWord = new RegExp(
    `${boundary}(?:\\S*/)?gh(?:\\.exe)?\\b`,
    "i",
  ).test(s);
  if (hasDangerWord && hasAuthWord && hasGhWord && /\bxargs\b/i.test(s)) {
    return true;
  }

  // Pipe to a nested shell while gh/auth/danger words are present (belt + suspenders
  // for reconstructions that avoid named decoders).
  if (hasDangerWord && hasAuthWord && hasGhWord && pipeToShell.test(s)) {
    return true;
  }

  return false;
}

function shellFlagTakesScript(flag: string): boolean {
  // -c, -lc, -ic, -plc, … — any short-option cluster containing c (not long opts)
  if (flag === "-c") return true;
  if (flag.startsWith("--")) return false;
  if (!flag.startsWith("-") || flag.length < 2) return false;
  return flag.includes("c");
}

/**
 * True when argv would run a denied `gh auth` subcommand — including absolute
 * paths, `env`/`xargs`/… wrappers, and shell `-c` scripts.
 *
 * `xargs` is fail-closed when its effective utility is `gh` or a shell: stdin /
 * `-I{}` can supply dangerous words that never appear in the parent argv
 * (docs/research/i18-xargs-stdin-bypass-cites-2026-08-08.md).
 *
 * Non-goal: arbitrary interpreters (`node -e`, …). `acct exec` already injects
 * GH_TOKEN; I18 closes gh/global-auth footguns, not a sandbox. Sticky GH_TOKEN
 * complements the deny-list but children can unset it — shell obfuscation must
 * still match (docs/research/i18-shell-obfuscation-cites-2026-08-08.md;
 * docs/research/i18-shell-bypass-round2-cites-2026-08-08.md).
 *
 * Cite: docs/research/xargs-sticky-uninstall-delete-cites-2026-08-08.md
 * Cite: docs/research/i18-shell-obfuscation-cites-2026-08-08.md
 * Cite: docs/research/i18-shell-bypass-round2-cites-2026-08-08.md
 * Cite: docs/research/i18-xargs-stdin-bypass-cites-2026-08-08.md
 */
export function isDangerousGhArgv(argv: string[]): boolean {
  if (!argv.length) return false;

  // Fail-closed for xargs: utility gh|shell (stdin / -I{} invisible at deny time).
  if (xargsArgvHasDangerousGh(argv)) return true;

  const rest = stripWrapperArgv(argv);
  if (!rest.length) return false;

  const base = commandBasename(rest[0]!);
  if (base === "gh") {
    return (
      rest[1]?.toLowerCase() === "auth" &&
      !!rest[2] &&
      DANGEROUS_GH_AUTH.has(rest[2]!.toLowerCase())
    );
  }

  if (SHELL_BASENAMES.has(base)) {
    for (let i = 1; i < rest.length; i++) {
      const a = rest[i]!;
      if (shellFlagTakesScript(a)) {
        const script = rest[i + 1];
        if (script && shellScriptHasDangerousGhAuth(script)) return true;
      }
    }
  }

  return false;
}
