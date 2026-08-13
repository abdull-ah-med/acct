import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  defaultConfig,
  saveConfig,
  upsertBinding,
  upsertProfile,
} from "../../src/config/store.js";
import type { Profile } from "../../src/types.js";
import { tmpRoot } from "./fake-gh.js";

export interface AcctWorkspace {
  root: string;
  configDir: string;
  workDir: string;
  unboundDir: string;
  profile: Profile;
  env: NodeJS.ProcessEnv;
  putToken(token: string, profile?: Profile): void;
  close(): void;
}

const HELPER = path.resolve("bin/git-credential-acct.js");
const ACCT = path.resolve("bin/acct.js");

export function makeWorkspace(profile: Profile): AcctWorkspace {
  const root = tmpRoot("acct-ws-");
  const configDir = path.join(root, "config");
  const workDir = path.join(root, "work");
  const unboundDir = path.join(root, "unbound");
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(unboundDir, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ACCT_CONFIG_DIR: configDir,
    ACCT_SECRET_BACKEND: "file",
  };

  let config = defaultConfig();
  config = upsertProfile(config, profile);
  config = upsertBinding(config, { path: workDir, profileId: profile.id });
  saveConfig(config, env);

  return {
    root,
    configDir,
    workDir,
    unboundDir,
    profile,
    env,
    putToken(token: string, p = profile) {
      const file = path.join(configDir, "secrets.json");
      let data: Record<string, string> = {};
      if (fs.existsSync(file)) {
        data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
          string,
          string
        >;
      }
      data[`${p.host}::${p.githubUser}`] = token;
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
    },
    close() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

export function initGitIdentity(
  dir: string,
  name: string,
  email: string,
): void {
  const r = spawnSync("git", ["init"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
  });
  if (r.status !== 0) {
    throw new Error(`git init failed: ${r.stderr || r.stdout}`);
  }
  for (const [key, value] of [
    ["user.name", name],
    ["user.email", email],
  ] as const) {
    const c = spawnSync("git", ["config", key, value], {
      cwd: dir,
      encoding: "utf8",
    });
    if (c.status !== 0) {
      throw new Error(`git config ${key} failed: ${c.stderr || c.stdout}`);
    }
  }
}

export function helperGet(
  cwd: string,
  env: NodeJS.ProcessEnv,
  body = "protocol=https\nhost=github.com\n\n",
) {
  return spawnSync(process.execPath, [HELPER, "get"], {
    cwd,
    env,
    input: body,
    encoding: "utf8",
  });
}

export function acct(args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  return spawnSync(process.execPath, [ACCT, ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
}
