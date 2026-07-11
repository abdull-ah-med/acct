import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { AcctConfig, LocalAcctFile, Profile, Binding } from "../types.js";
import { acctConfigDir, normalizePath } from "../util/paths.js";

export { acctConfigDir };

const CONFIG_NAME = "config.yaml";

export function defaultConfig(): AcctConfig {
  return {
    version: 1,
    profiles: [],
    bindings: [],
    defaultEnforce: "strict",
    installed: false,
  };
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(acctConfigDir(env), CONFIG_NAME);
}

export function gitIncDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(acctConfigDir(env), "git");
}

export function backupDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(acctConfigDir(env), "backup");
}

export function hooksDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(acctConfigDir(env), "hooks");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AcctConfig {
  const file = configPath(env);
  if (!fs.existsSync(file)) return defaultConfig();
  const raw = fs.readFileSync(file, "utf8");
  const parsed = YAML.parse(raw) as Partial<AcctConfig> | null;
  if (!parsed || parsed.version !== 1) {
    throw new Error(`Invalid acct config at ${file}: expected version 1`);
  }
  return {
    ...defaultConfig(),
    ...parsed,
    profiles: parsed.profiles ?? [],
    bindings: (parsed.bindings ?? []).map((b) => ({
      ...b,
      path: normalizePath(b.path),
    })),
  };
}

export function saveConfig(
  config: AcctConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  assertNoSecretsInConfig(config);
  const dir = acctConfigDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const file = configPath(env);
  const toWrite: AcctConfig = {
    ...config,
    bindings: config.bindings.map((b) => ({
      ...b,
      path: normalizePath(b.path),
    })),
  };
  fs.writeFileSync(file, YAML.stringify(toWrite), { mode: 0o600 });
}

export function getProfile(
  config: AcctConfig,
  idOrUser: string,
): Profile | undefined {
  return config.profiles.find(
    (p) => p.id === idOrUser || p.githubUser === idOrUser,
  );
}

export function upsertProfile(config: AcctConfig, profile: Profile): AcctConfig {
  const idx = config.profiles.findIndex((p) => p.id === profile.id);
  const profiles = [...config.profiles];
  if (idx >= 0) profiles[idx] = profile;
  else profiles.push(profile);
  return { ...config, profiles };
}

export function removeProfile(config: AcctConfig, id: string): AcctConfig {
  return {
    ...config,
    profiles: config.profiles.filter((p) => p.id !== id),
    bindings: config.bindings.filter((b) => b.profileId !== id),
  };
}

export function upsertBinding(config: AcctConfig, binding: Binding): AcctConfig {
  const normalized = { ...binding, path: normalizePath(binding.path) };
  const idx = config.bindings.findIndex(
    (b) => normalizePath(b.path) === normalized.path,
  );
  const bindings = [...config.bindings];
  if (idx >= 0) bindings[idx] = normalized;
  else bindings.push(normalized);
  return { ...config, bindings };
}

export function removeBinding(config: AcctConfig, dirPath: string): AcctConfig {
  const n = normalizePath(dirPath);
  return {
    ...config,
    bindings: config.bindings.filter((b) => normalizePath(b.path) !== n),
  };
}

export function readLocalAcct(repoRoot: string): LocalAcctFile | null {
  const file = path.join(repoRoot, ".acct");
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return null;
  try {
    const parsed = YAML.parse(raw) as LocalAcctFile | string;
    if (typeof parsed === "string") return { profile: parsed };
    if (parsed && typeof parsed.profile === "string") return parsed;
  } catch {
    // plain profile name
    return { profile: raw };
  }
  return null;
}

export function assertNoSecretsInConfig(config: AcctConfig): void {
  const blob = YAML.stringify(config);
  if (/\b(gh[pousr]_|github_pat_)\w+/i.test(blob)) {
    throw new Error("Refusing to save config that appears to contain a token");
  }
}
