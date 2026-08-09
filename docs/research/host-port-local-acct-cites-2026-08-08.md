# Research cites — host port allowlist + empty `.acct` (2026-08-08)

Fetched before implementation. No memory-only justifications.

| Fact | Source |
|------|--------|
| `host` attribute includes the port when one was specified (e.g. `example.com:8088`) | https://git-scm.com/docs/git-credential |
| Credential contexts compare hosts exactly (no parent-domain matching); protocol compared exactly | https://git-scm.com/docs/gitcredentials |
| Empty/malicious host must not return credentials (CVE-2020-11008 class) | https://github.com/git/git/security/advisories/GHSA-hjc9-x69f-jqj7 |
| Values must not contain newline or NUL; attribute list is `key=value` lines | https://git-scm.com/docs/git-credential |
| `url=` is expanded as if constituent `protocol`/`host`/… parts were read | https://git-scm.com/docs/git-credential |
| Repo-local `.acct` overrides directory binding (I3); invalid local profile must not silently inherit parent | https://github.com/this-repo/acct/blob/main/docs/invariants.md (product) |

## Design chosen

1. **Port allowlist for HTTPS tokens** — When `profile.host` is hostname-only (typical `github.com`), accept only bare hostname or `:443` (HTTPS default). Reject `:8443`, `:9`, etc. Returning a token for a non-default port lets a crafted `https://github.com:PORT/…` URL exfiltrate credentials to an attacker listener. When `profile.host` pins an explicit port (GHE), require an exact port match on the request.
2. **Parser fail-closed on conflicts** — Duplicate singular `host`/`protocol` lines with disagreeing values clear `host` (unsafe). If both `url=` and explicit `host`/`protocol` are present and disagree after URL parse, clear `host`. Prevents last-wins / dual-description tricks on direct helper stdin.
3. **Present empty `.acct` → local unbound** — File missing → fall through to bindings. File present with empty / blank / missing `profile` → `reason: local`, `profile: null` (fail closed). Unknown profile id already unbound via `getProfile` miss.
