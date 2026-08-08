# Product invariants — `acct`

## Core invariant

**One GitHub account + one git identity + one directory tree.** Local supersedes global. Outside a bound directory, that account/identity does not exist for `acct`-managed operations. When constraints are not satisfied and enforcement is on, block the operation.

## Resolution order (must hold)

Security planes (credential helper, pre-commit, pre-push) resolve in this order only:

1. CLI `--profile` (explicit, process-local — `acct exec` / `acct status` / `acct clone`)
2. Repo-local `.acct` file (profile name only; never secrets)
3. Longest matching directory binding for `cwd` (repo-local `.acct` is discovered via git toplevel)
4. Unbound

Ambient `ACCT_PROFILE` in the environment is **not** a security-plane override. The shell hook may still *export* `ACCT_PROFILE` as a status hint after resolving from cwd; that export must not rebind git HTTPS or hooks away from the directory. Directory / `.acct` always win for git auth.

`acct exec --profile X` injects `GH_TOKEN` for the **gh** plane only. Git HTTPS credentials continue to follow cwd binding / `.acct` ([cli#2771](https://github.com/cli/cli/issues/2771): `GH_TOKEN` does not authenticate git).

## Acceptance criteria (testable)

| ID | Criterion |
|----|-----------|
| I1 | Bound directory resolves to exactly one profile |
| I2 | Longer path prefix wins over shorter overlapping prefix |
| I3 | Repo `.acct` overrides global binding for that repo |
| I4 | Explicit CLI `--profile` selects a profile for status/exec (gh plane). Ambient `ACCT_PROFILE` must not change credential helper or hook resolution |
| I5 | Unbound directory does not inherit another profile’s identity from acct-managed includes |
| I6 | In `strict`, HTTPS `get` for wrong/missing/unbound profile returns no password and `quit=true` (no fallthrough to other helpers) — [gitcredentials](https://git-scm.com/docs/gitcredentials) |
| I7 | Credential helper never returns a token when `host` is empty or not allowlisted |
| I8 | Under a bound profile, competing helpers are cleared (`helper = ""` then `acct`) — globally in the managed block and per-profile include |
| I8b | Profiles with `sshKeyPath` still emit HTTPS helper reset + acct helper; `core.sshCommand` + `IdentitiesOnly=yes` are additive |
| I9 | Bound SSH key sets `IdentitiesOnly=yes` via `core.sshCommand` |
| I10 | `acct exec` / shell hook injects profile token without calling `gh auth switch` |
| I11 | In `strict`, `pre-commit` blocks when `user.email` ≠ profile email |
| I11b | Installed hooks invoke acct via absolute `node` + `acct.js` paths (no bare `acct` / PATH dependency) |
| I12 | In `strict`, `pre-push` blocks when authenticated principal ≠ profile github user |
| I13 | Tokens are never written to config files under `~/.config/acct` |
| I14 | `acct uninstall` restores gitconfig backup taken at install (or strips the managed block) |

## Enforcement modes

- `strict` — block (default for bound dirs; also default `defaultEnforce` for unbound when installed)
- `warn` — print warning, continue
- `off` — no enforcement; unbound helper returns no password and does not `quit` (allows prompt / other helpers if any remain)
