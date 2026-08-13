import type { EnforceMode, Profile } from "../types.js";
import { resolveProfileToken } from "../gh/token.js";
import { envForProfile, ghApiLogin } from "../gh/env.js";
import { defaultGitConfigReader } from "../enforce/checks.js";
import { diagnose, type DiagnoseInput, type DiagnoseReport } from "./explain.js";

export interface CollectDiagnoseOptions {
  /**
   * Query `gh api user` under the profile env.
   * Status / hooks always query. Doctor only when --online (or when we
   * already have a cheap reason to, i.e. always for status).
   */
  queryPrincipal?: boolean;
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
  if (queryPrincipal) {
    const profileEnv = await envForProfile(profile, env);
    authPrincipal = ghApiLogin(profileEnv);
  }
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
