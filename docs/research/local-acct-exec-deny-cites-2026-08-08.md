# Research cites — nearest `.acct` walk + exec deny hardening (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| direnv locates `.envrc` by walking from cwd up to `/` and uses the **nearest** file | https://github.com/direnv/direnv/blob/master/README.md ; `find_up` in direnv stdlib |
| Product I3: present `.acct` (including empty) overrides directory bindings; must not silently inherit parent | `docs/invariants.md`; [host-port-local-acct-cites-2026-08-08.md](./host-port-local-acct-cites-2026-08-08.md) |
| `gh auth token` prints the authentication token to stdout | https://cli.github.com/manual/gh_auth_token |
| `gh auth login` / `logout` / `refresh` / `switch` / `setup-git` mutate global gh/git auth state | https://cli.github.com/manual/gh_auth_login ; …/gh_auth_switch ; …/gh_auth_setup-git |
| `GH_TOKEN` / `GITHUB_TOKEN` override stored gh credentials for API calls | https://cli.github.com/manual/gh_help_environment |
| Prior deny-list only matched argv `[gh, auth, …]` literally (absolute path / `env` / shell `-c` escaped it) | [credential-store-http-exec-cites-2026-08-08.md](./credential-store-http-exec-cites-2026-08-08.md); live adversarial probe 2026-08-08 |

## Design chosen

1. **Nearest `.acct` walk-up** — From `cwd`, walk parent directories to the filesystem root (direnv `find_up` model). The nearest present `.acct` wins (including empty → local unbound). File absent at every level → fall through to directory bindings. Works for non-git trees and nested `pkg/.acct` under a repo. Git toplevel is no longer required to discover `.acct`.
2. **Exec deny-list hardening (I18)** — Treat the effective command as:
   - Strip common wrapper prefixes (`env` + `VAR=val` / flags, `nice`, `nohup`, `time`, `timeout`, `stdbuf`, `command`, `builtin`, `exec`)
   - Compare **basename** of the command to `gh` (strip `.exe`/`.cmd`/`.bat`) so `/usr/bin/gh` matches
   - Refuse `auth` + `{login,logout,refresh,token,switch,setup-git}`
   - For shells (`bash`/`sh`/`zsh`/`dash`/`ksh`/`fish`/…), refuse `-c` / `-lc` / … scripts whose string matches a `gh auth <dangerous>` invocation
3. **Non-goal** — Arbitrary interpreters (`node -e`, `python -c`) that re-implement a gh call remain out of scope; `acct exec` already injects `GH_TOKEN` into the child env (echo is enough). I18 closes footguns and global-auth mutation via gh/shell wrappers, not a full sandbox.

Follow-up (same day): `xargs` added to wrappers — see [xargs-sticky-uninstall-delete-cites-2026-08-08.md](./xargs-sticky-uninstall-delete-cites-2026-08-08.md).

Follow-up (same day): shell `-c` obfuscation + sticky-token unset — see [i18-shell-obfuscation-cites-2026-08-08.md](./i18-shell-obfuscation-cites-2026-08-08.md).
