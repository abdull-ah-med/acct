# acct

Directory-scoped GitHub **identity + auth**. One account, one identity, one directory tree. Local supersedes global. Fail closed when constraints are not met.

## Why

`user.name` / `user.email` are not auth. `gh auth switch` is global. HTTPS credentials are host-scoped by default. SSH agents offer every key unless `IdentitiesOnly yes`. `acct` closes those leaks together.

Official `gh` documents that automatic switching by directory is out of scope; `acct` owns that gap.

## Install

```bash
npm install -g acct-sh
# or
pnpm add -g acct-sh
npx acct-sh status
```

## Quick start

```bash
# Create a profile and bind a folder (imports token from gh)
acct init \
  --id work \
  --user your-work-user \
  --email you@company.com \
  --name "Your Name" \
  --bind ~/Work \
  --import-gh

# Shell integration (zsh example)
eval "$(acct hook zsh)"

# Check
cd ~/Work/some-repo
acct status
acct whoami
acct doctor
```

## Commands

| Command | Purpose |
|---------|---------|
| `acct init` | Profile + binding + install |
| `acct profile add\|list\|show\|remove\|token\|ssh-key` | Profiles |
| `acct bind` / `unbind` | Directory → profile |
| `acct status` / `whoami` | Current resolution |
| `acct doctor` | Conflict scan |
| `acct exec -- <cmd>` | Run with correct `GH_TOKEN` (no `gh auth switch`) |
| `acct clone <url>` | Clone under current profile env |
| `acct enforce strict\|warn\|off` | Default enforcement |
| `acct hook bash\|zsh\|fish\|powershell` | Shell hook |
| `acct install` / `uninstall` | Wire/remove git includeIf + hooks |

## How it works

1. **Resolution** — `ACCT_PROFILE` → repo `.acct` → longest path binding → unbound  
2. **Identity** — managed `includeIf` sets `user.*` per directory  
3. **HTTPS** — `git-credential-acct` returns that profile’s token; `quit=true` on strict failure  
4. **SSH** — `core.sshCommand` with `IdentitiesOnly=yes`  
5. **gh** — injects `GH_TOKEN` from OS keychain  
6. **Enforce** — pre-commit / pre-push hooks in strict mode  

See [docs/invariants.md](docs/invariants.md) and [docs/threat-model.md](docs/threat-model.md).

## Security

- Tokens live in the OS keychain (`@napi-rs/keyring`) by default, never in `config.yaml`
- If the keychain is unavailable (CI / locked-down environments), set `ACCT_SECRET_BACKEND=file` to use `~/.config/acct/secrets.json` (mode `0600`) as an **explicit** opt-in (doctor will warn)
- Auto mode never silently writes new tokens to disk; it may read an old `secrets.json` only to migrate
- Credential helper rejects empty/malicious hosts; uses `!'…'` form so paths with spaces work
- Bound profiles reset other credential helpers before installing `acct`
- Shell hook rebinds from directory (ignores sticky `ACCT_PROFILE`) and clears tokens when unbound
- `acct install` sets `core.hooksPath` for the current repo; pass `--global` only if you accept replacing hooks everywhere 

## Agent / contributor harness

Read [AGENTS.md](AGENTS.md). Verify primary docs in [docs/sources/SOURCE_OF_TRUTH.md](docs/sources/SOURCE_OF_TRUTH.md) before changing auth behavior.

## License

MIT
