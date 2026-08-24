# Research cites — security hardening round (2026-08-16)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| Credential helper strings are **executed by the shell**; `!` means a shell snippet; absolute paths still get an operation argument appended and run via the shell | https://git-scm.com/docs/gitcredentials (CUSTOM HELPERS); https://git-scm.com/docs/api-credentials |
| Empty `credential.helper` resets the helper list | https://git-scm.com/docs/gitcredentials (CONFIGURATION OPTIONS / helper) |
| `host` includes the port **when one was specified** (e.g. `example.com:8088`). Typical fill example uses `host=example.com` with no port for `https://example.com` | https://git-scm.com/docs/git-credential (INPUT/OUTPUT FORMAT / host; TYPICAL USE) |
| Values must not contain newline or NUL | https://git-scm.com/docs/git-credential |
| Helpers must not return credentials for blank/malicious hosts (CVE-2020-11008) | https://github.com/git/git/security/advisories/GHSA-hjc9-x69f-jqj7 |
| Read-only helpers should silently ignore `store` | https://git-scm.com/docs/gitcredentials ; https://git-scm.com/docs/api-credentials |
| `GH_TOKEN` does not authenticate git HTTPS (credential helper is a separate plane) | https://github.com/cli/cli/issues/2771 (mislav: git asks for HTTPS creds independently) |
| `GH_TOKEN` / `GITHUB_TOKEN` take precedence over stored gh credentials | https://cli.github.com/manual/gh_help_environment |
| `gh auth token --hostname --user` outputs that account’s token without switching | https://cli.github.com/manual/gh_auth_token |
| `gh api user --jq .login` is the documented way to print the authenticated login | https://cli.github.com/manual/gh_api (`-q/--jq`) |
| Git config subsection names cannot contain newline or NUL; `"` and `\` must be escaped as `\"` and `\\`; section headers cannot span lines | https://git-scm.com/docs/git-config (SYNTAX) |
| `includeIf.gitdir:` data after the colon is a **glob pattern** | https://git-scm.com/docs/git-config (Conditional includes) |
| `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*` override config files for the process (including `git clone`) | https://git-scm.com/docs/git-config (ENVIRONMENT) |
| `core.hooksPath` is looked up as normal git config (local beats global). Unsetting `--global` does not unset `--local` | https://git-scm.com/docs/git-config (`core.hooksPath`); git config lookup order |
| `process.execPath` is the absolute pathname of the Node executable that started this process (symlinks resolved) | https://nodejs.org/api/process.html#processexecpath |
| `crypto.timingSafeEqual(a, b)` **throws** if byte lengths differ; docs say it is suitable for comparing HMAC digests | https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b |
| `pwsh -EncodedCommand` / `-e` / `-ec` accepts a Base64 **UTF-16LE** command; `-File` / `-f` runs a script file; all parameters are case-insensitive | https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pwsh |
| Next.js sets CSP and security headers via `headers()` in `next.config`; official “without nonces” CSP for static apps uses `'unsafe-inline'` (and `'unsafe-eval'` in development) | https://nextjs.org/docs/app/api-reference/config/next-config-js/headers ; https://nextjs.org/docs/app/guides/content-security-policy (Without Nonces) |
| `og:image:width` / `og:image:height` are optional structured properties (pixels). The OG protocol does **not** mandate 1200×630 | https://ogp.me/ (Structured Properties) |
| HTML `<script>` text must not contain a raw `</` sequence; JSON-LD in a script tag should encode `<` | https://html.spec.whatwg.org/multipage/scripting.html#restrictions-for-contents-of-script-elements |

## Design chosen

1. **Credential shim uses `process.execPath`** (override `ACCT_NODE_PATH` only) — same I11b rule as enforce hooks. Git executes helpers via the shell, so a PATH `node` is attacker-controlled.
2. **Reject bind paths** containing CR/LF/NUL/`"`/`\`/`[`/`]` rather than attempting includeIf escaping — fail closed (same policy as profile field sanitization). Re-check on `installIncludeIf`.
3. **Re-validate profile name/email/host/user** inside `writeProfileInclude` so hand-edited `config.yaml` cannot inject gitconfig.
4. **`hostAllowed`**: if `profile.host` pins **`:443`**, treat it like hostname-only (bare host or `:443`). Non-default pinned ports still require an exact match. Matches git-credential “port only when specified” plus existing I7.
5. **Follow-gh persist is not a helper `get` side effect** (`persist: false` on the credential-helper seam). Helper still *returns* a live `gh auth token` so HTTPS follows gh (behavior tests). Keychain writes happen from status/exec/shell-env after `gh api user --jq .login` matches `profile.githubUser`.
6. **I18 PowerShell**: fail-closed on `-EncodedCommand`/`-e`/`-ec`/`-enc…`, `-File`/`-f`, `-CommandWithArgs`/`-cwa`, and `-Command -` / `-File -` (script body not in argv). Cite about_Pwsh; same rationale as xargs stdin fail-closed.
7. **`acct uninstall`** unsets **local** `core.hooksPath` when it points at acct hooks (cwd git toplevel), plus existing global unset.
8. **`acct clone`** runs `stripGitConfigEnvOverrides` (same as exec). Cite git-config ENVIRONMENT.
9. **Doctor `--online`**: cwd `gh api user` only when `opts.online` is true. Status/hooks still always query.
10. **Resolution** uses `findProfileById` only (I3: unknown **profile id** → unbound). Stop spawning `git rev-parse` in `fromCwd` (result unused).
11. **SSH `HostName=`** uses hostname only (`splitHostPort`); port is not valid in `ssh_config` HostName letters/digits/dot/hyphen allowlist.
12. **Password compare**: SHA-256 both sides then `timingSafeEqual` on 32-byte digests so length mismatch cannot throw or early-return.
13. **acct-web**: Next.js official `headers()` security set + without-nonce CSP; JSON-LD `<` → `\u003c`; OG width/height = actual pixels (2764×1022). Remove unused `framer-motion` (site uses `motion/react`).
