import type { ResolveInput, ResolveResult, EnforceMode, Profile } from "../types.js";
import { getProfile } from "../config/store.js";
import { normalizePath, pathIsPrefix } from "../util/paths.js";

function enforceFor(
  profile: Profile | null,
  bindingEnforce: EnforceMode | undefined,
  defaultEnforce: EnforceMode,
): EnforceMode {
  return bindingEnforce ?? profile?.enforce ?? defaultEnforce;
}

/**
 * Resolve which profile applies to a working directory.
 * Order: ACCT_PROFILE env → repo .acct → longest binding → unbound.
 */
export function resolveProfile(input: ResolveInput): ResolveResult {
  const env = input.env ?? process.env;
  const searchRoot = normalizePath(input.gitToplevel || input.cwd);
  const defaultEnforce = input.config.defaultEnforce;

  const envName = env.ACCT_PROFILE?.trim();
  if (envName) {
    const profile = getProfile(input.config, envName);
    if (!profile) {
      return {
        profile: null,
        reason: "env",
        enforce: defaultEnforce,
      };
    }
    return {
      profile,
      reason: "env",
      enforce: enforceFor(profile, undefined, defaultEnforce),
    };
  }

  if (input.localAcct?.profile) {
    const profile = getProfile(input.config, input.localAcct.profile);
    return {
      profile: profile ?? null,
      reason: "local",
      enforce: enforceFor(profile ?? null, undefined, defaultEnforce),
    };
  }

  const matches = input.config.bindings
    .filter((b) => pathIsPrefix(b.path, searchRoot))
    .sort(
      (a, b) => normalizePath(b.path).length - normalizePath(a.path).length,
    );

  if (matches.length > 0) {
    const best = matches[0]!;
    const profile = getProfile(input.config, best.profileId) ?? null;
    return {
      profile,
      reason: "binding",
      bindingPath: best.path,
      enforce: enforceFor(profile, best.enforce, defaultEnforce),
    };
  }

  return {
    profile: null,
    reason: "unbound",
    enforce: "off",
  };
}
