# Product invariants — `acct`

## Core invariant

**One GitHub account + one git identity + one directory tree.** Local supersedes global. Outside a bound directory, that account/identity does not exist for `acct`-managed operations. When constraints are not satisfied and enforcement is on, block the operation.

## Resolution order (must hold)

Security planes (credential helper, pre-commit, pre-push) resolve in this order only:

1. CLI `--profile` (explicit, process-local — `acct exec` / `acct status` / `acct clone`)
2. Nearest `.acct` walking from `cwd` up to the filesystem root (profile name only; never secrets). Does **not** require a git repository — same discovery model as direnv `find_up`. Nested `pkg/.acct` wins over a parent `.acct`.
3. Longest matching directory binding for `cwd`
4. Unbound

Ambient `ACCT_PROFILE` in the environment is **not** a security-plane override. The shell hook may still *export* `ACCT_PROFILE` as a status hint after resolving from cwd; that export must not rebind git HTTPS or hooks away from the directory. Directory / `.acct` always win for git auth.

`acct exec --profile X` injects `GH_TOKEN` for the **gh** plane only. Git HTTPS credentials continue to follow cwd binding / `.acct` ([cli#2771](https://github.com/cli/cli/issues/2771): `GH_TOKEN` does not authenticate git). When `--profile` differs from the cwd binding, `--allow-cross-profile` is required (explicit opt-in for the dual-plane footgun).

## Acceptance criteria (testable)

| ID | Criterion |
|----|-----------|
| I1 | Bound directory resolves to exactly one profile |
| I2 | Longer path prefix wins over shorter overlapping prefix |
| I3 | Nearest `.acct` (cwd walk-up, git optional) overrides directory bindings. File present with empty/blank/missing `profile` → local unbound (does not fall through to parent binding). Unknown profile id → local unbound |
| I4 | Explicit CLI `--profile` selects a profile for status/exec (gh plane). Ambient `ACCT_PROFILE` must not change credential helper or hook resolution. Cross-tree `exec --profile` requires `--allow-cross-profile`. Credential helper `get` always returns the **cwd profile** `githubUser` + token (ignores a differing requested `username` — directory isolation wins; [gitcredentials](https://git-scm.com/docs/gitcredentials) allows helpers to set username) |
| I5 | Unbound directory does not inherit another profile’s identity from acct-managed includes |
| I6 | In `strict`, HTTPS `get` for wrong/missing/unbound profile returns no password and `quit=true` (no fallthrough to other helpers) — [gitcredentials](https://git-scm.com/docs/gitcredentials) |
| I7 | Credential helper never returns a token when `host` is empty, unsafe, conflicting (duplicate/disagreeing `host`/`protocol`/`url`), or not allowlisted. Hostname-only profiles accept bare host or `:443` only — non-default ports are rejected ([git-credential](https://git-scm.com/docs/git-credential) host may include port; acct does not treat arbitrary ports as the same context) |
| I8 | Under a bound profile, competing helpers are cleared (`helper = ""` then `acct`) — globally in the managed block and per-profile include |
| I8b | Profiles with `sshKeyPath` still emit HTTPS helper reset + acct helper; `core.sshCommand` + `IdentitiesOnly=yes` are additive. `acct ssh-test` works whenever `sshKeyPath` is set (protocol may remain https) |
| I9 | Bound SSH key sets `IdentitiesOnly=yes` via `core.sshCommand` |
| I10 | `acct exec` / shell hook injects profile token without calling `gh auth switch` |
| I11 | In `strict`, `pre-commit` blocks when `user.email` ≠ profile email |
| I11b | Installed hooks invoke acct via absolute `node` + `acct.js` paths (no bare `acct` / PATH dependency) |
| I12 | In `strict`, `pre-push` blocks when authenticated principal ≠ profile github user |
| I13 | Tokens are never written to config files under `~/.config/acct`; `ACCT_DEBUG` never prints token material |
| I14 | `acct uninstall` restores gitconfig backup taken at install (or strips the managed block). Prints residual-helper warnings; does not delete OS keychain entries ([gitcredentials](https://git-scm.com/docs/gitcredentials)) |
| I15 | Client hooks are advisory — `--no-verify` / alternate `core.hooksPath` can bypass; doctor warns |
| I16 | Credential helper `get` returns tokens only for `protocol=https`; `http` and other protocols get `quit=1` with no password ([gitcredentials](https://git-scm.com/docs/gitcredentials) protocol-exact contexts) |
| I17 | Credential helper is read-only for secrets: `store` is silently ignored; `erase` only when password matches the stored profile token. Token writes go through `acct profile token` only |
| I18 | `acct exec` refuses `gh auth` subcommands that mutate global auth or dump tokens: `login`, `logout`, `refresh`, `token`, `switch`, `setup-git` — including absolute `gh` paths, `env`/`nice`/… wrappers, **`xargs` whose effective utility is `gh` or a shell** (stdin append / `-I{}` replacement are invisible at deny time — fail-closed; use `acct exec gh …` directly), and shell `-c` scripts that invoke those subcommands (literal, quoted words, `$var`/`$(…)` expansions including concatenated/`gh auth $(…)` forms, empty-quote and empty-`$IFS` gluing, POSIX `printf` escape → `xargs` reconstruction, and decoder\|shell / `eval`+decoder nested execution). Sticky `GH_TOKEN` alone is not sufficient — children can unset it |

## Enforcement modes

- `strict` — block (default for bound dirs; also default `defaultEnforce` for unbound when installed)
- `warn` — print warning, continue
- `off` — no enforcement; unbound helper returns no password and does not `quit` (allows prompt / other helpers if any remain)
