# Research cites — E2E security fixes (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| `credential.helper=""` resets the helper list so later helpers replace lower-priority ones | https://git-scm.com/docs/gitcredentials |
| Helper `quit=true`/`1` stops further helpers and skips prompting | https://git-scm.com/docs/gitcredentials |
| Empty helper reset was intentional (override system helpers) | https://github.com/git/git/commit/24321375cda79f141be72d1a842e930df6f41725 |
| Absolute helper path or `!` shell snippet is valid | https://git-scm.com/docs/gitcredentials |
| `includeIf gitdir` matches location of `.git` (or `$GIT_DIR`) | https://git-scm.com/docs/git-config |
| Hooks live under `core.hooksPath`; non-executable ignored | https://git-scm.com/docs/githooks |
| `GH_TOKEN`/`GITHUB_TOKEN` take precedence over stored gh credentials | https://cli.github.com/manual/gh_help_environment |
| `GH_TOKEN` does not authenticate git HTTPS — git uses credential helpers | https://github.com/cli/cli/issues/2771 |
| `IdentitiesOnly` limits offered keys to configured IdentityFile | https://man.openbsd.org/ssh_config.5 |
| GCM multi-user: username in URL or `credential.<URL>.username` | https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/multiple-users.md |
