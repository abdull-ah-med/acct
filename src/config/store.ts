import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { AcctConfig, LocalAcctFile, Profile, Binding } from "../types.js";
import { acctConfigDir, normalizePath, TOKEN_SHAPE } from "../util/paths.js";
import { ensureAcctDir, atomicWriteFileSync } from "../util/fs-safe.js";

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
  ensureAcctDir(dir);
  const file = configPath(env);
  const toWrite: AcctConfig = {
    ...config,
    bindings: config.bindings.map((b) => ({
      ...b,
      path: normalizePath(b.path),
    })),
  };
  atomicWriteFileSync(file, YAML.stringify(toWrite), 0o600);
}

/** Look up a profile by exact id only. */
export function findProfileById(
  config: AcctConfig,
  id: string,
): Profile | undefined {
  return config.profiles.find((p) => p.id === id);
}

/** Look up a profile by githubUser. */
export function findProfileByUser(
  config: AcctConfig,
  user: string,
): Profile | undefined {
  return config.profiles.find((p) => p.githubUser === user);
}

/**
 * @deprecated Prefer findProfileById / findProfileByUser to avoid ambiguity.
 * Matches by either id or githubUser (legacy CLI convenience).
 */
export function getProfile(
  config: AcctConfig,
  idOrUser: string,
): Profile | undefined {
  return findProfileById(config, idOrUser) ?? findProfileByUser(config, idOrUser);
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

/**
 * Read `.acct` in a single directory (no walk).
 * - `null` — file absent
 * - `{ profile: "" }` — file present but empty / blank / no profile (local unbound)
 * - `{ profile: "id" }` — explicit profile (unknown id → unbound at resolve)
 *
 * Cite: docs/research/host-port-local-acct-cites-2026-08-08.md (I3 fail-closed)
 */
export function readLocalAcct(dir: string): LocalAcctFile | null {
  const file = path.join(dir, ".acct");
  if (!fs.existsSync(file)) return null;
  // Only regular files — ignore directories named `.acct`
  try {
    if (!fs.statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  const raw = fs.readFileSync(file, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return { profile: "" };

  try {
    const parsed = YAML.parse(trimmed) as LocalAcctFile | string | null;
    if (typeof parsed === "string") return { profile: parsed.trim() };
    if (parsed && typeof parsed === "object" && "profile" in parsed) {
      const p = (parsed as LocalAcctFile).profile;
      if (typeof p === "string") return { profile: p.trim() };
      // profile: null / non-string → explicit local unbound
      return { profile: "" };
    }
  } catch {
    // plain profile name
    return { profile: trimmed };
  }
  // Content present but no usable profile key (comments-only, other keys)
  return { profile: "" };
}

/**
 * Nearest `.acct` walking from `startDir` up to the filesystem root.
 * Same discovery model as direnv `find_up` for `.envrc` — nearest wins;
 * does not require a git repository.
 *
 * Cite: docs/research/local-acct-exec-deny-cites-2026-08-08.md
 */
export function findLocalAcct(startDir: string): LocalAcctFile | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const local = readLocalAcct(dir);
    if (local != null) return local;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function assertNoSecretsInConfig(config: AcctConfig): void {
  const blob = YAML.stringify(config);
  // Clone regex — global TOKEN_SHAPE retains lastIndex across .test() calls.
  if (new RegExp(TOKEN_SHAPE.source, TOKEN_SHAPE.flags).test(blob)) {
    throw new Error("Refusing to save config that appears to contain a token");
  }
}
