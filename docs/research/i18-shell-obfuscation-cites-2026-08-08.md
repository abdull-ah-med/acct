# Research cites — I18 shell obfuscation + sticky-token unset (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| `GH_TOKEN` / `GITHUB_TOKEN` take precedence over stored gh credentials for API calls | https://cli.github.com/manual/gh_help_environment |
| With env token set, `gh auth login` / `logout` / `refresh` / `switch` refuse to mutate stored credentials until the env token is cleared | https://github.com/cli/cli/issues/2922 ; https://github.com/cli/cli/discussions/9647 ; https://cli.github.com/manual/gh_auth_refresh |
| `gh auth token` prints the authentication token to stdout | https://cli.github.com/manual/gh_auth_token |
| `gh auth switch` changes the active account for a host (global gh config) | https://cli.github.com/manual/gh_auth_switch |
| `gh auth login` / `logout` / `refresh` / `setup-git` mutate global auth / git helper state | https://cli.github.com/manual/gh_auth_login ; …/gh_auth_logout ; …/gh_auth_setup-git |
| `xargs` builds argv from stdin whitespace-separated items; `echo auth token \| xargs gh` → `gh auth token` | https://man7.org/linux/man-pages/man1/xargs.1.html |
| Prior I18 shell detector only regex-matched literal `gh auth <dangerous>` in `-c` scripts | [local-acct-exec-deny-cites-2026-08-08.md](./local-acct-exec-deny-cites-2026-08-08.md); live extreme/adversarial probes 2026-08-08 |
| Live bypasses (live dual-account probes): `"gh" "auth" "token"`; `$g auth token`; `gh $x switch`; `$(command -v gh) auth token`; `echo auth token \| xargs gh`; `unset GH_TOKEN; x=auth; gh $x switch` (mutated active account) | live probe 2026-08-08 |
| Product I18 / T13: refuse mutating/dumping `gh auth` under `acct exec`, including shell `-c` | `docs/invariants.md` I18; `docs/threat-model.md` T13 |
| Non-goal unchanged: arbitrary interpreters (`node -e`, …) that echo injected `GH_TOKEN` | [local-acct-exec-deny-cites-2026-08-08.md](./local-acct-exec-deny-cites-2026-08-08.md) |
| Follow-up bypasses (concat expansions, `$IFS`, printf escapes, decoder\|shell) | [i18-shell-bypass-round2-cites-2026-08-08.md](./i18-shell-bypass-round2-cites-2026-08-08.md) |

## Design chosen

1. **Normalize** shell `-c` scripts before matching: strip empty quote concatenations (`refres""h` → `refresh`) so glued identifiers cannot dodge the deny-list.
2. **Fail-closed shell patterns** (in addition to literal `gh auth <dangerous>`):
   - Quoted words: `"gh" "auth" "token"`
   - Expansion as command: `$g auth token`, `$(command -v gh) auth token`, `` `which gh` auth token ``
   - Expansion as `auth` subcommand: `gh $x switch`
   - `xargs` reconstruction: `… auth token \| xargs gh` / `xargs` … `gh` with `auth` + dangerous subcommand words present
3. **Sticky `GH_TOKEN` is complementary, not sufficient** — children can `unset` / `env -u` the token ([gh environment](https://cli.github.com/manual/gh_help_environment); cli discussions above). Deny-list must catch obfuscated `gh auth` even after unset; do not rely on env alone for I18.
4. **Non-goal** — full shell parsers / sandboxing; interpreters other than shells listed in I18 remain out of scope.
