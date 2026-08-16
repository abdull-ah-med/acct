# Testing acct

Tests exist to catch **wrong behavior**, not to freeze today’s source text.

Agent loop (required): skill `test-driven-development` → `.cursor/rules/no-change-detector-tests.mdc` → skill `verification-before-completion`. Architecture: `.cursor/rules/testing-architecture.mdc`.

A test written by reading the implementation encodes what the code currently does. Google calls that a **change-detector** and classifies it as negative value ([TotT, 2015](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html); [SWE at Google ch. 12](https://abseil.io/resources/swe-book/html/ch12.html)). Oracles come from invariants and primary docs, not from `src/`.

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

## CI evidence gate

CI (`.github/workflows/ci.yml`) is the same gate as `verification-before-completion`. It must not skip jobs or weaken assertions.

| Job | Command | What it proves |
|-----|---------|----------------|
| Lint | `npm run lint` | Types compile (`tsc --noEmit`) |
| Test | `npm run build` then `npm test` | Seam tests on Node 20/22 × Linux/macOS/Windows. `passWithNoTests` is off. |
| Package | `npm run pack:check` then `npm run pack:smoke` | The **published tarball** (not the checkout) runs `acct --version` and helper `capability` |
| Security | `npm run test:security` | Synthetic I4/I6/I18 regressions |
| E2E | `npm run test:e2e` | Broader synthetic harness |
| Gate | all of the above | The only allowed “CI passed” signal |

Do not add `--passWithNoTests`, skip matrices, or treat lint as a substitute for `npm test`. Live dual-account e2e stays optional and off the default gate.
