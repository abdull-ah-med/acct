import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { installFakeGh } from "./fake-gh.js";

export function isolated() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "acct-remediation-")));
  const fake = installFakeGh(root, { activeUser: "other-user" });
  const env = fake.env({ HOME: root, USERPROFILE: root,
    ACCT_CONFIG_DIR: path.join(root, "acct"), XDG_CONFIG_HOME: path.join(root, "xdg"),
    GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), GH_CONFIG_DIR: path.join(root, "gh"),
    GIT_CONFIG_NOSYSTEM: "1", ACCT_SECRET_BACKEND: "file", GIT_TERMINAL_PROMPT: "0",
    ACCT_FOLLOW_GH: "0", NODE_ENV: "test" });
  for (const key of Object.keys(env)) {
    if (/^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_HOST|ACCT_PROFILE|GIT_DIR|GIT_WORK_TREE|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_|GIT_CONFIG_VALUE_)/.test(key)) delete env[key];
  }
  const bin = path.resolve("bin/acct.js");
  const run = (args: string[], cwd = root, extra = {}, input?: string) =>
    spawnSync(process.execPath, [bin, ...args], {cwd, env: {...env, ...extra}, input, encoding: "utf8", timeout: 15000});
  const git = (args: string[], cwd = root, extra = {}, input?: string) =>
    spawnSync("git", args, {cwd, env: {...env, ...extra}, input, encoding: "utf8", timeout: 15000});
  return {root, fake, env, run, git, close: () => fs.rmSync(root, {recursive: true, force: true})};
}
