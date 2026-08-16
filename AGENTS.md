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

See [docs/testing.md](docs/testing.md) and `.cursor/rules/testing-architecture.mdc`.

- **Oracle:** `docs/invariants.md`, `docs/sources/SOURCE_OF_TRUTH.md`, `tests/fixtures/` — never the implementation you just wrote.
- **Loop:** skill `test-driven-development` — failing test first; watch it fail; then minimal code. Skill `acct-implement-subsystem` for the product loop.
- **Contract:** `.cursor/rules/no-change-detector-tests.mdc` and `.cursor/rules/testing-contracts.mdc`. Hardcoded expected values. Drive `bin/acct.js`, `bin/git-credential-acct.js`, or a fake `gh` on `PATH`. Do not mock `src/` internals.
- **Evidence:** skill `verification-before-completion` — no “tests pass” / “done” without a fresh `npm test` in this turn.

Credential helper protocol must match [git-credential](https://git-scm.com/docs/git-credential). Change-detector tests (encode what the code currently does) have negative value — rewrite or delete.

## Research

Primary research lives under [docs/research/](docs/research/). Threat model: [docs/threat-model.md](docs/threat-model.md).
