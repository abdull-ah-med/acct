# Product invariants — `acct`

## Core invariant

**One GitHub account + one git identity + one directory tree.** Local supersedes global. Outside a bound directory, that account/identity does not exist for `acct`-managed operations. When constraints are not satisfied and enforcement is on, block the operation.

## Resolution order (must hold)

Security planes (credential helper, pre-commit, pre-push) resolve in this order only:

1. CLI `--profile` (explicit, process-local — `acct exec` / `acct status` / `acct clone`)
2. Resolve Git context with `git rev-parse`. In a worktree, walk for the nearest `.acct` from its root upward; a marker below that root is ignored and reported. Outside Git, walk from cwd. Empty markers explicitly unbind. Unknown profile ids fail closed.
3. Longest canonical directory binding at that anchor, unless the worktree and gitdir select different profiles without an explicit marker; that is a conflict.
4. Unbound

Ambient `ACCT_PROFILE` in the environment is **not** a security-plane override. The shell hook may still *export* `ACCT_PROFILE` as a status hint after resolving from cwd; that export must not rebind git HTTPS or hooks away from the directory. Directory / `.acct` always win for git auth.

`acct exec --profile X` injects `GH_TOKEN` for the **gh** plane only. Git HTTPS credentials continue to follow cwd binding / `.acct` ([cli#2771](https://github.com/cli/cli/issues/2771): `GH_TOKEN` does not authenticate git). When `--profile` differs from the cwd binding, `--allow-cross-profile` is required (explicit opt-in for the dual-plane footgun).

## Acceptance criteria (testable)

| ID | Criterion |
|----|-----------|
| I1 | Bound directory resolves to exactly one profile |
| I2 | Longer path prefix wins over shorter overlapping prefix |
| I3 | The nearest `.acct` from the Git worktree root upward (cwd outside Git) overrides bindings. Subroot markers are ignored and reported. Empty markers explicitly unbind; unknown ids fail closed. `acct local set/clear` uses the root and keeps Git includes in agreement. |
| I4 | Explicit CLI `--profile` selects a profile for status/exec (gh plane). Ambient `ACCT_PROFILE` must not change credential helper or hook resolution. Cross-tree `exec --profile` requires `--allow-cross-profile`. Credential helper `get` always returns the **cwd profile** `githubUser` + token (ignores a differing requested `username` — directory isolation wins; [gitcredentials](https://git-scm.com/docs/gitcredentials) allows helpers to set username) |
| I5 | Unbound directories inherit no acct profile identity. Canonical binding paths, including symlinks, emit includeIf entries from shortest to longest so the most specific identity wins. |
| I6 | Strict managed-host HTTPS failures, including corrupt config or secret storage, emit `quit=1` before exit, with no password or later-helper fallback. Unmanaged hosts receive empty success. |
| I7 | Credential helper never returns a token when `host` is empty, unsafe, conflicting (duplicate/disagreeing `host`/`protocol`/`url`), or not allowlisted. Hostname-only profiles accept bare host or `:443` only. A profile `host` of `hostname:443` is equivalent to hostname-only (git omits the default port in `host=`). Non-default pinned ports still exact-match ([git-credential](https://git-scm.com/docs/git-credential) host includes port only when specified) |
| I8 | Global managed includes and per-profile includes reset helpers only for managed HTTPS hosts (plus gist.github.com for github.com), then add acct. The effective chain must be exactly acct. A `credential.https://<host>.helper` section before the managed block is harmless; a section appended after it overrides acct and is reported by doctor. Running `gh auth setup-git` after acct can append such a section; `acct install` re-appends the managed block. |
| I8b | SSH profiles retain the host-scoped HTTPS reset and acct helper. SSH configuration is additive; `ssh-test` verifies the login whenever sshKeyPath is set. |
| I9 | A bound SSH key sets `core.sshCommand` with `-i` and `IdentitiesOnly=yes`, never HostName. IdentitiesOnly stops agent keys; keys configured for that host in ~/.ssh/config are still offered — acct verifies the authenticated account on push. |
| I10 | `acct exec` / shell hook injects profile token without calling `gh auth switch` |
| I11 | Strict pre-commit and pre-merge-commit compare effective author and committer names/emails (`git var`), including env overrides. Names are exact; emails ignore case. Author-preserving operations check the committer. Pre-commit cannot inspect the final recorded object; `git commit --author=…` changes invisible to that check are caught at pre-push. Post-commit only chains existing hooks. Commits in repositories that are never pushed are not re-checked. |
| I11b | Installed hooks, credential shim, and generated shell/wrap shims invoke acct via absolute `node` (`process.execPath`) + `acct.js` / helper js (no bare `acct` / PATH `node`). Override only via `ACCT_NODE_PATH` |
| I12 | Strict pre-push checks every outgoing recorded identity and verifies the actual managed transport: HTTPS uses the profile token and gh API; SSH resolves the alias and verifies the greeting with the effective SSH command. Unverifiable or mismatched auth blocks; local transports skip auth only. Logins ignore case. |
| I13 | Tokens never enter config.yaml or generated identity files; the explicit file backend uses secrets.json mode 0600. `ACCT_DEBUG` never prints token material |
| I14 | Install sets global hooksPath by default, with --repo for a local override. Every client hook chains to the previous hooksPath or repository hooks. The v3 shims bake the previous hooksPath at install; --repo uses a directory keyed by the canonical common Git directory. Uninstall restores the recorded previous values only for acct-owned v2/v3 shims and removes per-repository shim directories and the managed include block; it preserves unrelated config and OS secrets. |
| I15 | Client hooks are advisory — `--no-verify` / alternate `core.hooksPath` can bypass; doctor warns |
| I16 | Credential helper `get` returns tokens only for `protocol=https`; `http` and other protocols get `quit=1` with no password ([gitcredentials](https://git-scm.com/docs/gitcredentials) protocol-exact contexts) |
| I17 | Helper store is ignored; erase requires the matching stored token. Live follow-gh tokens can be returned without network or token-value persistence. Persisting a gh token requires both allowNetwork and persist and a matching verified login. Network verification failure returns the live token without storing it; mismatch keeps the stored token with a warning. Normal token writes validate whitespace/NUL and never produce .bak files. One-time plaintext-to-keychain migration is allowed in every process, including helper, offline doctor and shell-env: it moves existing secrets and deletes plaintext copies, never changes a token value and never persists a gh token. Offline doctor performs no network calls or token-value persistence; migration of existing secrets is allowed. |
| I18 | `acct exec` refuses `gh auth` subcommands that mutate global auth or dump tokens: `login`, `logout`, `refresh`, `token`, `switch`, `setup-git` — including absolute `gh` paths, `env`/`nice`/… wrappers, **`xargs` whose effective utility is `gh` or a shell** (stdin append / `-I{}` replacement are invisible at deny time — fail-closed; use `acct exec gh …` directly), shell `-c` scripts that invoke those subcommands (literal, quoted words, `$var`/`$(…)` expansions including **glued argv0** `$a$b auth token` / sole-command `$x$y` reconstruction, empty-quote and empty-`$IFS` gluing, POSIX `printf` escape → `xargs` reconstruction, and decoder\|shell / `eval`+decoder nested execution), **positional `$1`/`$@` with dangerous trailing args**, **ANSI-C `$'\xNN'` / octal escapes**, **brace expansion `{gh,auth,token}`**, **shell `alias g=gh` reconstruction**, **`printf`/`echo -e` piped to a shell**, PowerShell/`cmd`/`ash`/`mksh`/`busybox` (including **`pwsh -EncodedCommand`/`-enc`/`-e`/`-ec`, `-File`/`-f`, `-CommandWithArgs`, and `-Command -`** — script body not in argv; [about_Pwsh](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh)), carriers such as `find -exec`, and git carriers (`-c core.pager/editor/sshCommand=…`, `-c include.path=…`). `GIT_CONFIG_COUNT`/`KEY`/`VALUE` env overrides are stripped from `acct exec` **and** `acct clone` children. Sticky `GH_TOKEN` alone is not sufficient — children can unset it |
| I19 | Profile ids are unique under ASCII case-folding — `work` and `WORK` cannot both exist (case-insensitive filesystems would overwrite `git/<id>.inc`; [git-config `gitdir/i` / `core.ignoreCase`](https://git-scm.com/docs/git-config)) |
| I20 | Profile ids must not be Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9`) — they break NTFS include/SSH filenames |
| I21 | Config directory and acct-owned children must be mode `0700` (files with secrets `0600`); `ensureAcctDir` chmods existing dirs, not only newly created ones |
| I22 | No acct-managed gh plane leaves gh on its global account in a bound strict tree: missing tokens export a blocking sentinel; exec refuses to launch gh. Unknown explicit profiles and strict worktree conflicts refuse execution. Raw gh requires the shell hook or generated wrapper. |
| I23 | The resolver and effective Git identity agree, or acct reports a conflict and refuses strict operations. Worktree root, gitdir, common dir, explicit GIT_DIR/GIT_WORK_TREE, symlinks and local includes use the same Git context. |

## Enforcement modes

- `strict` — block (default for bound dirs; also default `defaultEnforce` for unbound when installed)
- `warn` — print warning, continue
- `off` — no enforcement; unbound helper returns no password and does not `quit` (allows prompt / other helpers if any remain)

## Recorded-author limitation

A commit object does not encode whether cherry-pick, rebase, merge, or amend preserved its author. Acct uses current operation state and local reflog evidence. Imported histories without that evidence can be refused in strict mode; client hooks cannot provide server-side provenance.
