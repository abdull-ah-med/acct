import type { EnforceMode, Profile } from "../types.js";
import { resolveProfileToken } from "../gh/token.js";
import { envForProfile, ghActiveLogin, ghApiLogin } from "../gh/env.js";
import {
  defaultGitConfigReader,
  hasLocalIdentityOverride,
  includeIfGitdirApplies,
} from "../enforce/checks.js";
import { diagnose, type DiagnoseInput, type DiagnoseReport } from "./explain.js";

export interface CollectDiagnoseOptions {
  /**
   * Query `gh api user` under the profile env.
   * Status / hooks always query. Doctor only when --online (or when we
   * already have a cheap reason to, i.e. always for status).
   */
  queryPrincipal?: boolean;
  /** Directory binding; includeIf gitdir only matches repos under this path. */
  bindingPath?: string;
}

export async function collectDiagnoseInput(
  profile: Profile,
  enforce: EnforceMode,
  cwd: string,
  env: NodeJS.ProcessEnv,
  opts: CollectDiagnoseOptions = {},
): Promise<DiagnoseInput> {
  const hasToken = !!(await resolveProfileToken(profile, env));
  const queryPrincipal = opts.queryPrincipal !== false;
  let authPrincipal: string | null = null;
  let ghActiveUser: string | null = null;
  if (queryPrincipal) {
    const profileEnv = await envForProfile(profile, env);
    authPrincipal = ghApiLogin(profileEnv);
    ghActiveUser = ghActiveLogin(profile.host, env);
  }
  const inGitRepo = includeIfGitdirApplies(cwd, opts.bindingPath);
  return {
    profileId: profile.id,
    githubUser: profile.githubUser,
    host: profile.host,
    name: profile.name,
    email: profile.email,
    protocol: profile.protocol,
    enforce,
    hasToken,
    authPrincipal,
    principalChecked: queryPrincipal,
    commitName: defaultGitConfigReader("user.name", cwd),
    commitEmail: defaultGitConfigReader("user.email", cwd),
    inGitRepo,
    localIdentityOverride: inGitRepo && hasLocalIdentityOverride(cwd),
    ghActiveUser,
    ghActiveChecked: queryPrincipal,
  };
}

export async function diagnoseCwd(
  profile: Profile,
  enforce: EnforceMode,
  cwd: string,
  env: NodeJS.ProcessEnv,
  opts: CollectDiagnoseOptions = {},
): Promise<DiagnoseReport> {
  return diagnose(await collectDiagnoseInput(profile, enforce, cwd, env, opts));
}
