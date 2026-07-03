# Research Brief: Building Directory-Scoped GitHub Auth CLI ("acct")

**Research Date:** August 8, 2026  
**Sources:** Primary documentation only (git-scm.com, github.com/git-ecosystem/git-credential-manager, OpenSSH man pages)

---

## 1. Git Credential Helper Protocol

### Protocol Overview

Git credential helpers communicate with Git via a simple stdin/stdout text protocol. The helper is invoked with an operation argument (`get`, `store`, or `erase`) and receives/sends credential attributes as key-value pairs.

**Source:** https://git-scm.com/docs/git-credential

### Operations

Git appends one operation argument to the helper command line:

- **`get`** - Return a matching credential if any exists
- **`store`** - Store the credential if applicable to the helper
- **`erase`** - Remove matching credentials from the helper's storage

**Source:** https://git-scm.com/docs/gitcredentials

### Input/Output Format

The credential protocol uses a line-based format where:
- Each line contains a key-value pair: `key=value`
- Lines are terminated by newline
- The stream is terminated by a blank line or EOF
- All bytes are treated as-is (no quoting, cannot transmit newline or NUL)
- Each line cannot exceed 65,535 bytes

**Source:** https://git-scm.com/docs/git-credential

### Standard Attributes

**Protocol attributes passed to helpers:**

| Attribute | Description |
|-----------|-------------|
| `protocol` | Protocol over which credential will be used (e.g., `https`) |
| `host` | Remote hostname including port if specified (e.g., `example.com:8088`) |
| `path` | Path component of the URL (e.g., `foo.git` for `https://example.com/foo.git`) |
| `username` | Username if already known |
| `password` | Password when asking helper to store |
| `url` | Special attribute that Git parses into constituent parts |

**Sources:** 
- https://git-scm.com/docs/git-credential
- https://man7.org/linux/man-pages/man1/git-credential.1.html

### Multi-Valued Attributes

Attributes with keys ending in `[]` can have multiple values. Each instance forms an ordered list. An empty multi-valued attribute (`key[]=\n`) clears previous entries and resets the list.

**Example:** `wwwauth[]` is used to pass multiple WWW-Authenticate headers.

**Source:** https://man7.org/linux/man-pages/man1/git-credential.1.html

### Path Attribute Behavior

**Critical:** Git may remove the `path` attribute when the protocol is HTTP(s) and `credential.useHttpPath` is false (the default). This is the primary mechanism by which credentials "leak" across repositories on the same host.

**Source:** https://git-scm.com/docs/git-credential

### Helper Response Requirements

For a `get` operation:
- Helper can produce a subset of values or even no values if it has nothing to provide
- Any provided attributes overwrite those already known by Git
- If helper outputs `quit` attribute with value `true` or `1`, no further helpers will be consulted
- Unrecognized attributes are silently discarded

For `store` or `erase` operations:
- Helper's output is ignored
- Helper should silently ignore unsupported operations

**Source:** https://git-scm.com/docs/api-credentials

---

## 2. git config credential.* Options

### credential.helper

Specifies external credential helper programs with optional arguments. If helper name is not an absolute path, Git prepends `git credential-` to the string. The result is executed by the shell, so shell quoting is necessary for arguments with special characters.

**Multiple helpers:** If multiple `credential.helper` instances are configured, each helper is tried in turn until Git acquires both username and non-expired password.

**Empty string:** Setting `credential.helper` to empty string resets the helper list to empty, allowing override of lower-priority config.

**Source:** https://git-scm.com/docs/gitcredentials

### credential.useHttpPath

**Default:** `false`

Controls whether Git considers the "path" component of an HTTP/HTTPS URL when matching credentials.

- **`false` (default):** Git uses only protocol, hostname, and port for credential lookup. Credential for `https://example.com/foo.git` will be used for `https://example.com/bar.git`.
- **`true`:** Git includes the full URL path in credential lookup. Each repository path gets its own credential.

**This is the primary control for directory/repository-scoped credentials.**

**Sources:**
- https://git-scm.com/docs/gitcredentials
- https://github.com/git/git/blob/master/Documentation/config/credential.adoc

### credential.username

A default username for a given authentication context, if one is not provided in the URL.

**Source:** https://git-scm.com/docs/gitcredentials

### credential.<url>.* Pattern Matching

Options can be applied selectively to credentials using context-specific configuration with syntax `credential.<url>.*`.

**Example:**
```gitconfig
[credential "https://example.com"]
    username = myusername
```

**Sources:**
- https://git-scm.com/docs/gitcredentials
- https://github.com/git/git/blob/master/Documentation/config/credential.adoc

---

## 3. How Git Chooses Credentials for HTTPS Remotes

### Credential Context Matching

Git considers each credential to have a context defined by a URL. This context is used to look up context-specific configuration and is passed to helpers as an index into secure storage.

**Matching Rules:**
1. **Protocol must match exactly** - `https://example.com` will NOT match `http://example.com`
2. **Hostname must match exactly** - `example.com` will NOT match `foo.example.com` (no subdomain matching)
3. **Port is part of hostname** - Must match if specified
4. **Path matching (when enabled):**
   - Context URL must be a prefix path of the pattern
   - `https://example.com/bar` matches pattern `https://example.com/bar/baz.git`
   - But does NOT match `https://example.com/other/repo.git` or `https://example.com/barry/repo.git`

**Source:** https://git-scm.com/docs/gitcredentials

### Credential Lookup Flow

When Git needs credentials:

1. Generate credential description with context (protocol, host, path)
2. Check configuration for username in matching `credential.<url>.username`
3. Call configured credential helpers with `fill` operation
4. Each helper receives attributes and can return username/password
5. Git stops when it has both username and non-expired password
6. Path attribute may be removed if `credential.useHttpPath` is false

**Source:** https://git-scm.com/docs/git-credential

### Multiple Helper Interaction

If multiple helpers are configured:
- Each helper is tried in order
- First helper to provide both username and password wins
- Later helpers are not consulted
- Helper can return `quit=true` to prevent consultation of subsequent helpers

**Source:** https://git-scm.com/docs/gitcredentials

---

## 4. Git Credential Manager (GCM) Behavior

### Host vs Path Scoping

GCM respects Git's `credential.useHttpPath` setting but has special behavior for certain hosts.

**Default Behavior (useHttpPath=false):**
- Credentials stored by hostname only
- One credential per host, regardless of repository path
- Example: `git:https://github.com` (user = alice) used for all github.com repos

**Path-Scoped Behavior (useHttpPath=true):**
- Credentials stored with full repository URL
- Each repository can have its own credential
- Example: `git:https://github.com/foo/bar` (user = alice) used only for that repo

**Source:** https://github.com/git-ecosystem/git-credential-manager/blob/b62021fd/docs/configuration.md

### Azure DevOps Special Case

GCM automatically sets `credential.useHttpPath` to `true` for `dev.azure.com` hosts after installation because the domain alone is insufficient to determine the correct Azure authentication authority - part of the path is required.

**Caveat:** For `dev.azure.com`, GCM only stores credentials against the `dev.azure.com/org-name` stub, not the full path.

**To use full-path credentials with Azure Repos:** Use `org-name.visualstudio.com` remote URL format instead.

**Source:** https://github.com/git-ecosystem/git-credential-manager/blob/b62021fd/docs/configuration.md

### Multi-Account Support

GCM provides multiple mechanisms for managing multiple accounts on the same host:

1. **Username in URL:** Include username before the `@` sign: `https://user@github.com/repo.git`
2. **credential.<url>.username:** Set default username for a host pattern
3. **credential.useHttpPath=true:** Store separate credentials per repository
4. **credential.namespace:** Use custom namespace prefix for credential storage

**GitHub-specific:** Use `git credential-manager github [list|login|logout]` commands to manage accounts.

**Sources:**
- https://github.com/GitCredentialManager/git-credential-manager/blob/main/docs/multiple-users.md
- https://github.com/git-ecosystem/git-credential-manager/blob/b62021fd/docs/configuration.md

### credential.namespace

GCM uses a namespace prefix when storing credentials in the OS credential store. Format: `{namespace}:{service}`

**Default:** `git`

Can be customized per-host:
```bash
git config --global credential.namespace "my-namespace"
git config --global credential.github.com.namespace "work"
```

**Sources:**
- https://github.com/git-ecosystem/git-credential-manager/blob/b62021fd/docs/configuration.md
- https://github.com/GitCredentialManager/git-credential-manager/blob/main/docs/environment.md

---

## 5. Platform-Specific Credential Storage

### macOS: osxkeychain

**Implementation:** Ships with macOS Git installations. Stores credentials in the macOS Keychain, encrypted with the same system that stores HTTPS certificates and Safari auto-fills.

**Properties:**
- Credentials stored indefinitely
- Encrypted storage
- Never expire unless manually deleted

**Configuration:**
```bash
git config --global credential.helper osxkeychain
```

**Deletion:**
```bash
git credential-osxkeychain erase
host=github.com
protocol=https
[Press Return]
```

**Sources:**
- https://git-scm.com/doc/credential-helpers
- https://git-scm.com/book/en/v2/Git-Tools-Credential-Storage
- https://github.com/github/docs/blob/main/content/get-started/git-basics/updating-credentials-from-the-macos-keychain.md

### Windows: wincred / Windows Credential Manager

**Implementation:** 
- Built-in helper `git-credential-wincred` uses Windows Credential APIs (`wincred.h`)
- Stores data in Windows Credential Manager (Windows Credential Vault in earlier versions)
- Included with Git for Windows

**GCM Store Name:** `wincredman`

**Limitation:** Does not work over SSH sessions. For headless/SSH scenarios, use `dpapi` store instead.

**Configuration:**
```bash
git config --global credential.credentialStore wincredman
```

**Sources:**
- https://git-scm.com/doc/credential-helpers
- https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/credstores.md

### Linux: libsecret / Secret Service API

**Implementation:** Uses `libsecret` library to interact with freedesktop.org Secret Service API. Common backends include GNOME Keyring and KDE Wallet.

**GCM Store Name:** `secretservice`

**Properties:**
- Stores credentials in 'collections'
- Viewable with tools like `secret-tool` and `seahorse`
- Requires graphical interface to unlock secret collections

**Configuration:**
```bash
export GCM_CREDENTIAL_STORE=secretservice
# or
git config --global credential.credentialStore secretservice
```

**Sources:**
- https://git-scm.com/doc/credential-helpers
- https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/credstores.md

### GCM Credential Store Options

GCM supports multiple backend stores across platforms:

| Store Name | Windows | macOS | Linux | Description |
|------------|---------|-------|-------|-------------|
| `wincredman` | ✅ | ❌ | ❌ | Windows Credential Manager |
| `dpapi` | ✅ | ❌ | ❌ | DPAPI-encrypted files |
| `keychain` | ❌ | ✅ | ❌ | macOS Keychain |
| `secretservice` | ❌ | ❌ | ✅ | freedesktop.org Secret Service |
| `gpg` | ❌ | ✅ | ✅ | GPG-encrypted files (pass-compatible) |
| `cache` | ✅ | ✅ | ✅ | Git's built-in credential cache |
| `plaintext` | ✅ | ✅ | ✅ | Plaintext files (INSECURE) |

**Source:** https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/credstores.md

---

## 6. includeIf gitdir Conditions for Conditional Config

### Syntax

Conditional includes allow applying configuration only when conditions are met. The `gitdir` condition matches against the `.git` directory location.

**Format:**
```gitconfig
[includeIf "gitdir:PATTERN"]
    path = /path/to/config.inc
```

**Case-insensitive variant:**
```gitconfig
[includeIf "gitdir/i:PATTERN"]
    path = /path/to/config.inc
```

**Sources:**
- https://github.com/git/git/blob/v2.15.1/Documentation/config.txt
- https://github.com/git/git/commit/3efd0bedc6625a6b194c1f6e5f1b7aa7d8b7e6bb

### Pattern Matching

**Pattern is a glob:**
- Can contain standard glob wildcards
- Can contain `**` for recursive matching
- Trailing `/` matches all repositories inside a directory

**Git directory resolution:**
- May be auto-discovered or come from `$GIT_DIR` environment variable
- For submodules or linked worktrees (via `.git` file), matches the final location of the actual `.git` directory, not the `.git` file location
- Symlinks in `$GIT_DIR` are not resolved before matching

**Source:** https://github.com/git/git/blob/v2.15.1/Documentation/config.txt

### Examples

```gitconfig
# Include for specific repository
[includeIf "gitdir:/path/to/foo/.git"]
    path = /path/to/foo.inc

# Include for all repositories inside a directory
[includeIf "gitdir:/path/to/group/"]
    path = /path/to/foo.inc

# Include for all repositories inside $HOME/to/group
[includeIf "gitdir:~/to/group/"]
    path = /path/to/foo.inc
```

**Relative paths in the included file are always relative to the including file, regardless of the condition.**

**Source:** https://github.com/git/git/blob/v2.15.1/Documentation/config.txt

### Use Case for Multi-Account Setup

Directory-scoped credential configuration is possible:

```gitconfig
# In ~/.gitconfig
[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-work

# In ~/.gitconfig-work
[credential "https://github.com"]
    username = work-account
    helper = !custom-helper-work
```

**Sources:**
- https://github.com/git/git/blob/v2.15.1/Documentation/config.txt
- https://github.com/git/git/commit/3efd0bedc6625a6b194c1f6e5f1b7aa7d8b7e6bb

---

## 7. SSH Configuration Options

### core.sshCommand

Specifies the command Git uses instead of `ssh` for network operations. Introduced in Git 2.10.

**Format:** Same as `GIT_SSH_COMMAND` environment variable (shell-interpreted, allows arguments).

**Precedence:** Environment variable `GIT_SSH_COMMAND` overrides this config setting.

**Configuration:**
```bash
# Global
git config --global core.sshCommand "ssh -i ~/.ssh/id_rsa_work -o IdentitiesOnly=yes"

# Repository-specific
git config core.sshCommand "ssh -i ~/.ssh/id_rsa_personal"
```

**Sources:**
- https://git-scm.com/docs/git-config/2.30.6
- https://stackoverflow.com/questions/4565700/how-to-specify-the-private-ssh-key-to-use-when-executing-shell-command-on-git

### GIT_SSH_COMMAND Environment Variable

Shell-interpreted string that specifies SSH command with arguments. Takes precedence over `core.sshCommand` and `GIT_SSH`.

**Usage:**
```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_rsa_work -o IdentitiesOnly=yes" git clone git@github.com:org/repo.git
```

**Source:** https://git-scm.com/docs/git.html

### GIT_SSH vs GIT_SSH_COMMAND

| Variable | Arguments | Shell Interpretation |
|----------|-----------|----------------------|
| `GIT_SSH` | Not allowed (path to program only) | No |
| `GIT_SSH_COMMAND` | Allowed | Yes |

**Source:** https://git-scm.com/docs/git.html

### ssh.variant

Overrides Git's autodetection of SSH variant (OpenSSH vs PuTTY variants).

**Valid values:** `ssh`, `plink`, `putty`, `tortoiseplink`, `simple`, `auto`

**Can be overridden by:** `GIT_SSH_VARIANT` environment variable

**Command-line parameters by variant:**
- `ssh`: `[-p port] [-4] [-6] [-o option] [username@]host command`
- `simple`: `[username@]host command`
- `plink`/`putty`: `[-P port] [-4] [-6] [username@]host command`
- `tortoiseplink`: `[-P port] [-4] [-6] -batch [username@]host command`

**Source:** https://github.com/git/git/blob/master/Documentation/config/ssh.adoc

### SSH Config: IdentityFile

Specifies which private key files to use for authentication.

**Properties:**
- Multiple `IdentityFile` directives are additive (tried in sequence)
- Can use tilde syntax for home directory
- Can use tokens for dynamic paths
- Setting to `none` prevents any identity files from being loaded
- Default identities: `~/.ssh/id_rsa`, `~/.ssh/id_ecdsa`, `~/.ssh/id_ecdsa_sk`, `~/.ssh/id_ed25519`, `~/.ssh/id_ed25519_sk`

**Source:** https://man7.org/linux/man-pages/man5/ssh_config.5.html

### SSH Config: IdentitiesOnly

Controls whether SSH should ignore keys offered by ssh-agent and only use identities configured in ssh_config or command-line.

**Values:** `yes` or `no` (default: `no`)

**When set to `yes`:**
- SSH only uses configured authentication identities
- Ignores all identities from ssh-agent, PKCS11Provider, or SecurityKeyProvider
- Useful when ssh-agent offers many identities (prevents "too many authentication failures")

**Example:**
```ssh-config
Host github-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_rsa_work
    IdentitiesOnly yes
```

**Sources:**
- https://man7.org/linux/man-pages/man5/ssh_config.5.html
- https://man.openbsd.org/ssh_config.5

### Directory-Scoped SSH with includeIf

Combine `includeIf` with `core.sshCommand` for directory-scoped SSH keys:

```gitconfig
# In ~/.gitconfig
[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-work

# In ~/.gitconfig-work
[core]
    sshCommand = "ssh -i ~/.ssh/id_rsa_work -o IdentitiesOnly=yes"
```

**Sources:** 
- Multiple sources combined (includeIf from Git docs, core.sshCommand from Git config docs)

---

## 8. How Wrong-Account "Leaks" Happen with HTTPS Credential Caching

### Primary Leak Vector: Path Ignored by Default

**Root Cause:** Git's default behavior is to ignore the path component when looking up HTTPS credentials (`credential.useHttpPath=false`).

**Scenario:**
1. User authenticates to `https://github.com/personal/repo.git` with personal credentials
2. Credential helper stores: `protocol=https, host=github.com, username=personal-user`
3. User later clones `https://github.com/work-org/repo.git` in a work directory
4. Git asks helper for credentials with `protocol=https, host=github.com` (path omitted)
5. Helper returns personal credentials because hostname matches
6. **Result:** Personal account credentials used for work repository

**Source:** https://git-scm.com/docs/gitcredentials

### Malicious URL Credential Leak (CVE-2020-11008)

Git can be tricked into sending credentials to an attacker's server through specially-crafted URLs.

**Attack Vector:**
- Malicious URLs with encoded newlines (`%0A`) or syntactic oddities (e.g., `http:///host` with three slashes)
- Git sends "blank" pattern to helpers (missing hostname and protocol fields)
- Many helpers interpret blank pattern as matching any URL
- Helper returns unspecified stored password, leaking to attacker's server

**Vulnerable Helpers:**
- Git's `store` helper
- Git's `cache` helper
- `osxkeychain` helper in Git's contrib directory

**Attack Surface:**
- `git clone` with malicious URLs
- Git submodules (user doesn't see URL)
- Package systems built around Git

**Sources:**
- https://github.com/git/git/security/advisories/GHSA-hjc9-x69f-jqj7
- https://osv.dev/vulnerability/CVE-2020-11008

### Clone2Leak: Crafted Submodule URLs

More sophisticated attack using carriage return characters in URLs:

**Attack Mechanism:**
1. Malicious repository contains submodule URL: `https://\r:@localhost:1234/leak?username=\rprotocol=https\rhost=github.com\r`
2. Git parses `localhost` as host but sends to helper: `host=localhost, username=\rprotocol=https\rhost=github.com\r`
3. Some credential helpers (e.g., GitHub Desktop) parse the `\r`-injected fields and recognize `github.com` as host
4. Helper returns GitHub credential
5. Git sends GitHub credential to `localhost:1234` (attacker-controlled)

**Source:** https://flatt.tech/research/posts/clone2leak-your-git-credentials-belong-to-us/

### Broken Credential Helpers

**GitHub Codespaces Case:** The credential helper script didn't validate requested host, always returning `GITHUB_TOKEN` to any domain hosting repositories, even non-GitHub hosts.

**Lesson:** Custom credential helpers must validate requested host and return credentials only when the host matches.

**Source:** https://flatt.tech/research/posts/clone2leak-your-git-credentials-belong-to-us/

### Mitigations

1. **Use `credential.useHttpPath=true`** for host-level multi-account scenarios
2. **Avoid cloning untrusted repositories** - especially with `--recurse-submodules`
3. **Examine URLs for encoded newlines** (`%0A`) or syntactic oddities before cloning
4. **Keep Git updated** to latest version with security fixes
5. **Use SSH instead of HTTPS** when possible for sensitive repositories
6. **Validate host in custom credential helpers** before returning credentials

**Sources:**
- https://github.com/git/git/security/advisories/GHSA-hjc9-x69f-jqj7
- https://flatt.tech/research/posts/clone2leak-your-git-credentials-belong-to-us/

---

## What a Custom Credential Helper Can/Cannot Do

### Capabilities

A custom credential helper **CAN:**

1. **Store and retrieve credentials** from any backing store (OS keychain, encrypted files, remote API, etc.)
2. **Scope credentials by any combination** of protocol, host, path, username
3. **Implement custom matching logic** beyond Git's default (e.g., pattern matching, wildcards)
4. **Generate credentials dynamically** via API calls or other means
5. **Return partial information** (e.g., just username, letting Git prompt for password)
6. **Return no information** (letting other helpers or prompts handle it)
7. **Terminate helper chain** by returning `quit=true` to prevent subsequent helpers
8. **Use arbitrary storage formats** (JSON, database, etc.) as long as it speaks the credential protocol on stdin/stdout
9. **Implement per-directory logic** by examining current working directory (not passed in protocol but accessible to script)

**Source:** https://git-scm.com/docs/gitcredentials

### Limitations

A custom credential helper **CANNOT:**

1. **Override Git's path-stripping behavior** - If `credential.useHttpPath=false`, Git removes path before calling helper
2. **Force Git to use returned credentials** - Git may consult other helpers or prompt user
3. **Prevent other helpers from being called** - Unless it returns credentials AND `quit=true`
4. **Access Git's internal state** beyond what's passed in the protocol
5. **Modify URL or remote configuration** - Helper only receives/returns credential attributes
6. **Receive notification of failed authentication** - The `erase` operation may be called but isn't guaranteed
7. **Distinguish between same-user different-accounts** on same host without `useHttpPath=true` or username in URL

**Sources:**
- https://git-scm.com/docs/gitcredentials
- https://git-scm.com/docs/git-credential

### Protocol Extensions

Helper can use advanced attributes (requires capability announcement):

- **`authtype`** + **`credential`**: Pre-encoded auth header (e.g., Bearer token)
- **`state[]`**: Opaque state passed back to helper on subsequent calls
- **`continue`**: Indicate multi-stage authentication (NTLM, Kerberos)

**Source:** https://git-scm.com/docs/git-credential

### Best Practices for Custom Helper

1. **Validate host before returning credentials** - Prevents credential leaks
2. **Support all three operations** (`get`, `store`, `erase`) for complete experience
3. **Silently ignore unsupported operations** - Don't fail if user runs `erase` on read-only helper
4. **Use secure storage** - Platform keychain, encrypted files, or memory-only
5. **Handle missing attributes gracefully** - Not all attributes will always be present
6. **Consider returning `quit=true`** if you want to prevent credential prompting

**Sources:**
- https://git-scm.com/docs/gitcredentials
- https://flatt.tech/research/posts/clone2leak-your-git-credentials-belong-to-us/

---

## Platform Differences Summary

| Feature | Windows | macOS | Linux |
|---------|---------|-------|-------|
| **Default Credential Helper** | wincred (via GCM: wincredman) | osxkeychain | None (must install) |
| **GCM Default Store** | wincredman | keychain | None configured |
| **Secure Storage** | Windows Credential Manager | Keychain | Secret Service (GNOME/KDE) |
| **Storage Encryption** | Windows DPAPI | Keychain encryption | Depends on backend |
| **SSH Agent Default** | Pageant (with PuTTY) or ssh-agent | ssh-agent | ssh-agent |
| **SSH Config Location** | `%USERPROFILE%\.ssh\config` | `~/.ssh/config` | `~/.ssh/config` |
| **includeIf Support** | Yes | Yes | Yes |
| **Case Sensitivity** | Case-insensitive filesystem | Case-insensitive (default) | Case-sensitive |

**Sources:**
- https://git-scm.com/doc/credential-helpers
- https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/credstores.md

---

## Unknown / Needs Further Investigation

The following items require investigation in sources not yet consulted:

1. **Exact precedence order** when multiple helpers return different usernames - documentation says "first to provide both username and password" but doesn't specify what happens if helper 1 returns username only and helper 2 returns different username + password
   - **Source needed:** Git source code or credential API documentation

2. **Exact timing of `erase` operation** - Documentation suggests it's called after failed auth, but not clear if all failed auth types trigger it (wrong password vs. expired token vs. insufficient permissions)
   - **Source needed:** Git credential API implementation details

3. **GCM's exact matching algorithm** for partial paths when `useHttpPath=true` on Azure DevOps - docs say it matches on "org-name stub" but don't define exact path prefix matching rules
   - **Source needed:** GCM source code or more detailed Azure Repos documentation

4. **Behavior of multiple includeIf sections** when they overlap or conflict - If multiple `[includeIf]` sections match and set the same option differently, which wins?
   - **Source needed:** Git config precedence documentation or testing

5. **Maximum number of credential helpers** Git will consult before giving up
   - **Source needed:** Git source code or testing

---

## Summary: Building "acct" CLI

Based on this research, a directory-scoped GitHub auth CLI should:

### Architecture
1. **Act as a Git credential helper** - Implement stdin/stdout protocol with get/store/erase operations
2. **Use `includeIf "gitdir:"` patterns** - Configure directory-specific credential helper activation
3. **Maintain credential database** - Map directory patterns to GitHub accounts/tokens
4. **Validate requested host** - Prevent credential leaks by checking protocol/host match expectations
5. **Set `credential.useHttpPath=true`** - Enable path-scoped credentials as an option

### What It Can Control
- Which credential is returned for a given directory
- Whether to store credentials in platform keychain or own database
- Custom matching logic beyond hostname (e.g., organization-based)
- Multi-account management for same host

### What It Cannot Control
- Git's URL parsing and path-stripping behavior
- Other helpers from being consulted (unless it returns quit=true)
- SSH key selection (must use separate core.sshCommand config)

### Integration Approach
```gitconfig
# In ~/.gitconfig
[includeIf "gitdir:~/personal/"]
    path = ~/.gitconfig-acct-personal

[includeIf "gitdir:~/work/"]
    path = ~/.gitconfig-acct-work

# In ~/.gitconfig-acct-work
[credential]
    helper = ""  # Clear defaults
    helper = acct --account=work
    useHttpPath = true
```

**All sources cited throughout document with direct URLs to primary documentation.**
