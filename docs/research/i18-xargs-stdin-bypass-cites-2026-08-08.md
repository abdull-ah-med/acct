# Research cites — I18 xargs stdin / `-I{}` bypass (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| `xargs` reads items from **standard input** and executes `command` with `initial-argument…` **followed by** stdin items (append model) | https://man7.org/linux/man-pages/man1/xargs.1.html |
| macOS/BSD `xargs`: same append model; `-I replstr` / `-J replstr` **replace** occurrences of `replstr` in initial-arguments with stdin lines | https://ss64.com/mac/xargs.html ; local `man xargs` |
| GNU `-I replace-str` implies `-x` and `-L 1`; replacement is not visible in the parent argv at `acct exec` deny time | https://man7.org/linux/man-pages/man1/xargs.1.html |
| `gh auth token` prints the authentication token to stdout | https://cli.github.com/manual/gh_auth_token |
| `gh auth switch` / `login` / `logout` / `refresh` / `setup-git` mutate global gh/git auth | https://cli.github.com/manual/gh_auth_switch (and siblings) |
| `GH_TOKEN` overrides stored credentials; children can `unset` it then mutate keyring-backed auth | https://cli.github.com/manual/gh_help_environment ; https://github.com/cli/cli/discussions/9647 |
| Prior I18 xargs handling only matched when `auth` + dangerous subcommand already appeared **in argv** (or inside a shell `-c` string) | [xargs-sticky-uninstall-delete-cites-2026-08-08.md](./xargs-sticky-uninstall-delete-cites-2026-08-08.md); live probe 2026-08-08 |
| Live bypasses (live dual-account probes): `printf 'auth\ntoken\n' \| acct exec xargs gh`; `printf 'token\n' \| acct exec xargs -I{} sh -c 'gh auth {}'`; `printf 'switch\n' \| acct exec xargs -I{} sh -c 'unset GH_TOKEN; gh auth {} --user …'` (global active account mutated) | live extreme/extra probes 2026-08-08 |

## Design chosen

1. **Fail-closed `xargs` → `gh`** — After stripping outer wrappers (`env`/`nice`/…) and `xargs` options, if the effective utility (after nested wrapper strip) is `gh`, **refuse** under `acct exec`. Stdin can append `auth token` (`xargs gh`, `xargs -n2 gh`) or `-I{}` can substitute a dangerous subcommand. Safe `gh` use remains `acct exec gh …` without xargs. Cite: xargs(1) append/replace model.
2. **Fail-closed `xargs` → shell** — If the effective utility is a shell (`bash`/`sh`/`zsh`/…), **refuse**. `-I{} sh -c 'gh auth {}'` keeps dangerous words out of argv until substitution; sticky `GH_TOKEN` does not stop `unset` inside the script. Cite: macOS `-I` / GNU `-I`; gh environment.
3. **Keep** existing shell `-c` string detectors for `printf … \| xargs gh` written *inside* a script (already covered).
4. **Non-goal unchanged** — Interpreters (`node -e`, `python3 -c`, …) that spawn `gh` or echo injected `GH_TOKEN` remain out of scope (I18 is not a sandbox).

## Collateral (accepted)

- `acct exec xargs gh pr list` is refused — use `acct exec gh pr list`.
- `acct exec xargs bash -c 'echo hi'` is refused — rare under acct exec; closes the substitution hole.
