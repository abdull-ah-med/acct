#!/usr/bin/env node
/**
 * Print a short onboarding tip after install.
 * Must never fail the install (exit 0 even on errors).
 */

function useColor() {
  if (process.env.NO_COLOR != null) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  // npm often pipes postinstall output; still color when the user likely sees it
  return process.stdout.isTTY || process.env.npm_config_color !== "false";
}

function paint(enabled) {
  if (!enabled) {
    const id = (s) => s;
    return { bold: id, dim: id, white: id };
  }
  return {
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    white: (s) => `\x1b[97m${s}\x1b[0m`,
  };
}

try {
  const isCi =
    process.env.CI === "true" ||
    process.env.CONTINUOUS_INTEGRATION === "true" ||
    process.env.GITHUB_ACTIONS === "true";
  if (isCi || process.env.ACCT_SKIP_POSTINSTALL === "1") {
    process.exit(0);
  }

  const c = paint(useColor());
  const w = (s) => c.bold(c.white(s));

  // Keyhole (logo-inspired) + readable wordmark
  const art = [
    c.white("                 .--."),
    c.white("                /    \\"),
    c.white("               |  ()  |"),
    c.white("                \\    /"),
    c.white("             ____`--`____"),
    w("               __ _  ___  ___  _"),
    w("              / _` |/ __|/ __|| |_"),
    w("             | (_| | (__| (__   _|"),
    w("              \\__,_|\\___|\\___|_|"),
    "",
    c.dim("             one folder · one account · no leaks"),
  ].join("\n");

  console.log(`
${art}

  ${c.bold("acct-sh")} installed.

  ${c.dim("Next:")}
    acct --help
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
`);
} catch {
  // never break npm install
}
process.exit(0);
