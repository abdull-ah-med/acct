# Research cites — profile id case collision + I18 round 3 (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| `includeIf` `gitdir/i` matches case-insensitively “e.g. on case-insensitive file systems” | https://git-scm.com/docs/git-config (Conditional includes / `gitdir/i`) |
| Git `core.ignoreCase` documents APFS, HFS+, FAT, NTFS as case-insensitive | https://git-scm.com/docs/git-config (`core.ignoreCase`) |
| Profile ids become include filenames (`git/<id>.inc`) and SSH key path suffixes | `src/identity/includeIf.ts`; `src/ssh/keys.ts`; [i18-shell-bypass-round2-cites-2026-08-08.md](./i18-shell-bypass-round2-cites-2026-08-08.md) |
| Live: `profile add --id WORK` alongside `work` overwrote `work.inc` on macOS; identity became attacker-controlled while binding/token stayed `work` | live extra break 2026-08-08 |
| `gh auth token` prints the authentication token to stdout | https://cli.github.com/manual/gh_auth_token |
| `GH_TOKEN` / `GITHUB_TOKEN` override stored gh credentials | https://cli.github.com/manual/gh_help_environment |
| Bash: adjacent expansions concatenate before word splitting — `$a$b` with `a=g` `b=h` yields word `gh` | `man bash` § Word Splitting / parameter expansion (local 2026-08-08) |
| Prior I18 argv0 pattern used one `SHELL_EXP` only — missed glued `$a$b auth token` and sole-command `$x$y` reconstruction | [i18-shell-bypass-round2-cites-2026-08-08.md](./i18-shell-bypass-round2-cites-2026-08-08.md); live verify 2026-08-08 |
| Git `alias.*` values starting with `!` are shell commands | https://git-scm.com/docs/git-config (`alias.*`); `git help config` |
| awk `system(cmd)` executes a shell command | `man awk` (local 2026-08-08) |
| `osascript -e` executes OSA/AppleScript statements (incl. `do shell script`) | `man osascript` (local 2026-08-08) |
| Product I18 / T13: refuse mutating/dumping `gh auth` under `acct exec` | `docs/invariants.md` I18; `docs/threat-model.md` T13 |
| Non-goal unchanged: interpreters that only echo injected `GH_TOKEN` (`node -e`, `python3 -c`, …) | [local-acct-exec-deny-cites-2026-08-08.md](./local-acct-exec-deny-cites-2026-08-08.md) |

## Design chosen

1. **Profile id case-fold uniqueness** — Allowlist stays `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`. On `init` / `profile add`, reject an id that case-folds (ASCII lower) to the same key as a different existing id. Prevents `work` + `WORK` from writing the same `work.inc` on APFS/NTFS. Doctor warns if a config already contains case-fold duplicates.
2. **I18 shell glued argv0** — Use `SHELL_EXP_GLUE` (one or more expansions) for the argv0 triple pattern so `$a$b auth token` matches. Fail-closed: if `auth` + dangerous word + `gh` fragment are present and a command token is only glued expansions (`$x$y`), refuse (`x=gh; y=' auth token'; $x$y`).
3. **I18 script hosts (not env-echo interpreters)** — After wrapper strip, scan:
   - `awk` / `gawk` / `mawk` program text / args for dangerous `gh auth`
   - `osascript` `-e` statements for the same
   - `git` `-c` / `--config` values that are `alias.*=!…` shell aliases whose body matches dangerous `gh auth`
4. **Non-goal** — Still not a full sandbox; `perl`/`node`/`python`/`ruby` that only print `GH_TOKEN` remain out of scope.
