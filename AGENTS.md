# AGENTS.md — Building `acct`

## Product invariant

One GitHub account + one git identity + one directory tree. Local supersedes global. Outside a bound directory, that account/identity does not exist for `acct`-managed operations. When constraints are not satisfied and enforcement is on, block the operation.

Read [docs/invariants.md](docs/invariants.md) before any feature work.

## No assumptions

Before implementing any subsystem that touches git, gh, SSH, credentials, hooks, or OS secret stores:

1. Open [docs/sources/SOURCE_OF_TRUTH.md](docs/sources/SOURCE_OF_TRUTH.md).
2. Fetch the listed primary URLs for that subsystem (do not rely on memory).
3. Confirm behavior against those docs.
4. Cite the URL in the PR/commit notes for non-obvious protocol decisions.

Banned: “usually”, “should work”, “I think”, “typically” as justification for behavior.

Use skill `acct-verify-docs` before coding a subsystem. Use skill `acct-implement-subsystem` for the build loop. Use skill `acct-security-review` before merging auth/secret changes.

## Build order

Follow phases in the product plan: harness → resolution → identity → HTTPS helper → SSH → gh → enforce → shells → UX → publish. Do not skip doc verification between phases.

## Secrets

Tokens never in config files, fixtures, or logs. Use the secrets module / OS keychain. Fake tokens only in unit tests. See `.cursor/rules/security-secrets.mdc`.

## Tests

See [docs/testing.md](docs/testing.md). Tests live at public seams (CLI, credential helper, fake `gh` on `PATH`). Expected values come from independent sources (git/gh manuals, fake-gh state files) — not from copying the implementation. Do not mock `src/` internals.

Contract tests for the credential helper protocol must match [git-credential](https://git-scm.com/docs/git-credential). Write failing contract/acceptance tests before implementation (TDD). See `.cursor/rules/testing-contracts.mdc`.

## Research

Primary research lives under [docs/research/](docs/research/). Threat model: [docs/threat-model.md](docs/threat-model.md).
