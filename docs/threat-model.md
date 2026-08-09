# Threat model — `acct`

## Assets

- GitHub OAuth / PAT tokens
- SSH private keys (paths referenced; keys stay in filesystem/keychain)
- Mapping of directories → accounts (privacy-sensitive, not secret)

## Adversaries / failure modes

| ID | Scenario | Impact | Closing plane |
|----|----------|--------|---------------|
| T1 | HTTPS host-only credential reuse across repos | Wrong-account push | Global + per-profile `helper=""` reset then acct; unbound `strict` → `quit=1` ([gitcredentials](https://git-scm.com/docs/gitcredentials)) |
| T2 | `gh` global active account used in wrong dir | Wrong API / PR actor | `GH_TOKEN` injection (hook / exec) — [gh environment](https://cli.github.com/manual/gh_help_environment) |
| T3 | SSH agent offers all keys; GitHub accepts first | Wrong-account SSH auth | `core.sshCommand` + `IdentitiesOnly=yes` |
| T4 | Global `user.email` used in work repo | Misattributed commits | includeIf identity |
| T5 | Stale `GH_TOKEN` / sticky `ACCT_PROFILE` in parent shell | Overrides intended profile for raw `gh` | Shell hook rebinds from cwd (ignores sticky env); clears tokens when unbound. Doctor warns when ambient token principal ≠ cwd profile. Ambient `ACCT_PROFILE` is **not** trusted by credential helper or hooks |
| T6 | Multiple credential helpers; later helper wins wrongly | Wrong or leaked creds | Reset helper list; `quit=true` on strict failure |
| T7 | Blank/malicious host to helper (CVE-2020-11008 class) | Token exfil | Host allowlist; reject empty/unsafe host; reject conflicting duplicate `host`/`url` |
| T7b | Non-default port on allowlisted hostname (`github.com:8443`) | Token exfil to attacker listener | Hostname-only profiles: bare host or `:443` only; pinned `profile.host` port requires exact match |
| T7c | Empty/blank `.acct` under a bound tree | Silent parent-binding inheritance | Present `.acct` with empty profile → local unbound (I3); nearest `.acct` discovered by cwd walk-up (git optional) |
| T8 | Token written to plaintext config / committed `.envrc` | Secret leak | Keychain only; doctor warnings |
| T9 | User forgets to switch; commits as wrong identity | Silent wrong author | pre-commit strict (absolute hook path) |
| T10 | Auth succeeds as A, commits authored as B | Attribution mismatch | pre-push checks against **cwd** profile (not ambient env) |
| T11 | `git credential approve` overwrites profile token with another account’s token | Cross-account HTTPS identity swap | Helper `store` ignored (read-only); tokens via `acct profile token` only ([gitcredentials](https://git-scm.com/docs/gitcredentials)) |
| T12 | Helper returns HTTPS token for `protocol=http` | Cleartext / wrong-context credential use | HTTPS-only `get` → `quit=1` |
| T13 | `acct exec gh auth token\|login\|…` dumps or mutates global auth | Token leak / global gh state change | Deny-list for mutating/dumping `gh auth` subcommands (basename + wrappers; **`xargs` → `gh`\|shell fail-closed**; shell `-c` including glued `$a$b` argv0 / sole-command `$x$y` / `$IFS`/printf-escape/`xargs` stdin/decoder\|shell; **positional `$1`/`$@`**, **ANSI-C `$'\xNN'`**, **brace `{gh,auth,token}`**, **`alias g=gh`**, **`printf`/`echo -e`\|shell**, **`find -exec`**, pwsh/cmd/ash/mksh; **`awk`/`osascript`/`git -c alias.*=!` script hosts**; **`git -c core.pager/editor/sshCommand` / `include.path`**; strip **`GIT_CONFIG_*`** from exec env). Sticky `GH_TOKEN` complements but does not replace the deny-list ([gh environment](https://cli.github.com/manual/gh_help_environment); [xargs(1)](https://man7.org/linux/man-pages/man1/xargs.1.html); [git-config alias](https://git-scm.com/docs/git-config)) |
| T14 | After `acct uninstall`, OS helpers still answer for github.com | Wrong-account HTTPS without acct mediation | Uninstall warns + `git credential reject` guidance; doctor `not-installed` / `acct-helper-missing` ([gitcredentials](https://git-scm.com/docs/gitcredentials)) |
| T15 | Profile id with shell metacharacters / path segments / case-fold twin | Unsafe include/SSH filenames; YAML/shell injection; silent `git/<id>.inc` overwrite on macOS/Windows | Allowlist `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` + case-fold uniqueness on `init` / `profile add`; doctor errors on existing collisions ([git-config](https://git-scm.com/docs/git-config) `gitdir/i` / `core.ignoreCase`) |
| T16 | Concurrent `acct` processes race on `secrets.json` / managed `~/.gitconfig` | Silent token loss / clobber of unrelated gitconfig sections | Exclusive lockfiles + atomic write (tmp → fsync → rename); corrupt `secrets.json` throws (does not return `{}`) |

## Non-goals (out of scope for threat model v1)

- Compromised OS user account (already has keychain access)
- Malicious `acct` binary supply chain (mitigate via npm provenance at publish)
- Full IDE credential store takeover
- Ambient `ACCT_PROFILE=… git push` as a supported override (explicitly rejected; use `cd` or `.acct`)
- Full sandboxing of `acct exec` for `node -e` / `python3 -c` that print injected `GH_TOKEN` (documented I18 non-goal)
