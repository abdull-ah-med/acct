# Research cites — Node `execPath`, timing-safe compare, `wx` exclusive create (2026-08-16)

Fetched from primary sources before implementation. No memory-only justifications. Quotes are from the pages as retrieved on 2026-08-16.

Archive convention: both CLI and web research notes live under `acct/docs/research/` (`acct-web` has no `docs/` research folder; only the marketing `/docs` route).

Node docs retrieved: [Process](https://nodejs.org/api/process.html) / [Crypto](https://nodejs.org/api/crypto.html) / [File system](https://nodejs.org/api/fs.html) / [Child process](https://nodejs.org/api/child_process.html) as **Node.js v26.7.0**.

| Fact | Source |
|------|--------|
| `process.execPath` is the absolute pathname of the executable that started this Node process; symlinks are resolved | https://nodejs.org/api/process.html#processexecpath |
| Unqualified command names are looked up on `PATH`; `child_process.fork()` uses `process.execPath` instead | https://nodejs.org/api/child_process.html ; POSIX.1-2017 Command Search and Execution |
| Git hooks are executable programs; bundled examples are shell scripts | https://git-scm.com/docs/githooks ; https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks |
| `crypto.timingSafeEqual(a, b)` requires the same byte length or it **throws**; Node calls it suitable for HMAC digests | https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b |
| Node does **not** prescribe “HMAC both unknown-length secrets then compare” | same page (constraint + HMAC-digest suitability only) |
| OWASP: HMAC-SHA256 then `constantTimeEquals` on the HMAC outputs | https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html |
| `'wx'` = write, fail if path exists (`O_EXCL`); not a general lock; may fail on NFS | https://nodejs.org/api/fs.html#file-system-flags |
| `fs.access()` then `open()` is a documented race; open `'wx'` directly | https://nodejs.org/api/fs.html#fsaccesspath-mode-callback |

---

## 1. `process.execPath`

Source: https://nodejs.org/api/process.html#processexecpath (Node.js v26.7.0)

> The `process.execPath` property returns the absolute pathname of the executable that started the Node.js process. Symbolic links, if any, are resolved.

Example given on that page:

```json
"/usr/local/bin/node"
```

Related (same document, `process.argv`): the first element of `process.argv` is `process.execPath`.

This is **this process’s Node binary**, not “whatever `node` is on `PATH`”.

---

## 2. Why hooks should bake `execPath`, not `node` on `PATH`

### 2.1 Node: absolute exec path vs PATH lookup

`process.execPath` is already an absolute pathname (§1).

Node’s own child-process API treats those two cases differently.

**PATH lookup** — https://nodejs.org/api/child_process.html (v26.7.0):

> The command lookup is performed using the `options.env.PATH` environment variable if `env` is in the `options` object. Otherwise, `process.env.PATH` is used. If `options.env` is set without `PATH`, lookup on Unix is performed on a default search path search of `/usr/bin:/bin` (see your operating system's manual for execvpe/execvp), on Windows the current processes environment variable `PATH` is used.

**`fork()` uses `execPath`, not `PATH` `node`** — same page:

> By default, `child_process.fork()` will spawn new Node.js instances using the process.execPath of the parent process. The `execPath` property in the `options` object allows for an alternative execution path to be used.

So when Node wants another Node, it does **not** spawn the string `node` for PATH to resolve. It uses the absolute `process.execPath`.

### 2.2 Git hooks run as programs; typical form is a shell script

https://git-scm.com/docs/githooks (retrieved 2026-08-16; page “last updated in 2.54.0”):

> Hooks are programs you can place in a hooks directory to trigger actions at certain points in git’s execution. Hooks that don’t have the executable bit set are ignored.

> By default the hooks directory is `$GIT_DIR/hooks`, but that can be changed via the `core.hooksPath` configuration variable (see git-config[1]).

> Before Git invokes a hook, it changes its working directory to either $GIT_DIR in a bare repository or the root of the working tree in a non-bare repository.

https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks (*Pro Git* 2nd ed., §8.3):

> All the examples are written as shell scripts, with some Perl thrown in, but any properly named executable scripts will work fine – you can write them in Ruby or Python or whatever language you are familiar with.

> To enable a hook script, put a file in the `hooks` subdirectory of your `.git` directory that is named appropriately (without any extension) and is executable.

A generated hook that contains `node …/cli.js` is therefore typically a **shell script**. The shell, not Git’s Node-awareness, looks up `node`.

### 2.3 POSIX: unsashed `node` is a PATH search; a path with a slash is not

POSIX.1-2017 *Shell Command Language*, Command Search and Execution  
https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html

Raw HTML (entities unescaped) from that page, 2026-08-16:

> If the command name does not contain any \<slash\> characters, the first successful step in the following sequence shall occur:

Then (after special builtins / functions):

> Otherwise, the command shall be searched for using the PATH environment variable as described in XBD Environment Variables:

And:

> If the command name contains at least one \<slash\>, the shell shall execute the utility in a separate utility environment with actions equivalent to calling the execl() function defined in the System Interfaces volume of POSIX.1-2017 with the path and arg0 arguments set to the command name […]

### 2.4 What this justifies (and what it does not)

**Justified from the cites:** a hook body should invoke `process.execPath` (absolute, symlink-resolved) rather than the unsashed token `node`. Unqualified `node` is a PATH search whose result depends on the environment Git inherited when it invoked the hook. Git does not document that it rewrites `PATH` to the installing user’s interactive shell PATH. GUI / IDE / `launchd` Git often has a shorter PATH than a login shell; `node` may be missing, a different version, or a different binary.

**Not claimed (no primary source here):** that Git always runs hooks *via* `/bin/sh -c` (hooks are “programs”; a shebang `#!/bin/sh` is typical of Git’s samples, not a documented requirement). Do not claim `execPath` is a security boundary against a fully compromised PATH of the hook process itself if the hook later calls other unsashed tools.

---

## 3. `crypto.timingSafeEqual` — same length or it throws

Source: https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b (Node.js v26.7.0)

> This function compares the underlying bytes that represent the given `ArrayBuffer`, `TypedArray`, or `DataView` instances using a constant-time algorithm.

> This function does not leak timing information that would allow an attacker to guess one of the values. This is suitable for comparing HMAC digests or secret values like authentication cookies or capability urls.

> `a` and `b` must both be `Buffer`s, `TypedArray`s, or `DataView`s, and they must have the same byte length. **An error is thrown if `a` and `b` have different byte lengths.**

> Use of `crypto.timingSafeEqual` does not guarantee that the surrounding code is timing-safe. Care should be taken to ensure that the surrounding code does not introduce timing vulnerabilities.

### 3.1 Node does not prescribe HMAC-then-compare for unknown-length secrets

The page above:

- **Requires** equal byte length; otherwise it **throws** (not “returns false”).
- **Names HMAC digests** as a suitable input (HMAC outputs are fixed length for a given algorithm).
- **Does not** say: hash both attacker-controlled and stored secrets with HMAC/SHA-256, then `timingSafeEqual` the digests, in order to hide length.

An early `if (a.length !== b.length) return false` **or** an uncaught throw on length mismatch is surrounding control flow. Node explicitly warns that surrounding code can reintroduce timing leaks. This note does **not** invent a Node-endorsed dummy-compare or double-HMAC recipe.

### 3.2 Closest first-party HMAC + constant-time compare: OWASP CSRF cheat sheet

https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html  
section “Employing HMAC CSRF Tokens” / “Pseudo-Code For Implementing HMAC CSRF Tokens” (retrieved 2026-08-16):

> HMAC is preferred over simple hashing in all cases as it protects against various cryptographic attacks.

Generation (quoted structure):

> `hmac = hmac("SHA256", secret, message) // Generate the HMAC hash`

Verification:

> `if (!constantTimeEquals(hmacFromRequest, expectedHmac)) {`

> Note: The `constantTimeEquals` function should be used to compare the HMACs to prevent timing attacks. This function compares two strings in constant time, regardless of how many characters match.

That is **HMAC-SHA256 of a well-defined message, then constant-time compare of the two HMAC outputs** (same length by construction). It is **not** a documented recipe for “HMAC both raw secrets of unknown length so `timingSafeEqual` will not throw.”

### 3.3 Node HMAC primitive (fixed-length digest)

https://nodejs.org/api/crypto.html#cryptocreatehmacalgorithm-key-options

> Creates and returns an `Hmac` object that uses the given `algorithm` and `key`.

> The `algorithm` is dependent on the available algorithms supported by the version of OpenSSL on the platform. Examples are `'sha256'`, `'sha512'`, etc.

The same page’s example uses `createHmac('sha256', 'a secret')` then `hmac.digest('hex')`.

**Implementer reading that is *not* in Node/OWASP as a single recipe:** if you must `timingSafeEqual` two values whose lengths may differ, you cannot pass them to `timingSafeEqual` directly. Node’s own “suitable for comparing HMAC digests” plus OWASP’s HMAC-then-`constantTimeEquals` is the first-party pairing for **MAC verification**. Do not cite this file as proof that Node or OWASP require hashing both unknown-length cookies/tokens before compare; that specific “blind the length” construction was **not found** in Node docs, OWASP cheat sheets fetched here, or NIST pages fetched for this note.

### 3.4 OWASP authentication (constant-time password compare — different API)

https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html  
“Compare Password Hashes Using Safe Functions”:

> Where this is not possible, ensure that the comparison function:  
> […]  
> - Returns in constant time, to protect against timing attacks.

That is about **password hash verify**, not `timingSafeEqual` on raw tokens.

---

## 4. File exclusive create (`wx`) / TOCTOU — do not over-claim

Source: https://nodejs.org/api/fs.html#file-system-flags (Node.js v26.7.0)

Flag list:

> `'w'`: Open file for writing. The file is created (if it does not exist) or truncated (if it exists).

> `'wx'`: Like `'w'` but fails if the path exists.

> The exclusive flag `'x'` (`O_EXCL` flag in open(2)) causes the operation to return an error if the path already exists. On POSIX, if the path is a symbolic link, using `O_EXCL` returns an error even if the link is to a path that does not exist. **The exclusive flag might not work with network file systems.**

Windows mapping on the same page:

> On Windows, flags are translated to their equivalent ones where applicable, e.g. `O_WRONLY` to `FILE_GENERIC_WRITE`, or `O_EXCL|O_CREAT` to `CREATE_NEW`, as accepted by `CreateFileW`.

`fs.constants.O_EXCL`:

> Flag indicating that opening a file should fail if the `O_CREAT` flag is set and the file already exists.

### 4.1 What Node *does* say about the check-then-act race

https://nodejs.org/api/fs.html#fsaccesspath-mode-callback (same FS document):

> Do not use `fs.access()` to check for the accessibility of a file before calling `fs.open()`, `fs.readFile()`, or `fs.writeFile()`. Doing so introduces a race condition, since other processes may change the file's state between the two calls. Instead, user code should open/read/write the file directly and handle the error raised if the file is not accessible.

The **NOT RECOMMENDED** sample is `access()` then `open(..., 'wx')`. The **RECOMMENDED** sample is `open('myfile', 'wx', …)` and treat `err.code === 'EEXIST'`.

### 4.2 What this is not

Node does **not** document `'wx'` as:

- `flock` / `fcntl` advisory locking,
- a mutex that serializes writers of an **existing** file,
- a portable lock on NFS (it explicitly warns exclusive create “might not work with network file systems”).

Use it as **atomic exclusive create** (fail if the path already exists), which avoids the `access`/`exists` then `open` TOCTOU Node itself calls out. Do not call it “file locking” unless you also cite a lock API (`fs` has no `flock` wrapper in this flags section).
