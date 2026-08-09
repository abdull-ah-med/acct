# Research cites — I18 xargs, sticky GH_TOKEN, uninstall residual, e2e delete (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| `xargs` builds and executes a command line from stdin; utility is `[command] [initial-argument …]` after options | https://man7.org/linux/man-pages/man1/xargs.1.html ; macOS: https://ss64.com/mac/xargs.html |
| `xargs -I replstr` / `-J` place the utility after options — deny-list must skip options then see `gh` | Same |
| `GH_TOKEN` / `GITHUB_TOKEN` take precedence over stored gh credentials for API calls | https://cli.github.com/manual/gh_help_environment |
| `gh auth token` prints the authentication token to stdout | https://cli.github.com/manual/gh_auth_token |
| After helpers are removed, OS helpers (`osxkeychain`, etc.) may still answer HTTPS | https://git-scm.com/docs/gitcredentials (helper chain; empty helper resets) |
| `git credential reject` / helper `erase` removes a stored credential description | https://git-scm.com/docs/git-credential ; https://git-scm.com/docs/gitcredentials |
| `gh repo delete` requires `delete_repo` scope; authorize with `gh auth refresh -s delete_repo` | https://cli.github.com/manual/gh_repo_delete |
| Prior I18 wrappers: `env`/`nice`/`nohup`/`time`/`timeout`/`stdbuf`/`command`/`builtin`/`exec` + shells — **not** `xargs` (live bypass 2026-08-08) | [local-acct-exec-deny-cites-2026-08-08.md](./local-acct-exec-deny-cites-2026-08-08.md) |

## Design chosen

1. **I18 + xargs** — Add `xargs` to wrapper strip list; skip GNU/BSD `xargs` options; treat the following utility argv as the effective command (recursive deny). Fail-closed fallback: if `xargs` appears in argv and a later token’s basename is `gh` with `auth` + dangerous subcommand (or a shell `-c` script containing it), refuse. Non-goal unchanged: interpreters that echo `GH_TOKEN`.
2. **Sticky GH_TOKEN (T5)** — Doctor compares ambient token principal (`gh api user`) to cwd profile `githubUser`. Warn on mismatch or when unbound but token still set. Matching token (hook-fresh) is OK — drop noisy “token is set” warn.
3. **Uninstall residual** — After stripping the managed block, print warnings that OS helpers may still answer for `github.com`, with `git credential reject` guidance (gitcredentials). Doctor already flags missing acct helper + competing OS helpers; keep/strengthen that path.
4. **E2E cleanup** — Use `gh repo delete owner/name --yes` per official CLI; on 403 print `gh auth refresh -s delete_repo` and leave a dedicated cleanup script.
