# SOURCE_OF_TRUTH — Primary documentation registry

Before implementing a subsystem, **fetch** the URLs listed for it. Update `last_verified` (ISO date) after confirming.

## Credential helper / HTTPS

| Topic | URL | last_verified |
|-------|-----|---------------|
| gitcredentials | https://git-scm.com/docs/gitcredentials | 2026-08-16 (helper executed by the shell; empty helper reset; read-only store) |
| git-credential protocol | https://git-scm.com/docs/git-credential | 2026-08-16 (host includes port only when specified; newline/NUL forbidden) |
| api-credentials (helpers) | https://git-scm.com/docs/api-credentials | 2026-08-08 |
| GCM multiple users | https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/multiple-users.md | 2026-08-08 |
| GCM credstores | https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/credstores.md | 2026-08-08 |
| Empty helper reset (git.git) | https://github.com/git/git/commit/24321375cda79f141be72d1a842e930df6f41725 | 2026-08-08 |
| GH_TOKEN vs git HTTPS (cli#2771) | https://github.com/cli/cli/issues/2771 | 2026-08-08 |

## Git config / identity / includeIf

| Topic | URL | last_verified |
|-------|-----|---------------|
| git-rev-parse | https://git-scm.com/docs/git-rev-parse | 2026-08-24 (`--show-toplevel` is the work-tree root; error when none) |
| Conditional includes (source) | https://github.com/git/git/blob/master/Documentation/config.adoc | 2026-08-08 |
| direnv nearest-config walk (`find_up`) | https://github.com/direnv/direnv/blob/master/README.md | 2026-08-08 |

## SSH

| Topic | URL | last_verified |
|-------|-----|---------------|
| ssh_config IdentitiesOnly / IdentityFile | https://man.openbsd.org/ssh_config.5 | 2026-08-08 |
| ssh_config (Linux man) | https://man7.org/linux/man-pages/man5/ssh_config.5.html | 2026-08-08 |
| Git core.sshCommand | https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresshCommand | 2026-08-08 |

## GitHub CLI / tokens

| Topic | URL | last_verified |
|-------|-----|---------------|
| gh environment | https://cli.github.com/manual/gh_help_environment | 2026-08-16 (re-fetched: GH_TOKEN precedence; GH_PATH is gh self-path, not caller pin) |
| gh auth login | https://cli.github.com/manual/gh_auth_login | 2026-08-13 (no `--user`; `--hostname` `--web` `--with-token`) |
| gh auth logout | https://cli.github.com/manual/gh_auth_logout | 2026-08-13 (`--hostname` `--user`) |
| gh auth refresh | https://cli.github.com/manual/gh_auth_refresh | 2026-08-13 (no `--user`; refreshes **active** account only — switch first) |
| gh auth switch | https://cli.github.com/manual/gh_auth_switch | 2026-08-13 (`--hostname` `--user`) |
| gh auth token | https://cli.github.com/manual/gh_auth_token | 2026-08-16 (re-fetched: outputs token; `--hostname`/`--user`; no PATH) |
| gh api | https://cli.github.com/manual/gh_api | 2026-08-16 (authenticated request; `--jq`; endpoint `user` → GET /user) |
| gh auth status | https://cli.github.com/manual/gh_auth_status | 2026-08-24 (`--active` `--hostname` `--json hosts`; `--json` always exits 0 even when an account's token is invalid; JSON `hosts[hostname][].login` / `.active`) |
| REST GET /user (authenticated login) | https://docs.github.com/en/rest/users/users | 2026-08-16 (required `login`; 401 without auth) |
| Node child_process PATH / execFileSync | https://nodejs.org/api/child_process.html | 2026-08-16 (`options.env.PATH` else `process.env.PATH`; `file` is name or path) |
| about_Pwsh (EncodedCommand / -File / -Command) | https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh | 2026-08-16 (`-EncodedCommand\|-e\|-ec` UTF-16LE Base64; `-File\|-f` runs script) |
| about_PowerShell_exe | https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe | 2026-08-16 (5.1 `-EncodedCommand` UTF-16LE; `-File`) |
| Decode EncodedCommand from process | https://learn.microsoft.com/en-us/powershell/scripting/samples/decode-powershell-command-from-a-running-process | 2026-08-16 (CommandLine contains `EncodedCommand` + Base64; Unicode decode) |
| cmd.exe /c | https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd | 2026-08-16 (`/c` runs string then exits) |
| gh auth setup-git | https://cli.github.com/manual/gh_auth_setup-git | 2026-08-08 |
| GH_TOKEN blocks auth mutation (cli#2922) | https://github.com/cli/cli/issues/2922 | 2026-08-16 (re-fetched: env token used automatically; login/store blocked until cleared) |
| Clear env token to mutate stored creds (discussion#9647) | https://github.com/cli/cli/discussions/9647 | 2026-08-16 (re-fetched: `gh auth token` still prints; refresh/logout blocked) |
| gh repo delete | https://cli.github.com/manual/gh_repo_delete | 2026-08-08 (e2e cleanup / delete_repo scope) |
| Multiple accounts (docs.github) | https://docs.github.com/en/github-cli/github-cli/using-multiple-accounts | 2026-08-08 |
| Multiple accounts (gh source) | https://github.com/cli/cli/blob/trunk/docs/multiple-accounts.md | 2026-08-08 |
| Creating a PAT | https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token | 2026-08-08 |

## Hooks / enforcement

| Topic | URL | last_verified |
|-------|-----|---------------|
| githooks | https://git-scm.com/docs/githooks | 2026-08-08 |
| init.templateDir | https://git-scm.com/docs/git-init#_template_directory | 2026-08-08 |
| core.hooksPath | https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath | 2026-08-08 |

## Secrets / keyring

| Topic | URL | last_verified |
|-------|-----|---------------|
| @napi-rs/keyring | https://www.npmjs.com/package/@napi-rs/keyring | 2026-08-08 |
| keyring-node README | https://github.com/Brooooooklyn/keyring-node | 2026-08-08 |

## Security advisories (credential helpers)

| Topic | URL | last_verified |
|-------|-----|---------------|
| CVE-2020-11008 / GHSA | https://github.com/git/git/security/advisories/GHSA-hjc9-x69f-jqj7 | 2026-08-08 |

## Process wrappers (exec deny)

| Topic | URL | last_verified |
|-------|-----|---------------|
| xargs (Linux man) | https://man7.org/linux/man-pages/man1/xargs.1.html | 2026-08-08 (re-fetched: stdin append / `-I` replace → I18 fail-closed xargs→gh\|shell) |
| xargs (macOS / SS64) | https://ss64.com/mac/xargs.html | 2026-08-08 (re-fetched: `-I`/`-J` replacement) |
| POSIX printf (escapes / `\n`) | https://pubs.opengroup.org/onlinepubs/9699919799/utilities/printf.html | 2026-08-08 (I18 printf→xargs; re-fetched round 3) |
| bash Word Splitting / IFS (local `man bash`) | local man page § Word Splitting | 2026-08-08 (empty IFS; `$a$b` concat argv0 round 3) |
| git-config `alias.*` (`!` = shell) | https://git-scm.com/docs/git-config | 2026-08-08 (I18 git shell-alias carrier) |
| awk `system(cmd)` (local `man awk`) | local man page | 2026-08-08 (I18 awk carrier) |
| osascript `-e` (local `man osascript`) | local man page | 2026-08-08 (I18 osascript carrier) |

## Node crypto / process

| Topic | URL | last_verified |
|-------|-----|---------------|
| process.execPath | https://nodejs.org/api/process.html#processexecpath | 2026-08-16 (absolute Node binary path) |
| crypto.timingSafeEqual | https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b | 2026-08-16 (throws if lengths differ; compare equal-length SHA-256 digests) |
| crypto.createHash | https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options | 2026-08-16 |

## Next.js / HTML (acct-web)

| Topic | URL | last_verified |
|-------|-----|---------------|
| next.config.js headers() | https://nextjs.org/docs/app/api-reference/config/next-config-js/headers | 2026-08-16 |
| Content Security Policy (without nonces) | https://nextjs.org/docs/app/guides/content-security-policy | 2026-08-16 (`'unsafe-inline'`; `'unsafe-eval'` in development) |
| Open Graph protocol | https://ogp.me/ | 2026-08-16 (og:image:width/height optional; use actual pixel size) |
| HTML script element restrictions | https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements | 2026-08-16 (no raw `</` in script data; JSON-LD escape `<` → `\u003c`) |
