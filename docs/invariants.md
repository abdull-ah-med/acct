# Product invariants — `acct`

## Core invariant

**One GitHub account + one git identity + one directory tree.** Local supersedes global. Outside a bound directory, that account/identity does not exist for `acct`-managed operations. When constraints are not satisfied and enforcement is on, block the operation.

## Resolution order (must hold)

1. `ACCT_PROFILE` environment variable (explicit)
2. Repo-local `.acct` file (profile name only; never secrets)
3. Longest matching directory binding for git toplevel (or cwd if not a repo)
4. Unbound

Local always wins over global bindings.

## Acceptance criteria (testable)

| ID | Criterion |
|----|-----------|
| I1 | Bound directory resolves to exactly one profile |
| I2 | Longer path prefix wins over shorter overlapping prefix |
| I3 | Repo `.acct` overrides global binding for that repo |
| I4 | `ACCT_PROFILE` overrides `.acct` and bindings |
| I5 | Unbound directory does not inherit another profile’s identity from acct-managed includes |
| I6 | In `strict`, HTTPS `get` for wrong/missing profile returns no password and `quit=true` |
| I7 | Credential helper never returns a token when `host` is empty or not allowlisted |
| I8 | Under a bound HTTPS profile, competing helpers are cleared (`helper = ""` then `acct`) |
| I9 | Bound SSH profile sets `IdentitiesOnly=yes` via `core.sshCommand` |
| I10 | `acct exec` / shell hook injects profile token without calling `gh auth switch` |
| I11 | In `strict`, `pre-commit` blocks when `user.email` ≠ profile email |
| I12 | In `strict`, `pre-push` blocks when authenticated principal ≠ profile github user |
| I13 | Tokens are never written to config files under `~/.config/acct` |
| I14 | `acct uninstall` restores gitconfig backup taken at install |

## Enforcement modes

- `strict` — block (default for bound dirs)
- `warn` — print warning, continue
- `off` — no enforcement hooks behavior
