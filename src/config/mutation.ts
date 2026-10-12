import fs from "node:fs";
import path from "node:path";
import { acctConfigDir, loadConfig, saveConfig } from "./store.js";
import { validateConfig } from "./validate.js";
import { acquireFileLock, withFileLock, lockTimeout } from "../util/fs-safe.js";
import { Transaction, failAt } from "../util/transaction.js";
import {
  installIncludeIf,
  globalGitconfigPath,
} from "../identity/includeIf.js";
import { canonicalPath } from "../util/paths.js";
import { resolveGitContext } from "../resolution/gitContext.js";
import type { AcctConfig } from "../types.js";
let session = false;
let sessionUnbindPath: string | undefined;
export function reconcileConfig(
  config: AcctConfig,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (config.installed) installIncludeIf(config, env);
  else console.error("acct is not installed — run acct install to apply");
}
export function updateConfig(
  env: NodeJS.ProcessEnv,
  mutate: (config: AcctConfig) => AcctConfig,
): AcctConfig {
  const update = () => {
    const current = loadConfig(env, sessionUnbindPath);
    validateConfig(current);
    const next = mutate(current);
    validateConfig(next);
    saveConfig(next, env);
    failAt("config", env);
    reconcileConfig(next, env);
    return next;
  };
  return session
    ? update()
    : withFileLock(
        path.join(acctConfigDir(env), "config.lock"),
        update,
        lockTimeout(env),
      );
}
export function beginConfigMutation(
  cwd: string,
  env: NodeJS.ProcessEnv,
  extraPaths: string[] = [],
  unbindPath?: string,
): { finish: (success: boolean) => void } {
  const release = acquireFileLock(
    path.join(acctConfigDir(env), "config.lock"),
    lockTimeout(env),
  );
  const txn = new Transaction();
  try {
    txn.captureTree(acctConfigDir(env));
    const global = globalGitconfigPath(env);
    txn.capture(global);
    const target = canonicalPath(global);
    if (target !== global) txn.capture(target);
    const config = loadConfig(env, unbindPath);
    for (const dir of new Set([
      cwd,
      ...config.bindings.map((b) => b.path),
      ...extraPaths,
    ])) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      const ctx = resolveGitContext(dir, env);
      if (ctx) {
        txn.capture(path.join(ctx.commonDir, "config"));
        txn.capture(path.join(ctx.gitDir, "config.worktree"));
        if (ctx.workTree) txn.capture(path.join(ctx.workTree, ".acct"));
      }
    }
    session = true;
    sessionUnbindPath = unbindPath;
  } catch (error) {
    release();
    throw error;
  }
  return {
    finish(success) {
      try {
        if (!success) txn.rollback();
      } finally {
        session = false;
        sessionUnbindPath = undefined;
        release();
      }
    },
  };
}
