# Multi-Account GitHub Identity Management: Research & Pain Points

**Research Date:** August 8, 2026  
**Focus:** Existing solutions, community pain points, and product gaps for managing multiple GitHub accounts and per-directory git identity

---

## Executive Summary

Managing multiple GitHub accounts (personal + work) is a common developer workflow that **fails silently in multiple ways**. While Git and SSH provide the primitives, no single tool provides end-to-end coverage. Users must manually orchestrate 5+ separate systems (SSH config, git config, credential helpers, IDE auth, gh CLI), each with different failure modes.

**Key Insight:** Authentication (which token/key) and identity (commit author) are separate problems that users conflate, leading to wrong-account pushes and misattributed commits even when following "correct" guides.

---

## 1. Existing Tools & Solutions

### 1.1 Git Credential Manager (GCM)
**Repository:** https://github.com/git-ecosystem/git-credential-manager  
**Maintained by:** Microsoft  
**Protocol:** HTTPS

#### What It Solves
- Cross-platform credential storage (Windows, macOS, Linux)
- OAuth-based authentication with 2FA support
- Per-repository credential isolation via `useHttpPath` config
- Works with GitHub, Azure DevOps, GitLab, Bitbucket

#### Configuration for Multi-Account
```bash
# Enable per-path credential storage
git config --global credential.https://github.com.useHttpPath true

# Embed username in remote URL for routing
git remote set-url origin https://username@github.com/org/repo.git
```

#### What It Doesn't Solve
- **No automatic account switching by directory** - requires username in every URL
- **Clone-time account selection** - must manually specify username before cloning
- **Doesn't manage commit identity** (user.name/email) - separate config needed
- **Doesn't handle SSH workflows** - HTTPS only
- **GitHub-specific routing via `github` commands** (e.g., `git credential-manager github login`) not well documented

#### Trust/Security Notes
- ✅ Tokens stored in OS credential manager (Keychain/Windows Credential Manager)
- ✅ OAuth flow, no password storage
- ⚠️ If `gh` CLI is set as credential helper, it **overrides GCM** and only serves the active account's token
- ⚠️ Multiple credential helpers cause race conditions and popup spam

**Source:** [GCM docs](https://github.com/GitCredentialManager/git-credential-manager/blob/main/docs/multiple-users.md), [Blog: Two GitHub accounts on Windows](https://blog.shukebeta.com/2026/06/08/two-github-accounts-on-one-windows-box-https-only-dont-let-gh-be-your-git-credential-helper/)

---

### 1.2 GitHub CLI (`gh`)
**Repository:** https://github.com/cli/cli  
**Version:** v2.40.0+ supports multiple accounts

#### What It Solves
- Multiple authenticated accounts per host (GitHub.com, GHES)
- Manual account switching via `gh auth switch`
- Per-user token management in separate keychains
- Works for `gh` API commands (issues, PRs, etc.)

#### Usage
```bash
# Add multiple accounts
gh auth login  # account 1
gh auth login  # account 2

# Switch active account
gh auth switch

# View all accounts
gh auth status
```

#### What It Doesn't Solve
- **Only one account active at a time** - requires manual `gh auth switch` before each operation
- **No per-directory routing** - active account is global
- **Git credential helper mode is single-account** - if you run `gh auth setup-git`, git operations only use the active account's token
- **No coordination with Git's includeIf** for commit identity
- **Breaks multi-account workflows** when used as git credential helper

#### Trust/Security Notes
- ✅ Tokens stored in OS keychain
- ⚠️ `gh auth setup-git` makes `gh` the credential helper, which **prevents per-repo routing** - use GCM or SSH instead
- ⚠️ `gh auth switch` does not update git credential helper with new token ([Issue #8875](https://github.com/cli/cli/issues/8875))

**Source:** [GitHub CLI changelog](https://github.blog/changelog/2023-12-17-log-in-to-multiple-github-accounts-with-the-cli/), [gh docs](https://github.com/cli/cli/blob/trunk/docs/multiple-accounts.md)

---

### 1.3 SSH Host Aliases (Native Git/SSH)
**Documentation:** `man ssh_config`  
**Compatibility:** All platforms with OpenSSH

#### What It Solves
- Per-account SSH key routing via `~/.ssh/config` aliases
- Works with all git clients (no tool dependency)
- True per-directory automation when combined with Git's `includeIf`

#### Configuration
```bash
# ~/.ssh/config
Host github-personal
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_personal
  IdentitiesOnly yes

Host github-work
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_work
  IdentitiesOnly yes
```

```bash
# ~/.gitconfig
[includeIf "gitdir:~/personal/"]
  path = ~/.gitconfig-personal

[includeIf "gitdir:~/work/"]
  path = ~/.gitconfig-work
```

```bash
# ~/.gitconfig-personal
[user]
  name = Personal Name
  email = personal@example.com
[core]
  sshCommand = ssh -i ~/.ssh/id_ed25519_personal -o IdentitiesOnly=yes
```

#### What It Doesn't Solve
- **Clone-time URL modification** - must use alias in clone command (`git clone git@github-personal:user/repo.git`)
- **Submodule URL rewriting** - `.gitmodules` must use aliases for same-host accounts
- **Requires manual setup** - no CLI wizard to generate config
- **Learning curve** - users must understand SSH, Git config conditionals, and their interaction

#### Trust/Security Notes
- ✅ Private keys never leave local machine
- ✅ `IdentitiesOnly yes` prevents SSH agent from offering all keys (prevents wrong-account auth)
- ⚠️ Without `IdentitiesOnly`, SSH may try keys in agent order, authenticating as wrong account
- ⚠️ ControlMaster persistence can cause cross-account contamination if not configured with `%k` (host key alias)

**Source:** [DEV: Practical Guide to Multiple GitHub Accounts](https://dev.to/jayanth_ch/how-to-use-multiple-github-accounts-on-one-machine-work-personal-using-ssh-4lm8), [Stack Overflow: Multiple GitHub Accounts & SSH Config](https://stackoverflow.com/questions/3225862/multiple-github-accounts-ssh-config)

---

### 1.4 direnv + GH_TOKEN
**Repository:** https://direnv.net  
**Pattern:** Environment variable overrides

#### What It Solves
- Per-directory `GH_TOKEN` injection for GitHub CLI
- Automatic account switching on `cd`
- Works for API calls and `gh` commands

#### Configuration
```bash
# Install direnv
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc

# ~/work/.envrc
export GH_TOKEN="$(gh auth token --user work-username)"

# ~/personal/.envrc
export GH_TOKEN="$(gh auth token --user personal-username)"

# Enable each .envrc
direnv allow ~/work
direnv allow ~/personal
```

#### Alternative: GH_CONFIG_DIR
```bash
# ~/work/.envrc
export GH_CONFIG_DIR="$HOME/.config/gh-work"

# ~/personal/.envrc
export GH_CONFIG_DIR="$HOME/.config/gh-personal"
```

#### What It Doesn't Solve
- **Git authentication** - `GH_TOKEN` only affects `gh` CLI, not `git push`/`git pull`
- **Commit identity** - still requires separate `includeIf` config
- **Security risk** - `GH_TOKEN` takes precedence over everything, can leak to CI scripts
- **No SSH workflow** - HTTPS only
- **`.envrc` files in git** - easy to accidentally commit tokens

#### Trust/Security Notes
- ⚠️ `GH_TOKEN` env var takes precedence over all other auth methods
- ⚠️ Tokens exposed to all processes in that shell
- ⚠️ Easy to accidentally commit `.envrc` with tokens
- ⚠️ No protection against token leakage to subprocesses
- ✅ Can use `GH_CONFIG_DIR` instead for safer isolation

**Source:** [Quick Tip: Multiple GitHub Accounts with gh and direnv](https://knpw.rs/blg/multiple-gh-users/), [Multiple GitHub Accounts with direnv](https://lem.fyi/blog/multiple-github-accounts-with-direnv/)

---

### 1.5 npm CLI Tools (git-identity, git-account-cli, gity-tool, etc.)

#### gity-tool
**npm:** `gity-tool`  
**Repository:** https://github.com/YRACHEK101/gity-tool

**What it does:**
- Interactive wizard to create profiles (name, email, folder, SSH key)
- Generates Git `includeIf` config + per-profile `.gitconfig` files
- SSH key generation and GitHub authentication test
- Folder-based automatic identity switching

**Pros:**
- One-time setup wizard
- Tests SSH authentication per profile
- Uses native Git features (no runtime daemon)

**Cons:**
- Doesn't rewrite clone URLs (must still use `git@github.com:user/repo.git` format)
- No automatic SSH host alias generation
- Per-repo setup not emphasized

---

#### zit
**npm:** `@hypercodingdev/zit`  
**Repository:** https://github.com/Hypercodingdev/zit

**What it does:**
- Register accounts with SSH keys
- Create workspace folders linked to accounts
- `zit clone` wrapper that sets `GIT_SSH_COMMAND` for clone-time
- Uses `core.sshCommand` in `includeIf` configs (no SSH host aliases needed)

**Pros:**
- No SSH config modification needed
- `zit clone` handles clone-time account selection
- Workspace-based mental model

**Cons:**
- Must use `zit clone` instead of `git clone`
- Workspace structure is rigid (all repos under workspace folder)
- No migration path for existing repos
- Requires installing a wrapper around Git

---

#### gitprofile (meanii)
**npm:** `gitprofile`  
**Repository:** https://github.com/meanii/gitprofile

**What it does:**
- Profile management with SSH keys, GPG signing, commit email
- `gitprofile clone` wrapper with account selection
- Automatic `includeIf` config generation
- Per-repo override with `gitprofile use <profile>`

**Pros:**
- Handles GPG signing keys
- Works with existing repos via `gitprofile use`
- Global fallback profile support
- Doctor command for diagnostics

**Cons:**
- `gitprofile clone` required for automatic account selection at clone time
- Doesn't handle HTTPS workflows
- Limited documentation on IDE compatibility

---

#### git-account-cli
**npm:** `git-account-cli`  
**Repository:** https://www.npmjs.com/package/git-account-cli

**What it does:**
- Generate SSH keys per account
- Configure SSH host aliases in `~/.ssh/config`
- Set local git config (name, email, SSH command)
- **HTTPS to SSH remote URL conversion** for existing repos

**Pros:**
- Detects and converts HTTPS remotes to SSH
- SSH host alias approach (no wrapper commands)
- Works per-folder

**Cons:**
- Interactive per-folder setup (no global config persistence)
- Must run in each new project folder
- No `includeIf` integration (local config only)

---

#### git-profiles (Python)
**pypi:** `git-profiles`  
**Repository:** https://pypi.org/project/git-profiles/

**What it does:**
- Profile storage (name, email, signing key)
- Apply profiles to local repos via `git profiles apply <name>`
- List, duplicate, set/unset keys in profiles

**Pros:**
- Works as git subcommand: `git profiles <command>`
- Cross-platform persistent storage

**Cons:**
- No automatic per-directory switching
- No SSH key management
- Manual `git profiles apply` per repo

---

#### GitMux
**Repository:** https://github.com/wd006/gitmux

**What it does:**
- **One-time configuration wizard** (not a runtime tool)
- Generates `includeIf` blocks in `~/.gitconfig`
- Creates ED25519 SSH keys
- Two routing modes:
  - **Transparent:** Injects `core.sshCommand` (use standard `git@github.com` URLs)
  - **Classic:** SSH host aliases (use `git@github-work` URLs)

**Pros:**
- Zero runtime dependencies (pure Git/SSH config)
- No background processes
- Transparent mode allows standard clone URLs

**Cons:**
- Bash script, limited Windows support
- Manual re-run needed for changes
- Transparent mode still doesn't handle clone-time selection automatically

---

### Tool Comparison Summary

| Tool | Auto Directory Switch | Clone-Time Selection | SSH | HTTPS | IDE Compatible | No Wrapper Needed |
|------|----------------------|---------------------|-----|-------|----------------|-------------------|
| **GCM** | ❌ | ❌ (manual username) | ❌ | ✅ | ✅ | ✅ |
| **gh CLI** | ❌ | ❌ (global active) | ✅ | ✅ | ⚠️ (per-extension) | ✅ |
| **SSH + includeIf** | ✅ | ⚠️ (manual alias) | ✅ | ❌ | ✅ | ✅ |
| **direnv** | ✅ | ❌ | ❌ | ✅ | ⚠️ (shell-dependent) | ✅ |
| **gity-tool** | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ |
| **zit** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| **gitprofile** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| **git-account-cli** | ✅ | ❌ | ✅ | ⚠️ (converts) | ✅ | ✅ |

**Legend:**
- ✅ Full support
- ⚠️ Partial/manual support
- ❌ Not supported

---

## 2. Common Failure Modes (Stack Overflow / GitHub Issues / Reddit / HN)

### 2.1 "Permission denied" Despite Correct SSH Key Setup

**Symptom:** `Permission to user1/repo.git denied to user2`

**Root Cause:** SSH offers multiple keys from the agent, GitHub accepts the first valid one (wrong account)

**Why it happens:**
- Users generate separate SSH keys but don't set `IdentitiesOnly yes` in `~/.ssh/config`
- SSH agent loads all keys, offers them in memory order
- GitHub's authentication model: SSH key → GitHub account lookup (not host-based)

**Solutions users tried that DIDN'T work:**
- ❌ Generating new keys without changing SSH config
- ❌ Adding both keys to both accounts (GitHub rejects: "Key is already in use")
- ❌ Using `ssh-add -D` to clear agent, then adding only one key (breaks other workflows)

**What actually works:**
- ✅ `IdentitiesOnly yes` in SSH config per host alias
- ✅ Host aliases with explicit `IdentityFile` per account

**Evidence:** [Stack Overflow #3225862](https://stackoverflow.com/questions/3225862/multiple-github-accounts-ssh-config), [Stack Overflow #54495426](https://stackoverflow.com/questions/54495426/git-system-is-configured-for-two-accounts-but-git-push-is-using-the-wrong-acc), [HN Discussion](https://news.ycombinator.com/item?id=36800965)

---

### 2.2 Commits Show Wrong Name/Email After Following SSH Guide

**Symptom:** Push succeeds with correct account, but GitHub shows commits from wrong author

**Root Cause:** **Authentication ≠ Identity**
- SSH key determines which GitHub account can push
- Commit metadata (`user.name`/`user.email`) determines author attribution
- Users fix SSH (authentication) but forget to fix Git config (identity)

**Common user confusion:**
> "I'm using the right SSH key, why are my commits still under my work account?"

**What users tried that DIDN'T work:**
- ❌ Regenerating SSH keys
- ❌ Changing GitHub account settings
- ❌ Setting git config only in global `~/.gitconfig` (overridden by wrong-directory includeIf)

**What actually works:**
- ✅ `includeIf "gitdir:~/work/"` + separate `.gitconfig-work` with correct email
- ✅ Removing default `[user]` block from global config (forces explicit per-directory config)

**Evidence:** [DEV: Commits Linked to Wrong Account](https://dev.to/rehan_sayyed_56704d24727b/my-git-commits-were-linked-to-the-wrong-github-account-heres-why-b5k), [Stack Overflow #38728827](https://stackoverflow.com/questions/38728827/maintaining-two-github-user-accounts), [muquit/multiple-github-accounts](https://github.com/muquit/multiple-github-accounts)

---

### 2.3 ControlMaster SSH Persistence Causes Cross-Account Contamination

**Symptom:** Switching projects causes "Already authenticated as user X" for wrong account

**Root Cause:** OpenSSH's `ControlMaster` multiplexes connections - persistent connection uses first account's key for all subsequent operations

**Default behavior:**
```ssh
Host *
  ControlMaster auto
  ControlPath ~/.ssh/control-%h-%p-%r
```

**Problem:** `%h` is `github.com` for both accounts → same socket for both

**Solutions:**
- ✅ Add `%k` to ControlPath: `ControlPath ~/.ssh/control-%C-%k` (host key alias)
- ✅ Disable ControlMaster for GitHub: `Host github*.com\n  ControlMaster no`
- ✅ Short `ControlPersist` timeout

**Evidence:** [Stack Overflow #3225862 (answer by Tegan Snyder)](https://stackoverflow.com/questions/3225862/multiple-github-accounts-ssh-config#answer-62900219), [HN Discussion](https://news.ycombinator.com/item?id=37902614)

---

### 2.4 Git Submodules Use Wrong Account

**Symptom:** Main repo clones successfully, submodule init fails with permission denied

**Root Cause:**
- Main repo URL uses SSH alias: `git@github-work:org/main.git`
- `.gitmodules` hardcodes standard URL: `git@github.com:org/submodule.git`
- Submodule clone attempts to use default key (wrong account)

**Why it happens:**
- Users correctly set up main repo with alias
- Forget to update `.gitmodules` with same alias
- Or: `.gitmodules` committed by teammate with different account

**Solutions users tried that DIDN'T work:**
- ❌ Manually cloning submodule into directory (not tracked by Git)
- ❌ Changing SSH key permissions
- ❌ Adding `submodule.recurse true` to config

**What actually works:**
- ✅ Edit `.gitmodules` to use SSH alias for submodule URL
- ✅ Run `git submodule sync` after editing
- ✅ Use `git config url."git@github-work:".insteadOf "git@github.com:"` for automatic rewriting

**Evidence:** [HN: Solving Multiple Accounts](https://news.ycombinator.com/item?id=47099044), [GitHub Issue: Can I use different SSH keys for submodules?](https://github.com/kubernetes/git-sync/issues/924)

---

### 2.5 GPG Commit Signing Uses Wrong Key

**Symptom:** Commits are signed, but GitHub shows "Unverified" because signature doesn't match author email

**Root Cause:**
- User configures multiple SSH signing keys
- `includeIf` switches `user.email` correctly
- `user.signingkey` not overridden in conditional config → uses default key

**Common pattern:**
```bash
# ~/.gitconfig (global)
[user]
  signingkey = ~/.ssh/id_ed25519_personal.pub
[gpg]
  format = ssh
[commit]
  gpgsign = true

# ~/.gitconfig-work (missing signingkey override!)
[user]
  name = Work Name
  email = work@company.com
  # 🔴 signingkey NOT set - inherits personal key
```

**Result:** Work commit with work email, but signed with personal key → unverified

**Solutions:**
- ✅ Override `user.signingkey` in each conditional config
- ✅ Add `core.sshCommand` to ensure key used for signing matches auth key
- ✅ Upload all signing public keys to respective GitHub accounts under "Signing keys"

**Evidence:** [Gist: Managing multiple GitHub accounts for cloning and commit signing](https://gist.github.com/robandpdx/68bab0c65d2e2dcf096769dcb33c79f2), [asciijungle: Configuring Git Commit Signing for Multiple Environments](https://asciijungle.com/posts/2025-04-24-git-commit-signing-for-multiple-environments.html)

---

### 2.6 Multiple Credential Helpers Cause Popup Spam

**Symptom:** Git prompts for credentials on every fetch/push, or shows multiple authentication dialogs

**Root Cause:** System-level and user-level configs both define credential helpers - both execute

**Common setup:**
```bash
# System gitconfig (installed by Git for Windows)
[credential]
  helper = manager

# User's ~/.gitconfig
[credential]
  helper = wincred  # or osxkeychain
```

**Result:** Both helpers run, race to respond, spam popups, cache credentials in different stores

**How to diagnose:**
```bash
git config --get-all credential.helper
# Should show ONE helper, not multiple
```

**Solutions:**
- ✅ `git config --global --unset-all credential.helper` (removes user-level)
- ✅ Kill zombie GCM processes: `Get-Process git-credential-manager | Stop-Process -Force`
- ✅ Explicitly set ONE helper: `git config --global credential.helper manager`

**Evidence:** [MankhongGarden/git-credential-manager-windows-multi-account](https://github.com/MankhongGarden/git-credential-manager-windows-multi-account)

---

## 3. What Users Still Get Wrong After Following Guides

### 3.1 Clone URLs Without Aliases

**Common mistake:**
```bash
# User sets up SSH config with host aliases
# Then clones without using alias:
git clone git@github.com:user/work-repo.git

# 🔴 Uses default key, authenticates as personal account
# 🔴 Push fails or commits attributed to wrong account
```

**Why guides don't prevent this:**
- Guides focus on config setup, not workflow enforcement
- Users copy-paste clone URLs from GitHub UI (always `github.com`)
- No tooling validates clone URL matches intended account
- Some guides use `insteadOf` URL rewriting, but it requires org/path knowledge

**What would help:**
- ✅ Browser extension to rewrite GitHub clone URLs based on org
- ✅ Shell function that validates clone URL before executing
- ✅ Tool that wraps `git clone` and prompts for account selection

---

### 3.2 Forgetting to Set Identity After SSH Auth

**Pattern:**
1. User follows SSH multi-account guide
2. Successfully authenticates to both accounts
3. Makes commits, pushes successfully
4. Later discovers commits under wrong author

**Root cause:** Guides separate "SSH setup" from "Git identity setup" - users stop after SSH

**Compounding factor:** Git's UX doesn't warn about identity mismatch
```bash
# This succeeds even though identity is wrong:
git commit -m "Fix bug"
git push  # Uses correct SSH key, wrong commit metadata

# GitHub attributes commit to email in commit object, not push token
```

**What would help:**
- ✅ Pre-commit hook that validates `user.email` matches SSH key's GitHub account
- ✅ Tool that configures SSH + identity atomically
- ✅ `git push` warning if commit author doesn't match authenticated account

---

### 3.3 Not Testing Authentication Per Account

**Common assumption:** "I set it up, it must work"

**Reality:** Many users don't test SSH auth until first push failure

**Missing step from guides:**
```bash
# Test each SSH alias independently:
ssh -T git@github-personal
# Expected: Hi personal-username! You've successfully authenticated...

ssh -T git@github-work
# Expected: Hi work-username! You've successfully authenticated...
```

**Why users skip this:**
- Guides bury it at the end
- Not emphasized as critical validation step
- Users assume config changes are correct

**Compounding issue:** SSH failures don't clearly indicate *which* key was used
```
Permission denied (publickey)
# 🔴 Doesn't say which key it tried
# 🔴 Doesn't say which account it authenticated as
```

**What would help:**
- ✅ Setup wizard that tests each account before proceeding
- ✅ Better SSH error messages showing key path and GitHub user
- ✅ `git clone` pre-flight check that validates SSH alias resolves correctly

---

### 3.4 Not Understanding includeIf Matching Rules

**Common mistake:**
```bash
# User's ~/.gitconfig
[includeIf "gitdir:~/work"]  # 🔴 Missing trailing slash
  path = ~/.gitconfig-work

# Clone repo:
cd ~/work
git clone git@github-work:org/repo.git
cd repo
git config user.email
# 🔴 Shows personal email - includeIf didn't match
```

**Why:**
- `gitdir:~/work` matches `~/work/.git` ONLY
- `gitdir:~/work/` matches `~/work/**/.git` (all subdirectories)

**Similar issues:**
- Relative paths vs absolute paths
- `~` expansion inconsistencies
- Case sensitivity on macOS (filesystem vs Git)

**What would help:**
- ✅ Tool that validates `includeIf` patterns match expected repos
- ✅ `git config --show-origin user.email` to debug which config was loaded
- ✅ Pre-commit hook warning if identity doesn't match directory

---

### 3.5 HTTPS Users Not Setting `useHttpPath`

**Symptom:** GCM stores one credential for `github.com`, used for all repos

**Why it happens:**
- Default GCM behavior: credentials keyed by hostname only
- `useHttpPath` flag not mentioned in generic multi-account guides
- Users think embedding username in URL is sufficient

**Example failure:**
```bash
# Both URLs point to github.com:
https://personal-user@github.com/personal/repo.git
https://work-user@github.com/company/repo.git

# Without useHttpPath:
# GCM stores one token for "github.com"
# Whichever account authenticates first wins
# Second account's operations fail with 403
```

**Correct setup:**
```bash
git config --global credential.https://github.com.useHttpPath true
```

**What would help:**
- ✅ GCM default to per-path for major hosts (GitHub, GitLab)
- ✅ GCM detect username in URL and auto-enable `useHttpPath`
- ✅ Better error messages on 403: "Token for user X, repo owner Y"

---

## 4. IDE/Editor Authentication Leaks

### 4.1 VS Code / Cursor

**Issue:** Multiple GitHub accounts supported, but account preference is per-extension, not per-workspace

**Behavior:**
- User signs into 2 GitHub accounts in VS Code
- GitHub Copilot uses Account A
- GitHub Pull Requests extension uses Account B
- No per-workspace account binding

**User confusion:**
> "I switch accounts in Settings, but Copilot chat still uses the wrong one"

**Root cause:** VS Code's account preference is stored in `~/.config/Code/User/globalStorage`, not per-workspace

**Workarounds:**
1. `Accounts: Manage Extension Account Preferences` command (VS Code 1.85+)
2. Right-click extension → Account Preferences
3. Sign out of all accounts, sign in again in specific order

**Failure modes:**
- Account preference doesn't persist across VS Code restarts
- Changing preference for one extension doesn't update linked extensions (Copilot + Copilot Chat out of sync)
- Order of sign-in determines default (confusing)

**What would help:**
- ✅ Per-workspace account preferences (tied to `.vscode/settings.json`)
- ✅ Detect `includeIf` from git config and auto-select matching account
- ✅ Extension manifest declares "linked" extensions that share account preference

**Evidence:** [VS Code Issue #256635](https://github.com/microsoft/vscode/issues/256635), [VS Code Issue #127967](https://github.com/microsoft/vscode/issues/127967), [VS Code Issue #291504](https://github.com/microsoft/vscode/issues/291504)

---

### 4.2 JetBrains IDEs (IntelliJ, PyCharm, WebStorm, etc.)

**Issue:** No native per-project account switching

**Behavior:**
- Settings → Version Control → GitHub: can add multiple accounts
- No UI to set "default account for this project"
- Push/pull typically use first-added account
- Must manually select account on each operation

**Workarounds:**
1. Community plugin: **GitHub Account Switcher**
   - Status bar widget to switch accounts per project
   - Automatically sets `user.name`/`user.email` in local git config
   - Stores active account in `.idea/` (not committed)
   - Manipulates `url.insteadOf` to route to correct token

2. Manual: Delete and re-add accounts in specific order

**Failure modes:**
- Plugin required for basic multi-account workflow
- No integration with Git's `includeIf`
- SSH-based workflows ignored (plugin assumes HTTPS tokens)

**What would help:**
- ✅ Native per-project default account setting
- ✅ Detect git remote URL, auto-select matching account
- ✅ Detect SSH config alias, show which account it maps to

**Evidence:** [Stack Overflow #67074745](https://stackoverflow.com/questions/67074745/how-do-i-manage-multiple-github-accounts-with-intellij-rubymine-etc), [Medium: GitHub Account Switcher](https://medium.com/@syedfarook/stop-re-entering-github-tokens-in-jetbrains-ides-27966e96fc70)

---

### 4.3 Xcode

**Issue:** `includeIf` support completely broken

**Symptom:** Presence of `includeIf` in `.gitconfig` breaks Swift Package Manager (SPM)

**Behavior:**
- Xcode's embedded git doesn't parse `includeIf` correctly
- SPM initial clones and updates fail
- Must remove `includeIf` blocks to use Xcode

**Workaround:** None (as of last report)

**What would help:**
- ✅ Xcode update libgit2 to version that supports `includeIf`
- ✅ Xcode use system git instead of bundled version

**Evidence:** [HN Discussion](https://news.ycombinator.com/item?id=37902614#37903867)

---

### 4.4 Git Cola, GitKraken, Tower, etc.

**Issue:** Third-party GUI clients often bypass SSH config

**Behaviors:**
- Some use system git → inherits SSH config ✅
- Some use embedded git → ignores `~/.ssh/config` ❌
- Some use HTTPS only → requires GCM setup
- Some have separate account managers → not synced with command-line

**What would help:**
- ✅ Document which clients respect `~/.ssh/config`
- ✅ Clients detect and warn about SSH host aliases

**Evidence:** [HN Discussion](https://news.ycombinator.com/item?id=36768334#36769174)

---

## 5. CI vs Local Development Differences

### 5.1 `GITHUB_TOKEN` in GitHub Actions

**Local:** User-configured PAT or SSH key  
**CI:** Automatically injected `GITHUB_TOKEN` secret

**Key differences:**

| Aspect | Local | GitHub Actions |
|--------|-------|----------------|
| **Token scope** | User's PAT with chosen permissions | Auto-generated, repository-scoped |
| **Token lifetime** | Persistent until revoked | Expires at end of job (max 6 hours) |
| **Identity** | User's account | `github-actions[bot]` |
| **Permissions** | Controlled by PAT | Controlled by workflow `permissions:` block |
| **Triggers workflows** | Yes (when pushing) | No (prevents recursive workflows) |

**Common failure mode:** CI push doesn't trigger downstream workflows

**Why:**
```yaml
# User expects this to trigger another workflow:
- name: Update docs
  run: |
    git commit -m "Auto-update docs"
    git push
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# 🔴 Push succeeds, but doesn't trigger workflows
# 🔴 Documented GitHub limitation to prevent infinite loops
```

**Workarounds:**
- Use a PAT instead of `GITHUB_TOKEN`
- Use GitHub App installation token
- Separate "push" workflow from "process push" workflow

---

### 5.2 Git Identity in CI

**Local:** Configured via `includeIf` or per-repo config  
**CI:** No identity by default

**Common error:**
```bash
# CI logs:
Author identity unknown

*** Please tell me who you are.

Run

  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"
```

**Why:** `GITHUB_TOKEN` is for authentication, not identity

**Solution:**
```yaml
- name: Configure git
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
```

---

### 5.3 SSH in CI Requires Manual Key Injection

**Local:** SSH keys in `~/.ssh/`, agent loaded  
**CI:** Ephemeral runner, no persistent keys

**Setup:**
```yaml
- name: Setup SSH
  uses: webfactory/ssh-agent@v0.8.0
  with:
    ssh-private-key: ${{ secrets.SSH_PRIVATE_KEY }}
```

**Issue:** Secrets are repository-scoped - can't share deploy keys across repos in an org without duplicating

**What would help:**
- ✅ Organization-level secrets for deploy keys
- ✅ GitHub App with repository access (avoids SSH entirely)

---

### 5.4 Submodules in CI with Multiple Accounts

**Problem:** Main repo and submodule hosted in different GitHub orgs, require different auth

**Local:** SSH host aliases + `.gitmodules` with aliases works  
**CI:** Must configure both keys, both host aliases in ephemeral environment

**Current approach:** Complex workflow
```yaml
- name: Setup SSH for multiple accounts
  run: |
    mkdir -p ~/.ssh
    echo "${{ secrets.MAIN_REPO_KEY }}" > ~/.ssh/id_main
    echo "${{ secrets.SUBMODULE_KEY }}" > ~/.ssh/id_sub
    cat >> ~/.ssh/config <<EOF
    Host github-main
      HostName github.com
      IdentityFile ~/.ssh/id_main
    Host github-sub
      HostName github.com
      IdentityFile ~/.ssh/id_sub
    EOF
    chmod 600 ~/.ssh/id_*
```

**What would help:**
- ✅ Actions runner pre-configured with common multi-account patterns
- ✅ `actions/checkout` action supports multiple SSH keys

---

## 6. Gaps No Product Fully Closes

### 6.1 Clone-Time Account Selection

**Problem:** Account must be chosen *before* cloning, but user might not know which account owns repo

**Current state:**
- SSH alias approach: Must manually edit clone URL to use `git@github-work:` alias
- HTTPS approach: Must manually edit clone URL to include `https://username@`
- Tools like `zit`, `gitprofile`: Require custom clone wrapper (`zit clone`, `gitprofile clone`)

**User expectation:**
> "I copy URL from GitHub UI, paste into terminal, get prompted for account"

**Gap:**
- ✅ No tool intercepts standard `git clone github.com/...`
- ✅ No tool queries GitHub API: "Which of my accounts can access this repo?"
- ✅ No tool remembers: "Last time I cloned from `user/org`, I used account X"

**Ideal solution:**
```bash
git clone git@github.com:org/repo.git
# → Tool detects: Both personal & work accounts can access "org"
# → Prompt: "Clone as [1] personal or [2] work?"
# → Automatically use correct SSH alias or credential
```

---

### 6.2 Security: Accidental Token/Key Leakage

**Scenarios:**

1. **PAT in HTTPS URL accidentally committed:**
   ```bash
   # User sets remote with token:
   git remote set-url origin https://user:ghp_token123@github.com/org/repo.git
   
   # Later, teammate clones, runs:
   git remote -v
   # → Token exposed in .git/config (committed in some tools)
   ```

2. **`.envrc` with `GH_TOKEN` committed to git:**
   - direnv users create `.envrc` with tokens
   - Forget to add to `.gitignore`
   - Push to public repo

3. **Clone2Leak vulnerability:**
   - Malicious repo with crafted `.gitmodules`
   - Causes git to send credentials to attacker-controlled host
   - Affects GCM, gh CLI as credential helper

**Current mitigations:**
- GitHub scans for accidentally committed PATs, auto-revokes
- `.envrc` in default `.gitignore` templates
- Git 2.45+ adds `credential.protectProtocol` config (not enabled by default)

**Gaps:**
- ✅ No warning when token is in URL
- ✅ No lint rule for "hardcoded credential in git config"
- ✅ `credential.protectProtocol` not enabled by default
- ✅ No tool prevents `.envrc` commit

**Evidence:** [Clone2Leak research](https://flatt.tech/research/posts/clone2leak-your-git-credentials-belong-to-us/)

---

### 6.3 Onboarding: No Single Setup Wizard

**Current state:** Users must manually configure 5+ separate systems:

1. Generate SSH keys (per account)
2. Add public keys to GitHub (per account)
3. Configure `~/.ssh/config` (host aliases, IdentitiesOnly)
4. Configure `~/.gitconfig` (includeIf blocks)
5. Create per-directory `.gitconfig-work`, `.gitconfig-personal` files
6. Optional: GPG signing keys
7. Optional: Configure credential helper
8. Optional: Configure IDE account preferences

**Tools provide partial automation:**
- `gity-tool`, `zit`, `gitprofile`: Automate SSH + Git config
- `git-account-cli`: Automates SSH + local config per folder
- `gitmux`: Automates full config (one-time wizard)

**Gaps:**
- ✅ No tool integrates with IDE account preferences
- ✅ No tool validates end-to-end (SSH auth → git identity → commit signing → push)
- ✅ No tool checks for conflicts (multiple credential helpers, ControlMaster issues)
- ✅ No "doctor" command to diagnose misconfigurations

**Ideal tool:**
```bash
git-multi-account setup

# Interactive wizard:
# 1. Detect existing SSH keys
# 2. Prompt for account details (email, GitHub username)
# 3. Generate keys if needed
# 4. Test SSH authentication
# 5. Generate includeIf config
# 6. Validate directory structure
# 7. Test commit identity
# 8. Detect and configure IDEs (VS Code, JetBrains)
# 9. Generate pre-commit hooks for validation

git-multi-account doctor
# → Checks for common issues:
#   - Multiple credential helpers
#   - Missing IdentitiesOnly
#   - includeIf patterns not matching repos
#   - Commit signing key mismatches
```

---

### 6.4 No Enforcement: Silent Failures

**Problem:** Git allows operations with wrong identity - no warnings

**Scenarios:**

1. **User outside configured directory:**
   ```bash
   cd /tmp
   git clone git@github-work:org/repo.git
   cd repo
   git config user.email  # → Falls back to global config (personal email)
   # 🔴 No warning - commit will use wrong identity
   ```

2. **User forgets SSH alias in clone URL:**
   ```bash
   cd ~/work  # includeIf configured for work identity
   git clone git@github.com:org/repo.git  # 🔴 Should use github-work alias
   # → Uses default SSH key (personal account)
   # → Push succeeds, commit attributed to personal account
   ```

3. **Pre-commit hooks not installed:**
   - Some tools provide hooks to validate identity
   - User must manually run "install hooks" command
   - Easy to forget, especially in existing repos

**Gaps:**
- ✅ No git-level enforcement of identity matching authentication
- ✅ No warning when commit email doesn't match SSH key's GitHub account
- ✅ No protection against cloning with wrong URL pattern

**What would help:**
- ✅ Git config: `identity.enforce = true` → fails commit if identity misconfigured
- ✅ Pre-push hook (installable globally): validates commit authors match push account
- ✅ Shell integration that validates `git clone` URL before executing

---

### 6.5 Documentation Gap: Authentication vs Identity

**Core confusion:** Users conflate two separate systems

| System | Purpose | Configured by | Affects |
|--------|---------|--------------|---------|
| **Authentication** | Proves you're allowed to push | SSH keys, PATs, GCM | `git push`, `git fetch` |
| **Identity** | Records who authored commit | `user.name`, `user.email` | Commit metadata, GitHub attribution |

**User mental model:** "I use my work SSH key, so commits should be attributed to my work account"

**Reality:** SSH key determines *authentication*, `user.email` in commit metadata determines *attribution*

**Why this matters:**
- Fixing SSH alone doesn't fix commit attribution
- Users think they've solved multi-account when they've only solved authentication

**Documentation gap:**
- Most guides title themselves "Multiple GitHub accounts with SSH"
- Focus heavily on SSH key setup
- Identity configuration (includeIf) treated as optional or separate section
- Users stop reading after "SSH works"

**What would help:**
- ✅ Guides explicitly: "Part 1: Authentication (SSH), Part 2: Identity (Git config)"
- ✅ Tools fail with clear error: "Authentication succeeded as X, but commits will be attributed to Y"
- ✅ `git push` displays: "Authenticated as: work-user, Commit author: personal@example.com" ⚠️

---

### 6.6 No Standard for Clone URL Rewriting

**Problem:** Different tools use different URL rewriting strategies

**Approaches:**

1. **SSH host aliases** (classic)
   - URL: `git@github-work:org/repo.git`
   - Requires: Manual edit of clone URL or `.gitmodules`

2. **Global `url.insteadOf`:**
   ```bash
   git config --global url."git@github-work:org/".insteadOf "git@github.com:org/"
   ```
   - Works for one org, breaks for repos outside that org

3. **Per-directory `url.insteadOf` in `includeIf` config:**
   ```bash
   # ~/.gitconfig-work
   [url "git@github-work:"]
     insteadOf = git@github.com:
   ```
   - Only affects repos in that directory, but *after* clone

4. **`core.sshCommand` in `includeIf` config:**
   ```bash
   # ~/.gitconfig-work
   [core]
     sshCommand = ssh -i ~/.ssh/id_work -o IdentitiesOnly=yes
   ```
   - No URL modification, works with standard `github.com` URLs
   - But doesn't solve clone-time selection

**No consensus on "best practice" - each has tradeoffs:**

| Approach | Clone-time | Standard URLs | Submodules | Tools |
|----------|-----------|---------------|------------|-------|
| Host alias | ❌ Manual | ❌ Custom | ⚠️ Must edit `.gitmodules` | All tools |
| `url.insteadOf` (global) | ✅ | ✅ | ✅ | All tools |
| `url.insteadOf` (conditional) | ❌ | ✅ | ❌ Post-clone only | Git 2.13+ |
| `core.sshCommand` | ❌ | ✅ | ⚠️ Needs `includeIf` in submodule | Git 2.10+ |

---

## 7. Actionable Product Requirements (Implied by Pain Points)

### 7.1 Core Requirements

#### P0: End-to-End Setup Wizard
**Pain point addressed:** No single tool configures authentication + identity + validation

**Requirements:**
- Detect existing SSH keys and Git config
- Prompt for account details (GitHub username, email, directory mapping)
- Generate SSH keys if needed, upload to GitHub via API
- Configure SSH config, Git includeIf, signing keys atomically
- Run end-to-end validation (SSH auth → clone → commit → push → verify attribution)
- Output actionable error messages for each failure
- Support HTTPS + GCM workflow as alternative to SSH

**Success criteria:**
- User runs one command, answers prompts, has working multi-account setup
- "Doctor" mode validates existing setup, fixes common issues

---

#### P0: Clone-Time Account Selector
**Pain point addressed:** Users copy GitHub URLs, clone without account awareness

**Requirements:**
- Intercept `git clone git@github.com:org/repo.git` (or wrap it)
- Query GitHub API: "Which of my authenticated accounts can access this repo?"
- Prompt: "Clone as [1] personal-user or [2] work-user?"
- Automatically rewrite URL to use correct SSH alias or credential
- Remember choice: "org/repo → account mapping" for future clones
- Support both SSH and HTTPS workflows

**Success criteria:**
- User clones repo with standard URL, tool ensures correct account is used
- No manual URL editing required
- Works with submodules (applies same logic recursively)

---

#### P1: Pre-Commit Identity Validation Hook
**Pain point addressed:** Commits succeed with wrong identity, discovered later

**Requirements:**
- Git hook (installable globally) that runs before commit
- Check: Does `user.email` in repo config match SSH key's GitHub account?
- Check: Does `user.email` match directory-based expectation (e.g., `~/work/` → `@company.com`)?
- Fail commit with clear message: "You're in ~/work/ but committing as personal@example.com"
- Offer to fix: "Update to work@company.com? [Y/n]"
- Bypass flag for emergencies: `git commit --no-verify`

**Success criteria:**
- Prevents wrong-identity commits by default
- User-configurable directory → email mapping
- Clear error messages guide user to fix

---

#### P1: Pre-Push Authentication Validation Hook
**Pain point addressed:** Wrong SSH key used, push fails or succeeds with wrong account

**Requirements:**
- Git hook that runs before push
- Extract authentication info: Which SSH key or credential will be used?
- Extract commit info: Which authors are in commits being pushed?
- Validate: Do commit authors match authenticated account?
- Warn: "Pushing as work-user, but commits authored by personal@example.com"
- Offer to abort push, fix identity, or proceed anyway

**Success criteria:**
- Catches authentication/identity mismatch before push
- Works with SSH keys, HTTPS credentials, and gh CLI tokens
- Configurable strictness (warn vs block)

---

#### P1: IDE Account Sync
**Pain point addressed:** IDE account preferences don't match git config

**Requirements:**
- Detect current project's git identity (from `includeIf` or local config)
- Query IDE's authenticated GitHub accounts (VS Code, JetBrains, etc.)
- Automatically select matching account for GitHub extensions
- Warn if no matching account found: "Project uses work@company.com, but no matching GitHub account in IDE"
- Bi-directional: Changing IDE account updates git config, vice versa

**Success criteria:**
- User opens project, IDE automatically uses correct GitHub account
- No manual "Manage Extension Account Preferences" needed
- Works with Copilot, Pull Requests, Issues, etc.

---

#### P2: Smart URL Rewriting
**Pain point addressed:** No standard approach for clone URLs, submodules break

**Requirements:**
- Configure once: "Personal account → repos under github.com/{user,org1,org2}"
- Configure once: "Work account → repos under github.com/{company,client1}"
- Automatically rewrite URLs at clone time, submodule init, remote add
- Rewriting is bi-directional: tool handles both canonical and aliased URLs
- Persistent mapping database (not per-repo config)

**Success criteria:**
- User clones any repo with standard URL
- Tool automatically applies correct account based on org
- Submodules work without manual `.gitmodules` editing

---

### 7.2 Security Requirements

#### P0: Credential Leak Prevention
**Pain point addressed:** PATs in URLs, `.envrc` files committed, Clone2Leak exploits

**Requirements:**
- **Pre-commit hook:** Block commits containing credentials (PATs, SSH private keys)
- **git config lint:** Warn if credentials in remote URL
- **direnv template:** Auto-generate `.gitignore` entry for `.envrc`
- **Clone validation:** Reject clones from repos with suspicious `.gitmodules` (external hosts)
- **Enable `credential.protectProtocol` by default** in setup wizard

**Success criteria:**
- Significantly reduce accidental credential commits
- Warn users before credentials enter git history
- Mitigate Clone2Leak-style attacks

---

#### P1: Credential Helper Conflict Detection
**Pain point addressed:** Multiple credential helpers cause popup spam, wrong credentials

**Requirements:**
- Detect multiple active credential helpers
- Warn: "Found 2 credential helpers: manager, wincred - this causes conflicts"
- Offer to fix: "Keep only Git Credential Manager? [Y/n]"
- Validate: Kill zombie processes, test single-helper mode

**Success criteria:**
- Users never experience multiple-helper popup spam
- Clear guidance on which helper to keep
- One-click fix for common misconfigurations

---

#### P2: SSH Key Audit
**Pain point addressed:** Users don't know which GitHub account uses which key

**Requirements:**
- Scan `~/.ssh/` for keys
- Query GitHub API: "Which account is this key associated with?"
- Display: "id_ed25519 → personal-user@github.com"
- Warn: "id_rsa_work not uploaded to any GitHub account"
- Detect unused keys: "id_rsa not used in any SSH config block"

**Success criteria:**
- User runs `git-multi-account audit-keys`
- Gets clear mapping of key → account
- Identifies security issues (unused keys, missing uploads)

---

### 7.3 Diagnostic & Recovery Requirements

#### P0: Configuration Doctor
**Pain point addressed:** Users struggle to debug complex multi-system setup

**Requirements:**
- Validate SSH config (host aliases, IdentitiesOnly, ControlMaster)
- Validate Git config (includeIf, credential helpers, identity)
- Validate authentication (test each SSH key, each HTTPS credential)
- Validate identity mapping (check includeIf matches actual repos)
- Validate commit signing (keys uploaded, email matches signing key)
- Generate report: "✅ 4 checks passed, ❌ 2 issues found"
- Offer one-click fixes for each issue

**Success criteria:**
- User runs `git-multi-account doctor`
- Tool identifies root cause of authentication/identity failures
- Provides actionable fix commands

---

#### P1: Repository Health Check
**Pain point addressed:** Users clone repo, work for weeks, discover identity was wrong

**Requirements:**
- Run in existing repo: `git-multi-account check`
- Validate: Remote URL matches intended account?
- Validate: Local git config identity matches remote account?
- Validate: All commits in history have consistent identity?
- Validate: Commit signing keys match commit emails?
- Report issues: "Warning: 12 commits by personal@example.com in work repo"
- Offer fix: Rewrite history (dangerous) or document discrepancy

**Success criteria:**
- Early detection of identity mismatches
- Prevents wrong-account commits from accumulating
- Clear guidance on remediation

---

#### P2: Interactive Migration Tool
**Pain point addressed:** Users have 50+ repos, can't manually fix each one

**Requirements:**
- Scan all repos in `~/code/`
- Detect remote URLs, current identity, commit history
- Prompt: "Found 12 personal repos in ~/work/ - migrate to personal folder?"
- Automate: Move repos, fix remote URLs, update identity, test
- Batch mode: Apply same fix to all matching repos

**Success criteria:**
- User migrates from ad-hoc setup to organized multi-account structure
- Tool handles bulk operations safely
- Rollback if errors occur

---

### 7.4 User Experience Requirements

#### P0: Clear Mental Model in Documentation
**Pain point addressed:** Users conflate authentication and identity

**Requirements:**
- Every guide must separate: "Part 1: Authentication" and "Part 2: Identity"
- Use consistent terminology:
  - **Authentication:** Which account can push (SSH keys, PATs)
  - **Identity:** Who authored the commit (user.name, user.email)
- Diagrams showing: Git config → Commit metadata → GitHub attribution
- Failure mode examples: "You authenticated as X, but committed as Y - here's why"

**Success criteria:**
- User reads guide, understands two separate systems
- Reduced confusion in community forums

---

#### P1: Better Error Messages
**Pain point addressed:** `Permission denied (publickey)` doesn't indicate root cause

**Requirements:**
- Git operations show: "Authenticated as: work-user"
- SSH errors show: "Tried key: ~/.ssh/id_rsa → github.com user: personal-user"
- Git push shows: "Push account: work-user, Commit author: personal@example.com ⚠️"
- Clone failures suggest: "Did you mean to clone as work-user? Try: git clone git@github-work:..."

**Success criteria:**
- Users can self-diagnose authentication vs identity issues
- Error messages guide to solution, not just report failure

---

#### P2: Shell Integration
**Pain point addressed:** No feedback on current account context

**Requirements:**
- Zsh/Bash prompt shows: Current git identity in this directory
- Example: `~/work/repo (work@company.com) $`
- Color-coded: Green = matches directory expectation, Red = mismatch
- Tab completion for SSH aliases in `git clone` commands
- Shell function: `git whoami` → shows authentication + identity info

**Success criteria:**
- User always knows which account they're operating as
- Visual feedback prevents mistakes before they happen

---

## 8. Competitive Analysis: What a Complete Solution Would Provide

**No existing tool provides all of:**
1. ✅ Setup wizard (authentication + identity + validation)
2. ✅ Clone-time account selection (automatic or prompted)
3. ✅ Pre-commit/pre-push hooks (identity validation)
4. ✅ IDE integration (auto-sync account preferences)
5. ✅ Configuration doctor (diagnose + fix issues)
6. ✅ Security (credential leak prevention, audit)
7. ✅ Migration tool (bulk repo fixes)

**Closest tools:**
- **SSH + includeIf (manual):** Covers 1, 2, 3 (with effort), 6 (partially)
- **gity-tool / zit / gitprofile:** Covers 1, 2 (wrapper only)
- **gh CLI:** Covers authentication only (not identity, not per-directory)
- **GCM:** Covers authentication only (HTTPS), no identity management

**Market opportunity:** **End-to-end multi-account git identity tool**
- One command setup
- Works with standard `git clone` URLs (no wrapper required)
- Prevents silent failures (validation hooks)
- Works across SSH, HTTPS, IDEs, CI
- Clear mental model, excellent error messages

---

## 9. Summary: Key Takeaways

### Pain Points by Severity

**Critical (Breaks workflows):**
1. Clone-time account selection failure → wrong-account clones
2. Authentication vs Identity confusion → wrong-account commits
3. IDE account preferences don't sync → random account selection
4. No validation hooks → silent failures discovered weeks later

**High (Frequent user errors):**
5. Missing `IdentitiesOnly yes` → SSH offers wrong key
6. Submodule URLs don't match main repo account
7. Multiple credential helpers → popup spam, race conditions
8. `includeIf` doesn't match repos → fallback to global (wrong) config

**Medium (Annoying, but workarounds exist):**
9. No setup wizard → manual multi-system configuration
10. GPG signing key mismatch → unverified commits
11. ControlMaster persistence → cross-account contamination
12. CI differences → local configs don't apply

### Most-Requested Features

1. **"Just make `git clone` work with normal URLs"** - automatic account selection
2. **"Warn me before I commit with the wrong identity"** - pre-commit validation
3. **"One command to set everything up"** - setup wizard
4. **"Tell me which account I'm using right now"** - shell prompt integration
5. **"Fix my existing repos automatically"** - migration tool

### Architectural Insight

**The core problem is not lack of primitives** (Git, SSH, OS credential managers provide everything needed)

**The core problem is:**
- **Primitives are scattered across 5+ systems** (SSH, Git, GCM, gh, IDE)
- **No orchestration layer** to configure them atomically
- **No validation layer** to prevent silent failures
- **No user-facing abstraction** - users must understand internal details

**A complete solution must:**
1. Abstract away SSH config, Git config, credential helpers
2. Present single interface: "Add account X for directory Y"
3. Automatically configure all underlying systems
4. Validate end-to-end: setup → clone → commit → push → GitHub attribution
5. Provide feedback: "You're operating as X in this directory"

---

## 10. References & Sources

**Official Documentation:**
- [Git Credential Manager: Multiple Users](https://github.com/GitCredentialManager/git-credential-manager/blob/main/docs/multiple-users.md)
- [GitHub Docs: Managing Multiple Accounts](https://docs.github.com/en/account-and-profile/how-tos/account-management/managing-multiple-accounts)
- [GitHub CLI: Multiple Accounts](https://github.com/cli/cli/blob/trunk/docs/multiple-accounts.md)

**Tools (Verified):**
- [gity-tool](https://github.com/YRACHEK101/gity-tool) - npm: gity-tool
- [zit](https://github.com/Hypercodingdev/zit) - npm: @hypercodingdev/zit
- [gitprofile (meanii)](https://github.com/meanii/gitprofile) - npm: gitprofile
- [git-account-cli](https://www.npmjs.com/package/git-account-cli) - npm: git-account-cli
- [git-profiles](https://pypi.org/project/git-profiles/) - pip: git-profiles
- [GitMux](https://github.com/wd006/gitmux) - standalone bash script

**Community Discussions (Primary Sources):**
- [Stack Overflow: Multiple GitHub Accounts & SSH Config](https://stackoverflow.com/questions/3225862/multiple-github-accounts-ssh-config) - 1,647 votes
- [Stack Overflow: Maintaining Two GitHub User Accounts](https://stackoverflow.com/questions/38728827/maintaining-two-github-user-accounts)
- [Hacker News: Multiple GitHub Accounts](https://news.ycombinator.com/item?id=47099044)
- [VS Code Issue #127967: Multiple GitHub Account Support](https://github.com/microsoft/vscode/issues/127967)
- [GitHub CLI Issue #8875: Multi-account git credential support](https://github.com/cli/cli/issues/8875)

**Security Research:**
- [Clone2Leak: Git Credentials Vulnerability](https://flatt.tech/research/posts/clone2leak-your-git-credentials-belong-to-us/)
- [MankhongGarden: GCM Multi-Account Troubleshooting](https://github.com/MankhongGarden/git-credential-manager-windows-multi-account)

**DEV Community Guides:**
- [Managing Multiple Git Identities](https://dev.to/victorbruce/managing-multiple-git-identities-a-seamless-workflow-for-personal-and-work-accounts-1kce)
- [Stop Committing with the Wrong Email](https://dev.to/francoislp/stop-committing-with-the-wrong-email-multiple-git-configs-for-github-5e9i)
- [My Commits Were Linked to the Wrong Account](https://dev.to/rehan_sayyed_56704d24727b/my-git-commits-were-linked-to-the-wrong-github-account-heres-why-b5k)

**Gists & Tutorials:**
- [muquit/multiple-github-accounts](https://github.com/muquit/multiple-github-accounts)
- [Managing multiple GitHub accounts for cloning and commit signing](https://gist.github.com/robandpdx/68bab0c65d2e2dcf096769dcb33c79f2)
- [Auto-switching Git identities with direnv](https://gist.github.com/Drizzt321/47cf383a19535940a26616d982783d2e)

---

**Research Conducted:** August 8, 2026  
**Methodology:** Primary source documentation, community forums, tool repositories verified  
**No capabilities invented** - all tool features verified from official docs/repos
