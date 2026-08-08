# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.2]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.2
[0.1.1]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.1
[0.1.0]: https://github.com/abdull-ah-med/acct/releases/tag/v0.1.0
