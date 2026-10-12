import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installNativeCommand } from "./test-native-command.mjs";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "acct-check-")),
);
const args = process.argv.slice(2);
const copyCache = args[0] === "--copy-cache";
if (copyCache) args.shift();
try {
  // The trusted test fixture is shared, with no production module mocks.
  const literal = fs
    .readFileSync(path.join(repo, "tests/harness/fake-gh.ts"), "utf8")
    .match(/const FAKE_GH_CJS = (`[\s\S]*?`);/)[1];
  const fake = installNativeCommand(
    path.join(root, "bin"),
    "gh",
    Function("return " + literal)(),
  );
  fs.writeFileSync(
    path.join(root, "gh-state.json"),
    JSON.stringify({
      tokens: {},
      passthrough: true,
      log: path.join(root, "gh.log"),
    }),
  );
  const cache = path.join(root, ".npm");
  fs.mkdirSync(cache);
  if (copyCache) {
    const source = path.join(
      process.env.npm_config_cache || path.join(os.homedir(), ".npm"),
      "_cacache",
    );
    if (fs.existsSync(source))
      fs.cpSync(source, path.join(cache, "_cacache"), {
        recursive: true,
        mode: fs.constants.COPYFILE_FICLONE,
      });
  }
  const env = {
    ...process.env,
    ...fake.env,
    HOME: root,
    USERPROFILE: root,
    ACCT_CONFIG_DIR: path.join(root, "acct"),
    XDG_CONFIG_HOME: path.join(root, "xdg"),
    GH_CONFIG_DIR: path.join(root, "gh"),
    GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    ACCT_SECRET_BACKEND: "file",
    ACCT_FOLLOW_GH: "0",
    ACCT_FAKE_GH_STATE: path.join(root, "gh-state.json"),
    PATH: path.join(root, "bin") + path.delimiter + process.env.PATH,
    npm_config_cache: cache,
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  for (const key of Object.keys(env))
    if (
      /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_HOST|ACCT_PROFILE|GIT_DIR|GIT_WORK_TREE|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_|GIT_CONFIG_VALUE_)/.test(
        key,
      )
    )
      delete env[key];
  if (!args[0]) throw new Error("test-isolated requires a command");
  const result = spawnSync(
    args[0] === "node" ? process.execPath : args[0],
    args.slice(1),
    { cwd: repo, env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
