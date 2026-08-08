# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/acct-sh/acct/releases/tag/v0.1.0
