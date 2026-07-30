export type ShellKind = "bash" | "zsh" | "fish" | "powershell";

export function hookScript(shell: ShellKind): string {
  switch (shell) {
    case "bash":
    case "zsh":
      return `# acct shell hook (${shell})
# Add to ~/.${shell}rc: eval "$(acct hook ${shell})"
acct_chpwd() {
  eval "$(acct shell-env)"
}
if [[ -n "$ZSH_VERSION" ]]; then
  autoload -U add-zsh-hook 2>/dev/null
  add-zsh-hook chpwd acct_chpwd 2>/dev/null || true
fi
if [[ -n "$BASH_VERSION" ]]; then
  PROMPT_COMMAND="acct_chpwd;\${PROMPT_COMMAND}"
fi
acct_chpwd
`;
    case "fish":
      return `# acct shell hook (fish)
# Add to config.fish: acct hook fish | source
function acct_chpwd --on-variable PWD
  acct shell-env | source
end
acct shell-env | source
`;
    case "powershell":
      return `# acct shell hook (powershell)
# Add to $PROFILE: Invoke-Expression (acct hook powershell)
function acct_ApplyEnv {
  Invoke-Expression (acct shell-env --powershell | Out-String)
}
# Preserve an existing prompt if present; append acct env refresh
if (Get-Command prompt -ErrorAction SilentlyContinue) {
  $acct__prevPrompt = (Get-Item function:prompt).ScriptBlock
  function prompt {
    acct_ApplyEnv
    & $acct__prevPrompt
  }
} else {
  function prompt {
    acct_ApplyEnv
    "PS $($executionContext.SessionState.Path.CurrentLocation)> "
  }
}
acct_ApplyEnv
`;
    default: {
      const _exhaustive: never = shell;
      return _exhaustive;
    }
  }
}

export function shellEnvExports(
  exports: Record<string, string | null>,
  powershell = false,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(exports)) {
    if (powershell) {
      if (value === null) lines.push(`Remove-Item Env:${key} -ErrorAction SilentlyContinue`);
      else lines.push(`$env:${key} = '${value.replace(/'/g, "''")}'`);
    } else {
      if (value === null) lines.push(`unset ${key}`);
      else lines.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  return lines.join("\n") + "\n";
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
