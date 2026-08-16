import { posixShellSingleQuote } from "../util/paths.js";
import { resolveAcctCliPaths } from "../enforce/hooks.js";

export type ShellKind = "bash" | "zsh" | "fish" | "powershell";

function acctShellEnvCmd(
  extraArgs: string,
  env: NodeJS.ProcessEnv = process.env,
): { node: string; acctJs: string; posix: string; pwsh: string } {
  const { node, acctJs } = resolveAcctCliPaths(env);
  const posix = `${posixShellSingleQuote(node)} ${posixShellSingleQuote(acctJs)} shell-env${extraArgs}`;
  const pwshNode = node.replace(/'/g, "''");
  const pwshJs = acctJs.replace(/'/g, "''");
  const pwsh = `& '${pwshNode}' '${pwshJs}' shell-env${extraArgs}`;
  return { node, acctJs, posix, pwsh };
}

export function hookScript(
  shell: ShellKind,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const cmd = acctShellEnvCmd(shell === "powershell" ? " --powershell" : "", env);
  switch (shell) {
    case "bash":
    case "zsh":
      return `# acct shell hook (${shell})
# Add to ~/.${shell}rc: eval "$(acct hook ${shell})"
acct_chpwd() {
  [ "$PWD" = "\${_ACCT_LAST_PWD-}" ] && return
  _ACCT_LAST_PWD=$PWD
  eval "$(${cmd.posix})"
}
if [[ -n "$ZSH_VERSION" ]]; then
  autoload -U add-zsh-hook 2>/dev/null
  add-zsh-hook chpwd acct_chpwd 2>/dev/null || true
fi
if [[ -n "$BASH_VERSION" ]]; then
  case ":\${PROMPT_COMMAND-}:" in
    *":acct_chpwd;"*) ;;
    *) PROMPT_COMMAND="acct_chpwd;\${PROMPT_COMMAND-}" ;;
  esac
fi
acct_chpwd
`;
    case "fish":
      return `# acct shell hook (fish)
# Add to config.fish: acct hook fish | source
function acct_chpwd --on-variable PWD
  ${cmd.posix} | source
end
${cmd.posix} | source
`;
    case "powershell":
      return `# acct shell hook (powershell)
# Add to $PROFILE: Invoke-Expression (acct hook powershell)
function acct_ApplyEnv {
  Invoke-Expression (${cmd.pwsh} | Out-String)
}
# Preserve an existing prompt if present; append acct env refresh once
if (-not (Test-Path variable:acct__prevPrompt)) {
  if (Get-Command prompt -ErrorAction SilentlyContinue) {
    $acct__prevPrompt = (Get-Item function:prompt).ScriptBlock
  } else {
    $acct__prevPrompt = $null
  }
  function prompt {
    acct_ApplyEnv
    if ($null -ne $acct__prevPrompt) {
      & $acct__prevPrompt
    } else {
      "PS $($executionContext.SessionState.Path.CurrentLocation)> "
    }
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
  // T5: sticky GH_TOKEN after manual `acct shell-env` without a cd/prompt hook.
  // Cite: https://cli.github.com/manual/gh_help_environment
  // Cite: docs/research/xargs-sticky-uninstall-delete-cites-2026-08-08.md
  if (powershell) {
    lines.push(
      "# acct: install the prompt hook so env rebinds on cd — Invoke-Expression (acct hook powershell)",
    );
  } else {
    lines.push(
      '# acct: install the cd hook so GH_TOKEN rebinds on cd — eval "$(acct hook zsh)"  # or bash/fish',
    );
  }
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
