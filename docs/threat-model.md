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
| T5 | Stale `GH_TOKEN` / sticky `ACCT_PROFILE` in parent shell | Overrides intended profile | Shell hook rebinds from cwd (ignores sticky env); clears tokens when unbound. Ambient `ACCT_PROFILE` is **not** trusted by credential helper or hooks |
| T6 | Multiple credential helpers; later helper wins wrongly | Wrong or leaked creds | Reset helper list; `quit=true` on strict failure |
| T7 | Blank/malicious host to helper (CVE-2020-11008 class) | Token exfil | Host allowlist; reject empty host |
| T8 | Token written to plaintext config / committed `.envrc` | Secret leak | Keychain only; doctor warnings |
| T9 | User forgets to switch; commits as wrong identity | Silent wrong author | pre-commit strict (absolute hook path) |
| T10 | Auth succeeds as A, commits authored as B | Attribution mismatch | pre-push checks against **cwd** profile (not ambient env) |

## Non-goals (out of scope for threat model v1)

- Compromised OS user account (already has keychain access)
- Malicious `acct` binary supply chain (mitigate via npm provenance at publish)
- Full IDE credential store takeover
- Ambient `ACCT_PROFILE=… git push` as a supported override (explicitly rejected; use `cd` or `.acct`)
