export type Protocol = "https" | "ssh";
export type EnforceMode = "strict" | "warn" | "off";

export interface Profile {
  id: string;
  githubUser: string;
  host: string;
  name: string;
  email: string;
  protocol: Protocol;
  sshKeyPath?: string;
  enforce?: EnforceMode;
}

export interface Binding {
  path: string;
  profileId: string;
  enforce?: EnforceMode;
}

export interface AcctConfig {
  version: 1;
  profiles: Profile[];
  bindings: Binding[];
  defaultEnforce: EnforceMode;
  installed?: boolean;
}

export interface LocalAcctFile {
  profile: string;
}

export interface ResolveInput {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  gitToplevel?: string | null;
  localAcct?: LocalAcctFile | null;
  config: AcctConfig;
}

export type ResolveReason =
  | "env"
  | "local"
  | "binding"
  | "unbound";

export interface ResolveResult {
  profile: Profile | null;
  reason: ResolveReason;
  bindingPath?: string;
  enforce: EnforceMode;
}
