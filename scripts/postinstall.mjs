#!/usr/bin/env node
/**
 * Print a short onboarding tip after install.
 * Must never fail the install (exit 0 even on errors).
 *
 * Note: npm ≥7 hides successful lifecycle script stdout unless
 * `--foreground-scripts` is set. The same tip sheet is shown by bare `acct`.
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

try {
  const isCi =
    process.env.CI === "true" ||
    process.env.CONTINUOUS_INTEGRATION === "true" ||
    process.env.GITHUB_ACTIONS === "true";
  if (isCi || process.env.ACCT_SKIP_POSTINSTALL === "1") {
    process.exit(0);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const bannerJs = path.join(here, "..", "dist", "cli", "banner.js");
  const { formatWelcomeBanner } = await import(pathToFileURL(bannerJs).href);
  console.log(formatWelcomeBanner());
  console.log("  Tip: npm hides this by default — run: acct\n");
} catch {
  try {
    console.log(`
  acct  one folder · one account · no leaks

  Next: run  acct
  Docs: https://acct-web.vercel.app/
`);
  } catch {
    // never break npm install
  }
}
process.exit(0);
