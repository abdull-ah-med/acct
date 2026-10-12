# Shell integration

Load the generated hook in each interactive shell. Add the matching line to the
startup file shown below; acct does not edit startup files for you.

| Shell | Startup file | Line |
|---|---|---|
| zsh | `~/.zshrc` | `eval "$(acct hook zsh)"` |
| bash | `~/.bashrc` | `eval "$(acct hook bash)"` |
| fish | `~/.config/fish/config.fish` | `acct hook fish \| source` |
| PowerShell | `$PROFILE` | `Invoke-Expression (acct hook powershell)` |

Restart the shell or evaluate the line once. The hook exports `ACCT_SHELL_HOOK`
and refreshes managed token, host, and profile variables after directory changes.
Fish uses its native `set` syntax. On a failed refresh, the hook clears managed
variables, prints a warning, and leaves the cache unset so the next prompt retries.

Bash refreshes at the next prompt. In `cd repo && gh ...`, gh runs before that
refresh. Use `acct exec -- gh ...` or put the generated gh wrapper first on PATH
for resolution at invocation time. Zsh uses both `chpwd` and `precmd`; PowerShell
uses its prompt. These hooks do not sandbox arbitrary child programs.

Run `acct_refresh` after changing a binding, profile, or `.acct` without changing
directories. Existing shells keep their environment until a refresh. `acct status`
and `acct doctor` show a startup-file hint when the hook is absent.
