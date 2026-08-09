# Research archive

Primary-source research captured during product design. Prefer [../sources/SOURCE_OF_TRUTH.md](../sources/SOURCE_OF_TRUTH.md) for live verification before coding.

| File | Focus |
|------|--------|
| [acct-research-brief.md](acct-research-brief.md) | Git credential helpers, includeIf, SSH, HTTPS leaks |
| [github-cli-auth-research.md](github-cli-auth-research.md) | gh auth, tokens, GH_TOKEN, multi-account |
| [multi-account-git-research.md](multi-account-git-research.md) | Existing tools, pain points, product gaps |
| [credential-store-http-exec-cites-2026-08-08.md](credential-store-http-exec-cites-2026-08-08.md) | Read-only store, HTTPS-only get, exec deny |
| [host-port-local-acct-cites-2026-08-08.md](host-port-local-acct-cites-2026-08-08.md) | Port allowlist, parser conflicts, empty `.acct` |
| [local-acct-exec-deny-cites-2026-08-08.md](local-acct-exec-deny-cites-2026-08-08.md) | Nearest `.acct` walk-up; exec deny basename/wrappers/shell `-c` |
| [xargs-sticky-uninstall-delete-cites-2026-08-08.md](xargs-sticky-uninstall-delete-cites-2026-08-08.md) | I18 `xargs`, sticky `GH_TOKEN` doctor, uninstall residual, `gh repo delete` |
| [i18-shell-obfuscation-cites-2026-08-08.md](i18-shell-obfuscation-cites-2026-08-08.md) | I18 shell `-c` obfuscation + sticky-token unset bypass |
| [i18-shell-bypass-round2-cites-2026-08-08.md](i18-shell-bypass-round2-cites-2026-08-08.md) | I18 round-2: `$a$b`, `$IFS`, printf escapes, decoder\|shell; profile id allowlist |
| [i18-xargs-stdin-bypass-cites-2026-08-08.md](i18-xargs-stdin-bypass-cites-2026-08-08.md) | I18 fail-closed: `xargs` stdin append / `-I{}` → `gh`\|shell |
| [i18-profile-case-round3-cites-2026-08-08.md](i18-profile-case-round3-cites-2026-08-08.md) | Profile id case-fold + I18 `$a$b` / awk / osascript / git alias |
| [e2e-security-fix-cites-2026-08-08.md](e2e-security-fix-cites-2026-08-08.md) | E2E security regression cites |
