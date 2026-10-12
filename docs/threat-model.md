# Threat model — `acct`

## Assets

- GitHub OAuth / PAT tokens
- SSH private keys (paths referenced; keys stay in filesystem/keychain)
- Mapping of directories → accounts (privacy-sensitive, not secret)

## Adversaries / failure modes

| ID | Scenario | Impact | Closing plane |
|----|----------|--------|---------------|
| T1 | HTTPS host-only credential reuse across repos | Wrong-account push | Host-scoped global/per-profile resets; strict managed failures quit before any later helper; unrelated hosts retain their helpers |
| T2 | gh global active account used in a bound strict directory | Wrong API / PR actor | Canonical GH_HOST and host-appropriate token or blocking sentinel; unknown profiles/conflicts refuse exec; real gh discovery excludes the wrapper |
| T3 | SSH agent or configured host keys authenticate the wrong user | Wrong-account SSH auth | IdentitiesOnly limits agent keys but configured host keys still apply. Verify ssh -G hostname and authenticated greeting with the effective SSH command before push |
| T4 | Global `user.email` used in work repo | Misattributed commits | includeIf identity |
| T5 | Stale token/profile environment or shell refresh failure | Wrong account after changing directory | Clear all managed token/host/profile vars on failure or unbound; never cache failure; acct_refresh forces refresh. Bash prompt hooks run after commands chained to cd; exec/wrapper provides immediate resolution |
| T6 | Later credential helper or corrupt acct storage | Wrong or leaked credentials | Effective host-specific helper-chain diagnostics; strict helper emits quit=1 even on exceptions, never raw child error/token text |
| T7 | Blank/malicious host to helper (CVE-2020-11008 class) | Token exfil | Host allowlist; reject empty/unsafe host; reject conflicting duplicate `host`/`url` |
| T7b | Non-default port on allowlisted hostname (`github.com:8443`) | Token exfil to attacker listener | Hostname-only profiles: bare host or `:443` only; pinned `profile.host` port requires exact match |
| T7c | Empty/blank `.acct` under a bound tree | Silent parent-binding inheritance | Present `.acct` with empty profile → local unbound (I3); nearest `.acct` discovered from Git root upward (cwd outside Git); subroot markers ignored and reported |
| T8 | Token written to plaintext config / committed `.envrc` | Secret leak | Keychain by default; explicit file backend mode 0600, no backup copies; doctor warnings |
| T9 | User forgets to switch; commits as wrong identity | Silent wrong author | pre-commit strict (absolute hook path) |
| T10 | Auth matches but recorded author/committer differs | Attribution mismatch | Effective pre-commit/pre-merge identity, post-commit object inspection and outgoing-commit pre-push checks; author-preserving operations use local operation/reflog evidence |
| T11 | `git credential approve` overwrites profile token with another account’s token | Cross-account HTTPS identity swap | Helper `store` ignored (read-only); tokens via `acct profile token` only ([gitcredentials](https://git-scm.com/docs/gitcredentials)) |
| T12 | Helper returns HTTPS token for `protocol=http` | Cleartext / wrong-context credential use | HTTPS-only `get` → `quit=1` |
| T13 | `acct exec gh auth token\|login\|…` dumps or mutates global auth | Token leak / global gh state change | Deny-list for mutating/dumping `gh auth` subcommands (basename + wrappers; **`xargs` → `gh`\|shell fail-closed**; shell `-c` including glued `$a$b` argv0 / sole-command `$x$y` / `$IFS`/printf-escape/`xargs` stdin/decoder\|shell; **positional `$1`/`$@`**, **ANSI-C `$'\xNN'`**, **brace `{gh,auth,token}`**, **`alias g=gh`**, **`printf`/`echo -e`\|shell**, **`find -exec`**, pwsh/cmd/ash/mksh; **`awk`/`osascript`/`git -c alias.*=!` script hosts**; **`git -c core.pager/editor/sshCommand` / `include.path`**; strip **`GIT_CONFIG_*`** from exec env). Sticky `GH_TOKEN` complements but does not replace the deny-list ([gh environment](https://cli.github.com/manual/gh_help_environment); [xargs(1)](https://man7.org/linux/man-pages/man1/xargs.1.html); [git-config alias](https://git-scm.com/docs/git-config)) |
| T14 | After `acct uninstall`, OS helpers still answer for github.com | Wrong-account HTTPS without acct mediation | Uninstall warns + `git credential reject` guidance; doctor `not-installed` / `acct-helper-missing` ([gitcredentials](https://git-scm.com/docs/gitcredentials)) |
| T15 | Profile id with shell metacharacters / path segments / case-fold twin | Unsafe include/SSH filenames; YAML/shell injection; silent `git/<id>.inc` overwrite on macOS/Windows | Allowlist `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` + case-fold uniqueness on `init` / `profile add`; doctor errors on existing collisions ([git-config](https://git-scm.com/docs/git-config) `gitdir/i` / `core.ignoreCase`) |
| T16 | Concurrent config/secret edits or partial install failure | Lost updates, clobbered unrelated config, inconsistent generated files | Owner/nonce locks with dead-pid recovery for valid owners, recovery of invalid owner records only after 60 seconds and a re-check under the recovery lock, and sleeping waits; config lock spans read/validate/write/reconcile; transactions restore bytes on failure; Git-compatible target.lock preserves symlinks/mode |

## Non-goals (out of scope for threat model v1)

- Compromised OS user account (already has keychain access)
- Malicious `acct` binary supply chain (mitigate via npm provenance at publish)
- Full IDE credential store takeover
- Ambient `ACCT_PROFILE=… git push` as a supported override (explicitly rejected; use `cd` or `.acct`)
- Full sandboxing of `acct exec` for `node -e` / `python3 -c` that print injected `GH_TOKEN` (documented I18 non-goal)

Release builds use read-only repository permissions. Publication downloads the built tarballs, runs no package scripts, and uses a protected environment. Repository reviewers and registry trusted-publisher configuration must also be configured externally. Actions use the reviewed pins; download-artifact retains the explicit reviewer TODO.
