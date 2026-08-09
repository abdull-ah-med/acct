# Research cites — credential store / HTTP / exec deny (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| Helpers that do not support `store`/`erase` should **silently ignore** the request (read-only / generator helpers) | https://git-scm.com/docs/gitcredentials |
| Credential contexts match **protocol exactly** (`http://` ≠ `https://`) | https://git-scm.com/docs/gitcredentials |
| `host` may include port (e.g. `example.com:8088`) — port is part of the credential context shape | https://git-scm.com/docs/git-credential |
| **Superseded policy:** do not accept arbitrary ports for hostname-only profiles — see [host-port-local-acct-cites-2026-08-08.md](./host-port-local-acct-cites-2026-08-08.md) | https://git-scm.com/docs/git-credential |
| Helper `quit=true`/`1` stops further helpers and skips prompting | https://git-scm.com/docs/gitcredentials |
| Empty/malicious host must not return credentials (CVE-2020-11008 class) | https://github.com/git/git/security/advisories/GHSA-hjc9-x69f-jqj7 |
| `GH_TOKEN`/`GITHUB_TOKEN` override stored gh credentials | https://cli.github.com/manual/gh_help_environment |
| `gh auth login` stores credentials in the system store / plaintext fallback | https://cli.github.com/manual/gh_auth_login |
| `gh auth logout` removes local auth configuration | https://cli.github.com/manual/gh_auth_logout |
| `gh auth refresh` mutates stored credential scopes | https://cli.github.com/manual/gh_auth_refresh |
| `gh auth token` prints the authentication token to stdout | https://cli.github.com/manual/gh_auth_token |
| `gh auth switch` changes the active account for a host | https://cli.github.com/manual/gh_auth_switch |
| `gh auth setup-git` configures git to use gh as credential helper | https://cli.github.com/manual/gh_auth_setup-git |
| `GH_TOKEN` does not authenticate git HTTPS | https://github.com/cli/cli/issues/2771 |

## Design chosen

1. **HTTPS-only `get`** — refuse `protocol=http` (and anything else) with `quit=1` so HTTPS profile tokens are never returned for an HTTP context.
2. **Read-only `store`** — silently ignore `store` (gitcredentials allows this). Token writes go only through `acct profile token` / `--import-gh` / `--stdin`, closing cross-account store poison.
3. **Guarded `erase`** — only erase when `password` matches the currently stored profile token (and username matches if present). Prevents wipe via foreign `reject` while still clearing on genuine reject of our credential.
4. **Expand `acct exec` deny-list** — refuse `gh auth` subcommands that mutate global auth state or dump tokens: `login`, `logout`, `refresh`, `token`, `switch`, `setup-git`. Hardened further in [local-acct-exec-deny-cites-2026-08-08.md](./local-acct-exec-deny-cites-2026-08-08.md) (basename / wrappers / shell `-c`).
