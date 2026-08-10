/**
 * Welcome tip sheet shown on bare `acct` (and optionally postinstall).
 * npm ≥7 hides postinstall stdout, so the CLI is the reliable path.
 */

export function useBannerColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR != null) return false;
  if (env.FORCE_COLOR === "0") return false;
  if (env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

function paint(enabled: boolean) {
  if (!enabled) {
    const id = (s: string) => s;
    return { bold: id, dim: id };
  }
  return {
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  };
}

/** Install / first-run tip sheet. */
export function formatWelcomeBanner(color = useBannerColor()): string {
  const c = paint(color);

  return `
  ${c.bold("acct")}  ${c.dim("one folder · one account · no leaks")}

  ${c.dim("Next:")}
    acct init \\
      --id work \\
      --user <github-user> \\
      --email you@example.com \\
      --name "Your Name" \\
      --bind ~/Work \\
      --import-gh

  ${c.dim("Then add a shell hook (so gh follows the directory):")}
    eval "$(acct hook zsh)"   ${c.dim("# or: bash | fish | powershell")}

  ${c.dim("Docs:")} https://acct-web.vercel.app/
`;
}
