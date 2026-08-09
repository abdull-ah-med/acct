# Research cites — I18 shell bypass round 2 (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| `gh auth token` prints the authentication token to stdout | https://cli.github.com/manual/gh_auth_token |
| `GH_TOKEN` / `GITHUB_TOKEN` override stored gh credentials | https://cli.github.com/manual/gh_help_environment |
| `xargs` reads blank/newline-delimited stdin items and appends them as argv to `utility`; `-n max-args` limits args per invocation | https://man7.org/linux/man-pages/man1/xargs.1.html ; https://ss64.com/mac/xargs.html |
| POSIX `printf` format escapes include `\n`, `\t`, `\r`, `\v`, `\f`, `\\`, and octal `\ddd` — so `printf 'auth\ntoken\n'` emits newlines that `xargs` treats as item separators | https://pubs.opengroup.org/onlinepubs/9699919799/utilities/printf.html ; macOS `man 1 printf` |
| Bash: if `IFS` is null, no word splitting occurs; unquoted empty expansions are removed — so `IFS=; gh$IFS auth$IFS token` becomes `gh auth token` | `man bash` § Word Splitting / § IFS (local verification 2026-08-08) |
| Prior I18 detector missed: concatenated expansions (`$a$b`), expansion-as-dangerous-subcommand (`$(echo token)`), `$IFS` gluing, `printf '…\n…'` literal-backslash forms before xargs, and `base64 \| sh` nested shells | live extreme/extra probes 2026-08-08 (live dual-account probes) |
| Product I18 / T13: refuse mutating/dumping `gh auth` under `acct exec`, including shell `-c` obfuscation | `docs/invariants.md` I18; `docs/threat-model.md` T13 |
| Profile ids become include filenames (`git/<id>.inc`) and SSH key path suffixes — must be filesystem-safe | `src/identity/includeIf.ts`; `src/ssh/keys.ts` |
| Non-goal unchanged: arbitrary interpreters (`node -e`, `python3 -c`) that spawn `gh` or echo injected `GH_TOKEN` | [local-acct-exec-deny-cites-2026-08-08.md](./local-acct-exec-deny-cites-2026-08-08.md); [i18-shell-obfuscation-cites-2026-08-08.md](./i18-shell-obfuscation-cites-2026-08-08.md) |

## Design chosen

1. **Normalize harder before deny matching**
   - Keep empty-quote stripping (`refres""h`)
   - Map common C/POSIX escapes (`\n`, `\t`, `\r`, `\v`, `\f`, `\0`, octal `\ddd`) to whitespace so `printf 'auth\ntoken\n' \| xargs` exposes `\btoken\b`
   - Strip `$IFS` / `${IFS}` / quoted forms so empty-IFS gluing collapses to `gh auth token`
2. **Additional fail-closed shell patterns**
   - Expansion as dangerous subcommand: `gh auth $(echo token)` / `gh auth $a$b` (one or more glued expansions)
   - `xargs` + `gh` + `auth` + dangerous word anywhere in the normalized script → deny (drop brittle secondary order regexes that false-negatived)
   - Decoder (`base64` / `base32` / `xxd` / `uudecode` / `openssl`) piped to a shell, or `eval` + decoder → deny (nested-shell reconstruction)
3. **Profile id allowlist** — `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` on `init` / `profile add` (rejects `$()`, backticks, newlines, path segments)
4. **Non-goal** — still not a full shell parser or interpreter sandbox
