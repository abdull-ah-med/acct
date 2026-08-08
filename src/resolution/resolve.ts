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
 * Order: CLI --profile → repo .acct → longest binding → unbound.
 * Ambient ACCT_PROFILE is ignored unless allowEnvProfile is set (I4).
 * Cite: docs/invariants.md; shell/env.ts strips sticky env for the same reason.
 */
export function resolveProfile(input: ResolveInput): ResolveResult {
  const env = input.env ?? process.env;
  // Bindings are directory-scoped: match against cwd, not git toplevel.
  // git toplevel is only for locating repo-local `.acct` (see resolveFromCwd).
  const cwd = normalizePath(input.cwd);
  const defaultEnforce = input.config.defaultEnforce;

  const forced = input.forcedProfileId?.trim();
  if (forced) {
    const profile = getProfile(input.config, forced);
    if (!profile) {
      return {
        profile: null,
        reason: "cli",
        enforce: defaultEnforce,
      };
    }
    return {
      profile,
      reason: "cli",
      enforce: enforceFor(profile, undefined, defaultEnforce),
    };
  }

  if (input.allowEnvProfile) {
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
    .filter((b) => pathIsPrefix(b.path, cwd))
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
    // I6: unbound uses defaultEnforce (strict by default) so helper can quit=1
    enforce: defaultEnforce,
  };
}
