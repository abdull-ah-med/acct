# Testing acct

Tests exist to catch **wrong behavior**, not to freeze today’s source text.

## Seams

Only these boundaries are worth tests. Everything else is implementation.

| Seam | What a caller observes |
|------|------------------------|
| `bin/acct.js` | stdout/stderr/exit code of `status`, `doctor`, `profile token`, `exec` |
| `bin/git-credential-acct.js` | git credential protocol on stdin/stdout |
| `acct shell-env` | exported `GH_TOKEN` / `ACCT_PROFILE` (or cleared) |
| `acct hook-run pre-commit` / `pre-push` | block vs allow |
| `gh` on `PATH` | argv and env of a **fake** `gh` (never mock `src/gh/token.ts`) |

Do not test private helpers, do not inject function pointers into production modules, and do not assert that a mock returned the string the test just configured.

## Independent sources of truth

Expected values come from outside the module under test:

- **GitHub CLI manuals** → `tests/fixtures/gh-auth-flags.json` (re-fetch `cli.github.com/manual/gh_auth_*` before editing). Diagnosis tests parse emitted commands and reject flags the manuals do not list.
- **Fake `gh` state file** → tokens the fake binary is programmed to emit. After “refresh”, change the state file and assert the helper’s stdout changed. The state file is the spec, not `src/gh/token.ts`.
- **Git credential protocol** → `username=` / `password=` / `quit=1` on helper stdout.
- **Product rules** → known literals (`commit.outlook === "blocked"` in strict identity mismatch). Not a copy of the implementation’s template string.

## Layers

1. **Unit** (`tests/unit`) — pure decisions with literal expected values (resolution, protocol parse, deny-list).
2. **Behavior** (`tests/behavior`) — spawn real bins against a temp config dir and a fake `gh` on `PATH`.
3. **Live e2e** (`scripts/e2e-*.mjs`) — optional dual real GitHub accounts. Synthetic harnesses must never mention real people.

`ACCT_SECRET_BACKEND=file` does **not** follow gh (protects CI from the developer’s real `gh`). Behavior tests that need follow-gh set `ACCT_FOLLOW_GH=1` and put the fake binary first on `PATH`.

## Adding a test

1. Name the seam and the user-visible claim.
2. Drive it through a bin or a public function that a bin uses, with an independent expected value.
3. If you need `gh`, use `tests/harness/fake-gh.ts` (a `.cjs` binary — this package is ESM, so a shebang `.js` file under the repo would crash). If the fake was never invoked, the test failed.

A test that still passes after you delete the assertion’s corresponding production line is not a test.
