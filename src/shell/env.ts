import { resolveFromCwd } from "../resolution/fromCwd.js";
import { envForProfile } from "../gh/env.js";

const TOKEN_KEYS = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GH_HOST",
] as const;

/**
 * Build env exports for the shell hook.
 *
 * Directory bindings / .acct win: sticky ACCT_PROFILE from a previous hook
 * export must not block rebinding on cd (T2/T5). Explicit one-off override
 * remains available via `ACCT_PROFILE=… acct exec …`.
 */
export async function buildShellEnvExports(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string | null>> {
  const envForResolve: NodeJS.ProcessEnv = { ...env };
  delete envForResolve.ACCT_PROFILE;

  const resolved = resolveFromCwd(cwd, envForResolve);
  const exports: Record<string, string | null> = {};

  if (resolved.profile) {
    const profileEnv = await envForProfile(resolved.profile, envForResolve);
    exports.ACCT_PROFILE = resolved.profile.id;
    exports.GH_TOKEN = profileEnv.GH_TOKEN ?? null;
    exports.GITHUB_TOKEN = null;
    exports.GH_ENTERPRISE_TOKEN = profileEnv.GH_ENTERPRISE_TOKEN ?? null;
    exports.GITHUB_ENTERPRISE_TOKEN = null;
    exports.GH_HOST = profileEnv.GH_HOST ?? null;
  } else {
    // I5 / T5: outside a bound tree, acct-managed tokens must not linger
    exports.ACCT_PROFILE = null;
    for (const key of TOKEN_KEYS) {
      exports[key] = null;
    }
  }

  return exports;
}
