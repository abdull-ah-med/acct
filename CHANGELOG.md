# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.10] - 2026-08-13

### Added

- `acct status` / `acct doctor` diagnose cwd problems: what's wrong, exact fix commands, and whether commit/push/raw `gh` will go through (and as whom). Missing profile token + mismatched `gh` principal in `strict` **blocks push** (helper quits; will not push as the other account). Commit still uses includeIf identity, not `gh`. `whoami` points at `acct status` on mismatch. Blocked pre-commit/pre-push hooks print the same diagnosis.

### Fixed

- Profile ids are **unique under ASCII case-folding** — `work` + `WORK` rejected (would overwrite the same `git/<id>.inc` on macOS/Windows); doctor errors on existing collisions ([git-config](https://git-scm.com/docs/git-config) `gitdir/i` / `core.ignoreCase`; [round-3 cites](docs/research/i18-profile-case-round3-cites-2026-08-08.md))
- `acct exec` I18 shell deny closes glued argv0 (`$a$b auth token`) and sole-command glued reconstruction (`x=gh; y=' auth token'; $x$y`) ([bash Word Splitting](https://www.gnu.org/software/bash/manual/html_node/Word-Splitting.html); [round-3 cites](docs/research/i18-profile-case-round3-cites-2026-08-08.md))
- `acct exec` I18 denies script hosts that run `gh auth`: `awk`/`gawk`/`mawk` program text, `osascript -e`, and `git -c alias.*=!…` shell aliases ([git-config alias](https://git-scm.com/docs/git-config); `man awk`; `man osascript`)

## [0.1.9] - 2026-08-11

### Changed

- Install docs standardize on `npm install -g acct-sh` (removed pnpm alternate from README)

## [0.1.8] - 2026-08-11

### Added

- `acct --help` descriptions for every command, including `bind` / `unbind` and profile subcommands
- `acct doctor` probes OS keyring availability (`@napi-rs/keyring`) and prints an ok/warn/error summary
- README documents platform keychain backends (macOS Keychain, Linux libsecret/KWallet, Windows Credential Manager) and what CI actually tests
- Website agent discovery: `/llms.txt`, `/llms-full.txt`, `/agents.md` plus richer SEO metadata (JSON-LD, Open Graph, robots AI crawlers)

### Fixed

- npm package includes `website.jpg` (README previously referenced `website.jpeg`, which was not packed)
- README links to threat model / invariants / AGENTS point at GitHub so they work on npmjs.com

## [0.1.7] - 2026-08-10

### Changed

- Welcome tip sheet is plain bold text (no ASCII art); shown on bare `acct` because npm ≥7 hides postinstall stdout

## [0.1.6] - 2026-08-10

### Added

- `postinstall` prints terminal art plus next steps (`acct --help`, `acct init`, shell hook); skip with `ACCT_SKIP_POSTINSTALL=1` or in CI

## [0.1.5] - 2026-08-08

### Security

- **I18** closes remaining `acct exec` deny-list bypasses: positional `$1`/`$@`, PowerShell/`cmd`, ANSI-C `$'\xNN'`, variable reconstruction, `printf`/`echo -e`|shell, brace expansion, shell aliases, `GIT_CONFIG_*` stripping, `git -c` pager/editor/sshCommand/include.path, `find -exec`, ash/mksh/busybox (T13)
- Hooks always bake `process.execPath` (never `which node`); override only via `ACCT_NODE_PATH`
- Profile `--name`/`--email`/`--host`/`--user` reject CR/LF/NUL/`\`/`"` and validate host/user shapes (gitconfig injection)
- Windows reserved device names rejected as profile ids (I20)
- Windows `.cmd` shims escape `%` / `"` in paths
- `acct exec` always uses `shell: false` (no cmd.exe metachar re-expansion)
- Credential helper `erase` uses constant-time password compare

### Fixed

- `FileSecretStore` atomic writes + lockfile; corrupt JSON throws (no silent `{}`) (T16)
- Windows `git.cmd` wrap shim skips its own directory (no infinite self-recursion)
- `installIncludeIf` uses lockfile + atomic rename on `~/.gitconfig` (T16)
- `configureHooksPath` refuses pre-existing non-acct `core.hooksPath` unless `--force`; honors `--bind` via `git -C`
- Credential parser normalizes default ports (`github.com:443` vs URL without port)
- CLI `--version` reads `package.json` (no hard-coded drift)
- Config dirs get `chmod 0700` even when already existing (I21)
- `profile remove` deletes `git/<id>.inc` and SSH key artifacts; uninstall cleans orphan `.inc` files
- `clone` uses `spawnSync` (clean exit, no Node stack on failure)
- Bash/PowerShell shell hooks are idempotent on re-source; bash `acct_chpwd` skips unchanged `$PWD`
- `sanitizeDebugMessage` covers `ghc_`, Bearer, `x-access-token:…@`, 40-char hex, spaced `token =`
- `ssh-test` uses bundled github.com `known_hosts` + `StrictHostKeyChecking=yes`
- Doctor: `--show-origin` helper chain; network principal check gated behind `--online`; config perms / orphan `.inc` / pre-push / shim / stale node path checks
- Repair `e2e-extra-break.mjs` / `e2e-adversarial-probe.mjs` template-literal bugs

### Changed

- Invariants: I18 expanded bypass classes; **I20** / **I21** added
- Threat model: T13 expanded; **T16** concurrent process safety
- Package includes `data/github_known_hosts` for ssh-test pinning

## [0.1.4] - 2026-08-08

### Fixed

- `acct exec` I18 **fail-closed for `xargs` → `gh` or a shell**: stdin append (`printf 'auth\ntoken\n' \| acct exec xargs gh`) and `-I{}` substitution (`xargs -I{} sh -c 'unset GH_TOKEN; gh auth {} …'`) can mutate global auth / dump tokens without those words appearing in argv — refuse those utilities under xargs; use `acct exec gh …` directly ([xargs(1)](https://man7.org/linux/man-pages/man1/xargs.1.html); [gh environment](https://cli.github.com/manual/gh_help_environment); [i18-xargs-stdin-bypass cites](docs/research/i18-xargs-stdin-bypass-cites-2026-08-08.md))
- Doctor warns when `defaultEnforce=off` or cwd is unbound with `enforce=off` (helper empty without quit → OS keychain fallthrough; I6/T1; [gitcredentials](https://git-scm.com/docs/gitcredentials))
- Credential helper documents/logs that a differing requested `username` is ignored in favor of the cwd profile principal (I4 isolation; [gitcredentials](https://git-scm.com/docs/gitcredentials))
- `acct exec` I18 shell `-c` deny-list closes live bypasses: concatenated expansions (`$a$b`), expansion-as-subcommand (`gh auth $(echo token)`), empty-`$IFS` gluing, POSIX `printf` `\n` escapes before `xargs -n2 gh`, and `base64\|sh` / `eval`+decoder nested shells ([printf](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/printf.html); [xargs(1)](https://man7.org/linux/man-pages/man1/xargs.1.html); [i18-shell-bypass-round2 cites](docs/research/i18-shell-bypass-round2-cites-2026-08-08.md))
- Profile ids are allowlisted (`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`) on `init` / `profile add` — rejects `$()`, backticks, newlines, and path segments (include/SSH filename safety)
- `acct exec` I18 shell `-c` deny-list catches quoted words (`"gh" "auth" "token"`), `$var`/`$(…)` expansions, empty-quote gluing (`refres""h`), and `echo auth token | xargs gh` reconstruction — including `unset GH_TOKEN; gh $x switch` active-account mutation ([gh environment](https://cli.github.com/manual/gh_help_environment); [xargs(1)](https://man7.org/linux/man-pages/man1/xargs.1.html); [i18-shell-obfuscation cites](docs/research/i18-shell-obfuscation-cites-2026-08-08.md))
- `acct exec` I18 deny-list covers `xargs` (including `-I{}` / BSD `-I` / `-J`) so `xargs … gh auth token|login|…` is refused ([xargs(1)](https://man7.org/linux/man-pages/man1/xargs.1.html))
- Doctor detects sticky `GH_TOKEN` principal mismatch vs cwd profile and unbound+token linger (T5; [gh environment](https://cli.github.com/manual/gh_help_environment))
- `acct uninstall` warns that OS credential helpers may still answer for github.com; points at `git credential reject` ([gitcredentials](https://git-scm.com/docs/gitcredentials))
- Live E2E cleanup uses `gh repo delete --yes`; leftover cleanup script documents `delete_repo` scope ([gh repo delete](https://cli.github.com/manual/gh_repo_delete))
- Nearest `.acct` discovery walks from cwd to filesystem root (direnv `find_up` model) — works outside git repos and for nested `pkg/.acct` (I3; closes parent-binding fallthrough when `.acct` was ignored without a git toplevel)
- `acct exec` deny-list (I18) matches absolute `gh` paths, `env`/`nice`/… wrappers, and shell `-c` scripts that invoke denied `gh auth` subcommands
- Credential helper is **read-only for secrets**: `store` silently ignored; `erase` only when password matches the stored token — closes cross-account `git credential approve` poison (I17; [gitcredentials](https://git-scm.com/docs/gitcredentials))
- Credential helper `get` is **HTTPS-only** — `protocol=http` (and non-https) returns `quit=1` with no password (I16)
- `acct exec` refuses `gh auth login|logout|refresh|token|switch|setup-git` (I18; dumps or mutates global auth)
- `acct ssh-test` works for HTTPS profiles with an attached `sshKeyPath` (I8b dual plane); no longer requires `protocol=ssh`
- POSIX single-quote shell escaping for credential shim paths, `core.sshCommand` key paths, and live E2E helper overrides (paths with spaces / `$`)
- `ACCT_DEBUG` never emits token prefixes — central sanitize + `[REDACTED]` only (I13)
- `acct exec --profile` that differs from the cwd binding now requires `--allow-cross-profile` (gh plane footgun)
- Doctor classifies **effective** credential helpers after empty-string resets; warns on competing OS helpers (`osxkeychain` / `wincred` / `manager` / `gh`) and client-side hook bypass (`--no-verify`)
- Live E2E: correct I4 status assertion; fail-closed unbound fill check after install; gate mutating clone/commit/push behind `ACCT_LIVE_MUTATING=1`
- Credential helper rejects non-default ports for hostname-only profiles (`github.com:8443` → `quit=1`); `:443` still allowed (I7; [git-credential](https://git-scm.com/docs/git-credential))
- Credential parser fail-closed on conflicting duplicate `host`/`protocol` or disagreeing `url=` vs explicit host (no last-wins token leak)
- Present empty/blank `.acct` is local unbound — does not fall through to parent directory binding (I3)

### Changed

- README links the marketing site ([acct-web.vercel.app](https://acct-web.vercel.app/)) with homepage screenshot
- `package.json` `homepage` points at the site; `website.jpg` is included in the published tarball
- `shell-env` output includes a T5 reminder to install the cd/prompt hook so `GH_TOKEN` rebinds on `cd`
- Block messages no longer advertise `--no-verify` as an escape hatch; they note client hooks are bypassable and point to server-side policy
- Invariants doc: I3 nearest `.acct` walk-up, I4 cross-profile guard + username override, I7 port allowlist, I8b ssh-test, I13 debug redaction, I15 hook bypass, I16 HTTPS-only get, I17 read-only store, I18 exec auth deny-list (fail-closed `xargs`→`gh`\|shell + shell obfuscation)
- Threat model: T5 sticky token doctor; T7b/T7c; T13 xargs stdin/`-I{}` fail-closed; T14 post-uninstall residual; T15 profile id allowlist
- Doctor: `default-enforce-off` / `unbound-enforce-off` warnings for OS-helper fallthrough

## [0.1.3] - 2026-08-08

### Fixed

- CI/release run `npm run build` before tests so helper integration tests can load `dist/` (gitignored)
- Helper security tests self-build when `dist/` is missing

### Notes

- `v0.1.2` was tagged but never published (release job failed on the above). Use `0.1.3`.

## [0.1.2] - 2026-08-08

### Changed

- **Breaking (I4):** Ambient `ACCT_PROFILE` no longer overrides credential helper or enforce hooks. Directory / `.acct` win for git auth. Use CLI `--profile` for `acct exec` / `status` / `clone` (gh plane). Forcing a different git identity requires `cd` or a repo `.acct` file.
- Unbound resolution uses `defaultEnforce` (default `strict`) instead of hardcoded `off`.
- `profile ssh-key` no longer forces `protocol=ssh`; HTTPS helper reset is always emitted (dual plane with optional `sshCommand`).
- Managed gitconfig block installs a global `credential.helper=""` then acct shim before `includeIf` fragments ([gitcredentials](https://git-scm.com/docs/gitcredentials); [git.git 2432137](https://github.com/git/git/commit/24321375cda79f141be72d1a842e930df6f41725)).

### Fixed

- Cross-account push via ambient `ACCT_PROFILE` in a bound tree (helper + pre-push).
- Unbound HTTPS fallthrough to competing helpers (e.g. osxkeychain) when `defaultEnforce=strict` — helper returns `quit=1`.
- Hooks calling bare `acct` (PATH-dependent); now absolute `node` + `acct.js` (I11b).
- Attaching an SSH key dropped HTTPS credential isolation.

## [0.1.1] - 2026-08-08

### Changed

- README refresh with logo and clearer product pitch (shipped in package tarball)

## [0.1.0] - 2026-08-08

### Added

- Directory-scoped profile resolution (`ACCT_PROFILE`, `.acct`, longest path binding)
- Git identity via tagged `includeIf` config fragments
- `git-credential-acct` HTTPS helper with host validation and fail-closed `quit=true`
- OS keychain secrets with explicit file-backend opt-in for CI
- SSH plane using `core.sshCommand` and `IdentitiesOnly=yes`
- `gh` plane via `GH_TOKEN` injection and `acct exec` (no `gh auth switch`)
- Enforcement modes (`strict` / `warn` / `off`) with pre-commit and pre-push hooks
- Shell hooks for bash, zsh, fish, and PowerShell
- CLI: `init`, `profile`, `bind`, `status`, `whoami`, `doctor`, `clone`, `enforce`, `hook`, `install`, `uninstall`
- CI matrix (Ubuntu / macOS / Windows × Node 20 / 22) with lint, test, package, and e2e gates
- Tagged npm publish with provenance

[0.1.10]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.10
[0.1.9]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.9
[0.1.8]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.8
[0.1.7]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.7
[0.1.6]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.6
[0.1.5]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.5
[0.1.4]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.4
[0.1.3]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.3
[0.1.2]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.2
[0.1.1]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.1
[0.1.0]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.0
