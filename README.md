<p align="center">
  <img src="logo.svg" alt="acct" width="160" height="160" />
</p>

<h1 align="center">acct</h1>

<p align="center">
  <strong>One folder. One GitHub account. One identity. No leaks.</strong>
</p>

<p align="center">
  Directory-scoped GitHub identity + auth.<br />
  Local always wins. Fail closed when it doesn’t.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/acct-sh"><img src="https://img.shields.io/npm/v/acct-sh.svg?style=flat-square" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg?style=flat-square" alt="Node >= 20" /></a>
</p>

---

## The problem

`user.name` / `user.email` are not auth.  
`gh auth switch` is global.  
HTTPS credentials are host-scoped by default.  
SSH agents offer every key unless you force `IdentitiesOnly`.

Cross a directory boundary and you can silently push as the wrong person.

Official `gh` documents that automatic switching by directory is **out of scope**.  
`acct` owns that gap.

## The invariant

> **One GitHub account + one git identity + one directory tree.**  
> Local supersedes global. Outside a bound directory, that account does not exist for `acct`-managed operations. When constraints fail and enforcement is on — **block**.

## Install

```bash
npm install -g acct-sh
# or
pnpm add -g acct-sh

acct --help
```

Also on [GitHub Packages](https://github.com/acct-sh/acct/pkgs/npm/acct-sh) as `@acct-sh/acct-sh` (same bins).

## Quick start

```bash
# Profile + bind a tree (imports token from gh)
acct init \
  --id work \
  --user your-work-user \
  --email you@company.com \
  --name "Your Name" \
  --bind ~/Work \
  --import-gh

# Shell hook (zsh)
eval "$(acct hook zsh)"

# Inside the bound tree
cd ~/Work/some-repo
acct status
acct whoami
acct doctor
```

Walk into `~/Work` → work account.  
Walk out → that identity is gone.

## What it wires

| Plane | What `acct` does |
|-------|------------------|
| **Identity** | `includeIf` git config — `user.name` / `user.email` per directory |
| **HTTPS** | `git-credential-acct` returns *this* profile’s token; `quit=true` on strict failure |
| **SSH** | `core.sshCommand` with `IdentitiesOnly=yes` |
| **gh** | Injects `GH_TOKEN` from the OS keychain — no `gh auth switch` |
| **Enforce** | pre-commit / pre-push hooks in `strict` mode |

## Resolution order

1. `ACCT_PROFILE` (explicit)
2. Repo-local `.acct`
3. Longest matching directory binding
4. Unbound

Local always beats global.

## Commands

| Command | Purpose |
|---------|---------|
| `acct init` | Profile + binding + install |
| `acct profile add\|list\|show\|remove\|token\|ssh-key` | Profiles |
| `acct bind` / `unbind` | Directory → profile |
| `acct status` / `whoami` | Current resolution |
| `acct doctor` | Conflict scan |
| `acct exec -- <cmd>` | Run with correct `GH_TOKEN` |
| `acct clone <url>` | Clone under current profile env |
| `acct enforce strict\|warn\|off` | Enforcement mode |
| `acct hook bash\|zsh\|fish\|powershell` | Shell integration |
| `acct install` / `uninstall` | Wire / remove git includeIf + hooks |

## Security

- Tokens live in the **OS keychain** — never in `config.yaml`
- CI / locked-down hosts: `ACCT_SECRET_BACKEND=file` → `~/.config/acct/secrets.json` (`0600`) as an **explicit** opt-in
- Credential helper rejects empty / non-allowlisted hosts
- Bound profiles reset competing helpers, then install `acct` only
- Shell hook rebinds from cwd (ignores sticky `ACCT_PROFILE`) and clears tokens when unbound

See [docs/threat-model.md](docs/threat-model.md) and [docs/invariants.md](docs/invariants.md).

## How it feels

```text
~/Personal/blog     →  personal · commits as you@home
~/Work/api          →  work     · commits as you@company · work token only
~/Downloads         →  unbound  · acct does nothing / strict blocks managed ops
```

No global flip. No “forgot to switch.” No silent wrong-account push.

## Agent / contributors

Read [AGENTS.md](AGENTS.md).  
Verify primary docs in [docs/sources/SOURCE_OF_TRUTH.md](docs/sources/SOURCE_OF_TRUTH.md) before changing auth behavior.

## License

[MIT](LICENSE)
