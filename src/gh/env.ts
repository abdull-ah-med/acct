import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Profile } from "../types.js";
import {
  isGithubDotComFamily,
  setProfileToken,
} from "../secrets/store.js";
import { importTokenFromGh, resolveProfileToken } from "./token.js";

export { importTokenFromGh } from "./token.js";

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
  const token = await resolveProfileToken(profile, base);
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

export function ghApiLogin(
  env: NodeJS.ProcessEnv,
  opts: { timeoutMs?: number } = {},
): string | null {
  try {
    const out = execFileSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: opts.timeoutMs ?? 3000,
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

/**
 * Shells whose `-c` / `-Command` / `/c` scripts are scanned for denied gh auth.
 * Cite: Bash manual; about_Pwsh (-Command/-c); cmd /c.
 * Cite: REMEDIATION_PLAN.md P1.2 / P1.11 (pwsh, ash, mksh, busybox).
 */
const SHELL_BASENAMES = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "fish",
  "csh",
  "tcsh",
  "ash",
  "mksh",
  "busybox",
  "pwsh",
  "powershell",
  "cmd",
]);

/** Words that are dangerous as shell -c positional parameters reconstructing gh auth. */
const DANGEROUS_POSITIONAL_WORDS = new Set([
  "auth",
  "token",
  "login",
  "logout",
  "refresh",
  "switch",
  "setup-git",
  "gh",
]);

/**
 * Git config keys whose values are executed as shell / external commands, plus
 * include.path / includeIf.* which can pull in attacker-controlled config.
 * Cite: https://git-scm.com/docs/git-config (core.pager, core.editor, …)
 * Cite: REMEDIATION_PLAN.md P1.9
 */
const GIT_SHELL_CONFIG_KEYS = new Set([
  "core.pager",
  "core.editor",
  "core.askpass",
  "core.sshcommand",
  "credential.helper",
  "diff.external",
  "merge.tool",
  "sequence.editor",
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
 * - ANSI-C quoting `$'\x67h'` / `$'\147'` (bash §3.1.2.4) decoded first
 * - Empty quote concatenations: `refres""h` / `tok''en`
 * - POSIX/C escapes that printf/echo turn into whitespace for xargs:
 *   `\n` `\t` `\r` `\v` `\f` `\0` and octal `\ddd`
 * - Empty-IFS gluing: `gh$IFS auth$IFS token` → `gh auth token`
 * - Brace expansion `{gh,auth,token}` expanded when it names gh + danger
 *
 * Cite: https://www.gnu.org/software/bash/manual/bash.html#ANSI-C-Quoting
 * Cite: https://www.gnu.org/software/bash/manual/bash.html#Brace-Expansion
 * Cite: docs/research/i18-shell-obfuscation-cites-2026-08-08.md
 * Cite: REMEDIATION_PLAN.md P1.3 / P1.6
 */
export function normalizeShellScriptForAuthDeny(script: string): string {
  let out = decodeAnsiCQuotedSegments(script);
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
  out = expandDangerousBraceGroups(out);
  return out;
}

/**
 * Decode bash ANSI-C `$('…')` segments so hex/octal escapes become matchable text.
 * Cite: https://www.gnu.org/software/bash/manual/bash.html#ANSI-C-Quoting
 */
function decodeAnsiCQuotedSegments(script: string): string {
  return script.replace(/\$'((?:\\.|[^'\\])*)'/g, (_m, body: string) =>
    decodeAnsiCBody(body),
  );
}

function decodeAnsiCBody(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      out += body[i];
      continue;
    }
    i++;
    if (i >= body.length) {
      out += "\\";
      break;
    }
    const c = body[i]!;
    if (c === "x") {
      const hex = body.slice(i + 1).match(/^[0-9a-fA-F]{1,2}/)?.[0];
      if (hex) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += hex.length;
        continue;
      }
    }
    if (c === "u") {
      const hex = body.slice(i + 1).match(/^[0-9a-fA-F]{4}/)?.[0];
      if (hex) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
    }
    if (c === "U") {
      const hex = body.slice(i + 1).match(/^[0-9a-fA-F]{8}/)?.[0];
      if (hex) {
        const cp = parseInt(hex, 16);
        out += cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
        i += 8;
        continue;
      }
    }
    if (/[0-7]/.test(c)) {
      const oct = body.slice(i).match(/^[0-7]{1,3}/)?.[0] ?? c;
      out += String.fromCharCode(parseInt(oct, 8));
      i += oct.length - 1;
      continue;
    }
    const std: Record<string, string> = {
      a: "\x07",
      b: "\b",
      e: "\x1b",
      E: "\x1b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      "'": "'",
      '"': '"',
      "?": "?",
    };
    out += std[c] ?? c;
  }
  return out;
}

/**
 * Fail-closed brace expansion: `{gh,auth,token}` → `gh auth token` when the
 * group contains both a gh word and a dangerous auth subcommand.
 * Cite: https://www.gnu.org/software/bash/manual/bash.html#Brace-Expansion
 */
function expandDangerousBraceGroups(script: string): string {
  return script.replace(/\{([^{}]+)\}/g, (full, inner: string) => {
    const parts = inner.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
    if (parts.length < 2) return full;
    const hasGh = parts.some((p) => /(?:^|\/)gh(?:\.exe)?$/i.test(p));
    const hasDanger = parts.some((p) => DANGEROUS_GH_AUTH.has(p.toLowerCase()));
    if (hasGh && hasDanger) return parts.join(" ");
    return full;
  });
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

/** Decoders / reconstructors that can pipe arbitrary text into a nested shell. */
const DECODER_RE =
  /\b(?:base64|base32|xxd|uudecode|openssl|printf|echo\s+-e)\b/i;

/**
 * Detect denied `gh auth <dangerous>` inside a shell `-c` script string.
 *
 * Covers literal `/usr/bin/gh auth token`, quoted `"gh" "auth" "token"`,
 * expansions (`$g auth token`, `gh $x switch`, `gh auth $a$b`, `$(…)` as
 * subcommand), empty-quote / `$IFS` gluing, printf `\n` → xargs reconstruction,
 * decoder|shell nested execution (`base64 -d | sh`, `printf … | sh`),
 * brace expansion, alias-to-gh, and assignment reconstruction (`$x auth $y`).
 *
 * Cite: https://cli.github.com/manual/gh_auth_token (and login/switch/…)
 * Cite: REMEDIATION_PLAN.md P1.3–P1.7
 */
export function shellScriptHasDangerousGhAuth(script: string): boolean {
  const s = normalizeShellScriptForAuthDeny(script);
  const subs = [...DANGEROUS_GH_AUTH].join("|");
  const dangerLit = String.raw`(?:["'](?:${subs})["']|(?:${subs})\b)`;
  const sep = String.raw`(?:\s+)+`;
  const boundary = String.raw`(^|[^A-Za-z0-9_])`;
  // Pipe targets: real shells only (exclude cmd/pwsh noise in | pipelines for POSIX)
  const pipeShellAlts = [
    "bash",
    "sh",
    "zsh",
    "dash",
    "ksh",
    "fish",
    "csh",
    "tcsh",
    "ash",
    "mksh",
  ].join("|");
  const pipeToShell = new RegExp(
    String.raw`\|\s*(?:\S*/)?(?:${pipeShellAlts})\b`,
    "i",
  );

  // Nested shell via decoder pipeline / eval — reconstructs arbitrary argv.
  // Cite: live bypass `echo … | base64 -d | sh` (2026-08-08); P1.5 printf/echo -e
  if (DECODER_RE.test(s) && (pipeToShell.test(s) || /\beval\b/i.test(s))) {
    return true;
  }

  const triplePatterns = [
    // Literal / path / quoted: gh auth token
    new RegExp(
      `${boundary}${GH_LIT}${sep}${AUTH_LIT}${sep}${dangerLit}`,
      "i",
    ),
    // Expansion(s) as argv0: $g auth token ; $a$b auth token ; $(which gh) auth login
    new RegExp(
      `${boundary}${SHELL_EXP_GLUE}${sep}${AUTH_LIT}${sep}${dangerLit}`,
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
    // P1.4: $x auth $y — expansion, literal auth, expansion
    new RegExp(
      `${boundary}${SHELL_EXP_GLUE}${sep}${AUTH_LIT}${sep}${SHELL_EXP_GLUE}`,
      "i",
    ),
  ];
  if (triplePatterns.some((re) => re.test(s))) return true;

  const hasDangerWord = new RegExp(`\\b(?:${subs})\\b`, "i").test(s);
  const hasAuthWord = /\bauth\b/i.test(s);
  const hasGhWord = new RegExp(
    `${boundary}(?:\\S*/)?gh(?:\\.exe)?\\b`,
    "i",
  ).test(s);
  if (hasDangerWord && hasAuthWord && hasGhWord && /\bxargs\b/i.test(s)) {
    return true;
  }

  if (hasDangerWord && hasAuthWord && hasGhWord && pipeToShell.test(s)) {
    return true;
  }

  // Sole-command glued expansions: `x=gh; y=' auth token'; $x$y`
  if (hasDangerWord && hasAuthWord && hasGhWord) {
    const gluedSoleCmd = new RegExp(
      String.raw`(^|[;|&{}\n])\s*${SHELL_EXP_GLUE}\s*([;|&{}\n]|$)`,
      "i",
    );
    if (gluedSoleCmd.test(s)) return true;
  }

  // P1.4: assignment reconstruction (`x=gh` / `y=token` / `a=$(printf gh)`)
  if (hasDangerWord && hasAuthWord && hasGhWord) {
    const assignRe =
      /=\s*['"]?(?:gh|token|login|logout|refresh|switch|setup-git)\b|=\$\([^)]*\b(?:gh|token)\b/i;
    if (assignRe.test(s)) return true;
  }

  // P1.7: alias g=gh; g auth token
  if (hasAuthWord && hasDangerWord) {
    for (const m of s.matchAll(
      /\balias\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]?(?:\S*\/)?gh(?:\.exe)?['"]?/gi,
    )) {
      const name = m[1]!;
      const useRe = new RegExp(
        String.raw`(^|[^A-Za-z0-9_])${name}${sep}${AUTH_LIT}${sep}${dangerLit}`,
        "i",
      );
      if (useRe.test(s)) return true;
    }
    // Conservative: alias + auth + danger present
    if (/\balias\b/i.test(s) && hasGhWord) return true;
  }

  return false;
}

/**
 * True when a flag introduces an inline script body for a known shell.
 * Cite: about_Pwsh (-Command / -c); cmd /c; bash -c / -lc.
 */
function shellFlagTakesScript(flag: string): boolean {
  if (flag === "-c") return true;
  const lower = flag.toLowerCase();
  if (lower === "-command" || lower === "/c") return true;
  if (flag.startsWith("--")) return false;
  // Avoid treating find -printf / similar as shell -c (must be pure letter cluster)
  if (/^-[a-zA-Z]+$/.test(flag) && flag.includes("c") && !flag.includes("printf")) {
    // Still exclude long utility flags that happen to contain "c"
    if (flag.length > 4 && !/^-[a-z]*c[a-z]*$/i.test(flag)) return false;
    // Shell option clusters are short: -c, -lc, -ic, -plc, -norc, …
    if (flag.length <= 6) return true;
  }
  return false;
}

/**
 * pwsh/powershell flags whose script body is not inspectable in argv:
 * EncodedCommand (UTF-16LE Base64), -File, -CommandWithArgs, stdin `-`.
 * Fail-closed — same rationale as xargs stdin (I18).
 * Cite: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh
 */
function pwshArgvHidesScript(argv: string[]): boolean {
  for (let i = 1; i < argv.length; i++) {
    const raw = argv[i]!;
    const f = raw.replace(/^\/+/, "-").toLowerCase();
    const flag = f.split(":", 1)[0]!;
    // EncodedCommand: -e, -ec, -enc… (not -ex/-ep ExecutionPolicy)
    if (flag === "-e" || flag === "-ec") return true;
    if (flag.startsWith("-enc")) return true;
    if (flag === "-file" || flag === "-f") return true;
    if (flag === "-commandwithargs" || flag === "-cwa") return true;
    if (
      (flag === "-command" || flag === "-c") &&
      argv[i + 1] === "-"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * After `shell -c SCRIPT`, remaining argv are `$0` then `$1…`. Deny when
 * positionals can complete a dangerous gh auth invocation.
 * Cite: Bash §3.7.1 Positional Parameters; REMEDIATION_PLAN.md P1.1
 */
function shellCPositionalsDangerous(
  script: string,
  argsAfterScript: string[],
): boolean {
  if (!argsAfterScript.length) return false;
  const positionals = argsAfterScript.slice(1); // skip $0
  const joined = [...argsAfterScript, ...positionals].join(" ");
  const usesPositional =
    /\$@|\$\*|\$\{[@*]\}|\$[1-9]|\$\{[1-9][0-9]*\}/.test(script);
  const scriptHasGh = /\bgh(?:\.exe)?\b/i.test(script);
  const hasDangerPos = positionals.some((p) =>
    DANGEROUS_POSITIONAL_WORDS.has(p.toLowerCase()),
  );

  // `gh $1 $2` _ auth token — gh in script + dangerous positional words
  if (scriptHasGh && hasDangerPos) return true;
  // `$1 $2 $3` _ gh auth token — positionals carry the full command
  if (usesPositional && hasDangerPos) return true;
  if (usesPositional && argvHasGhAuthDangerSubsequence(argsAfterScript)) {
    return true;
  }
  if (usesPositional && argvHasGhAuthDangerSubsequence(positionals)) {
    return true;
  }
  // Belt: combined script + positionals look like denied script
  if (
    (usesPositional || scriptHasGh) &&
    shellScriptHasDangerousGhAuth(`${script} ${joined}`)
  ) {
    return true;
  }
  return false;
}

/** Literal `gh auth <dangerous>` subsequence anywhere in argv. */
function argvHasGhAuthDangerSubsequence(argv: string[]): boolean {
  for (let j = 0; j < argv.length - 2; j++) {
    if (commandBasename(argv[j]!) !== "gh") continue;
    if (argv[j + 1]?.toLowerCase() !== "auth") continue;
    if (DANGEROUS_GH_AUTH.has(argv[j + 2]!.toLowerCase())) return true;
  }
  return false;
}

/**
 * `find -exec … \;` / `-execdir`: scan the utility argv with the same deny rules.
 * Cite: REMEDIATION_PLAN.md P1.10
 */
function findExecArgvDangerous(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!.toLowerCase();
    if (a !== "-exec" && a !== "-execdir") continue;
    let end = argv.length;
    for (let j = i + 1; j < argv.length; j++) {
      if (argv[j] === ";" || argv[j] === "\\;" || argv[j] === "+") {
        end = j;
        break;
      }
    }
    const execArgv = argv.slice(i + 1, end);
    if (execArgv.length && isDangerousGhArgv(execArgv)) return true;
  }
  return false;
}

/**
 * Strip env-injected git config overrides that can define shell aliases.
 * Keeps GIT_CONFIG_GLOBAL / SYSTEM / NOSYSTEM (isolation helpers).
 * Cite: https://git-scm.com/docs/git-config#_environment
 * Cite: REMEDIATION_PLAN.md P1.8
 */
export function stripGitConfigEnvOverrides(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const key of Object.keys(out)) {
    if (
      key === "GIT_CONFIG_COUNT" ||
      key.startsWith("GIT_CONFIG_KEY_") ||
      key.startsWith("GIT_CONFIG_VALUE_")
    ) {
      delete out[key];
    }
  }
  return out;
}

function parseGitConfigAssignment(value: string): { key: string; val: string } | null {
  const eq = value.indexOf("=");
  if (eq <= 0) return null;
  return {
    key: value.slice(0, eq).trim().toLowerCase(),
    val: value.slice(eq + 1),
  };
}

/**
 * True when a git `-c`/`--config` value defines a shell alias (`alias.*=!…`)
 * or another shell-executing config key with denied `gh auth`.
 * Cite: https://git-scm.com/docs/git-config
 * Cite: REMEDIATION_PLAN.md P1.9
 */
function gitConfigAssignmentDangerous(value: string): boolean {
  const parsed = parseGitConfigAssignment(value.trim());
  if (!parsed) return false;
  const { key, val } = parsed;

  if (key === "include.path" || key.startsWith("includeif.")) return true;

  if (key.startsWith("alias.") && val.startsWith("!")) {
    return shellScriptHasDangerousGhAuth(val.slice(1));
  }

  if (GIT_SHELL_CONFIG_KEYS.has(key)) {
    // Values may be `gh auth token` or `!gh …` or `sh -c '…'`
    const body = val.startsWith("!") ? val.slice(1) : val;
    if (shellScriptHasDangerousGhAuth(body)) return true;
    if (argvHasGhAuthDangerSubsequence(body.split(/\s+/))) return true;
  }
  return false;
}

/**
 * Scan git argv for `-c alias.p=!…` / `-c core.pager=…` / `-c include.path=…`.
 */
function gitArgvHasDangerousGhAuth(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-c" || a === "--config") {
      const val = argv[i + 1];
      if (val && gitConfigAssignmentDangerous(val)) return true;
      continue;
    }
    if (
      (a.startsWith("-c") && a.length > 2 && !a.startsWith("--")) ||
      a.startsWith("--config=")
    ) {
      const val = a.startsWith("--config=")
        ? a.slice("--config=".length)
        : a.slice(2);
      if (gitConfigAssignmentDangerous(val)) return true;
    }
  }
  return false;
}

/** awk / gawk / mawk — any arg may hold program text with system("gh auth …"). */
const AWK_BASENAMES = new Set(["awk", "gawk", "mawk"]);

/**
 * Collect inline script snippets from script-host argv (osascript -e, …).
 */
function inlineScriptSnippets(base: string, argv: string[]): string[] {
  const out: string[] = [];
  if (AWK_BASENAMES.has(base)) {
    out.push(...argv.slice(1));
    return out;
  }
  if (base === "osascript") {
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === "-e" && argv[i + 1]) {
        out.push(argv[i + 1]!);
        i++;
      }
    }
    return out;
  }
  return out;
}

/**
 * Scan shell argv for `-c`/`-Command`/`/c` scripts and their positional params.
 */
function shellArgvHasDangerousGhAuth(argv: string[]): boolean {
  const base = commandBasename(argv[0] ?? "");
  let start = 1;
  // busybox sh -c … — applet name precedes flags
  if (
    base === "busybox" &&
    argv.length > 1 &&
    SHELL_BASENAMES.has(commandBasename(argv[1]!))
  ) {
    start = 2;
  }

  for (let i = start; i < argv.length; i++) {
    const a = argv[i]!;
    if (!shellFlagTakesScript(a)) continue;

    // cmd /c joins the rest of argv as the command line
    if (base === "cmd" && a.toLowerCase() === "/c") {
      const restCmd = argv.slice(i + 1);
      const cmdLine = restCmd.join(" ");
      if (cmdLine && shellScriptHasDangerousGhAuth(cmdLine)) return true;
      if (argvHasGhAuthDangerSubsequence(restCmd)) return true;
      // Nested `pwsh -EncodedCommand` / `-File` — body not in the cmd string.
      if (restCmd.length && isDangerousGhArgv(restCmd)) return true;
      const tokens = cmdLine.trim().split(/\s+/).filter(Boolean);
      if (tokens.length && isDangerousGhArgv(tokens)) return true;
      continue;
    }

    const script = argv[i + 1];
    if (!script) continue;
    if (shellScriptHasDangerousGhAuth(script)) return true;
    if (shellCPositionalsDangerous(script, argv.slice(i + 2))) return true;
  }
  return false;
}

/**
 * True when argv would run a denied `gh auth` subcommand — including absolute
 * paths, `env`/`xargs`/… wrappers, shell `-c` scripts, find -exec carriers,
 * and script hosts that invoke shell/`gh` (`awk`/`osascript`/`git` config).
 *
 * Cite: REMEDIATION_PLAN.md Priority 1
 * Cite: docs/research/xargs-sticky-uninstall-delete-cites-2026-08-08.md
 * Cite: docs/research/i18-shell-obfuscation-cites-2026-08-08.md
 */
export function isDangerousGhArgv(argv: string[]): boolean {
  if (!argv.length) return false;

  // Anywhere: literal gh auth <dangerous> (find -exec, watch, …)
  if (argvHasGhAuthDangerSubsequence(argv)) return true;

  // Fail-closed for xargs: utility gh|shell (stdin / -I{} invisible at deny time).
  if (xargsArgvHasDangerousGh(argv)) return true;

  // find -exec / -execdir utility argv
  if (findExecArgvDangerous(argv)) return true;

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

  if (
    (base === "pwsh" || base === "powershell") &&
    pwshArgvHidesScript(rest)
  ) {
    return true;
  }

  if (SHELL_BASENAMES.has(base)) {
    if (shellArgvHasDangerousGhAuth(rest)) return true;
  }

  if (base === "git" && gitArgvHasDangerousGhAuth(rest)) return true;

  if (AWK_BASENAMES.has(base) || base === "osascript") {
    for (const snippet of inlineScriptSnippets(base, rest)) {
      if (shellScriptHasDangerousGhAuth(snippet)) return true;
    }
  }

  return false;
}
