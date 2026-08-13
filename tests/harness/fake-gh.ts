import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// .cjs so Node treats this as CommonJS even though acct's package.json is "type": "module".
const FAKE_GH_CJS = `"use strict";
const fs = require("node:fs");
const statePath = process.env.ACCT_FAKE_GH_STATE;
if (!statePath) {
  process.stderr.write("fake-gh: ACCT_FAKE_GH_STATE unset\\n");
  process.exit(2);
}
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const argv = process.argv.slice(2);
const rec = {
  argv,
  hasGhToken: process.env.GH_TOKEN != null && process.env.GH_TOKEN !== "",
  hasGithubToken: process.env.GITHUB_TOKEN != null && process.env.GITHUB_TOKEN !== "",
};
fs.appendFileSync(state.log, JSON.stringify(rec) + "\\n");

if (argv[0] === "auth" && argv[1] === "token") {
  const host = flag(argv, "--hostname") || "github.com";
  const user = flag(argv, "--user");
  if (!user) {
    process.stderr.write("fake-gh: auth token requires --user\\n");
    process.exit(1);
  }
  const token = (state.tokens && state.tokens[host + "::" + user]) || "";
  if (!token) process.exit(1);
  process.stdout.write(token + "\\n");
  process.exit(0);
}

if (argv[0] === "api" && argv[1] === "user") {
  const login = state.apiUser || "";
  if (!login) process.exit(1);
  process.stdout.write(login + "\\n");
  process.exit(0);
}

process.stderr.write("fake-gh: unexpected " + argv.join(" ") + "\\n");
process.exit(2);

function flag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return "";
  return argv[i + 1];
}
`;

const FAKE_GH_SH = `#!/bin/sh
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$dir/gh.cjs" "$@"
`;

export interface FakeGhState {
  tokens: Record<string, string>;
  log: string;
  apiUser?: string;
}

export interface FakeGhCall {
  argv: string[];
  hasGhToken: boolean;
  hasGithubToken: boolean;
}

export interface FakeGh {
  binDir: string;
  statePath: string;
  logPath: string;
  env(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  setToken(user: string, token: string, host?: string): void;
  setApiUser(login: string): void;
  calls(): FakeGhCall[];
}

export interface FakeGhOptions {
  tokens?: Record<string, string>;
  apiUser?: string;
}

export function installFakeGh(dir: string, opts: FakeGhOptions = {}): FakeGh {
  const binDir = path.join(dir, "fake-bin");
  fs.mkdirSync(binDir, { recursive: true });
  const logPath = path.join(dir, "fake-gh.log");
  const statePath = path.join(dir, "fake-gh-state.json");
  let tokens = { ...(opts.tokens ?? {}) };
  let apiUser = opts.apiUser ?? "";

  const writeState = () => {
    const state: FakeGhState = { tokens, log: logPath, apiUser };
    fs.writeFileSync(statePath, JSON.stringify(state));
  };
  writeState();
  fs.writeFileSync(logPath, "");

  fs.writeFileSync(path.join(binDir, "gh.cjs"), FAKE_GH_CJS);
  fs.writeFileSync(path.join(binDir, "gh"), FAKE_GH_SH, { mode: 0o755 });
  fs.writeFileSync(
    path.join(binDir, "gh.cmd"),
    `@echo off\r\nnode "%~dp0gh.cjs" %*\r\n`,
  );

  return {
    binDir,
    statePath,
    logPath,
    env(extra: NodeJS.ProcessEnv = {}) {
      return {
        ...process.env,
        ...extra,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        ACCT_FAKE_GH_STATE: statePath,
      };
    },
    setToken(user: string, token: string, host = "github.com") {
      tokens = { ...tokens, [`${host}::${user}`]: token };
      writeState();
    },
    setApiUser(login: string) {
      apiUser = login;
      writeState();
    },
    calls() {
      const text = fs.readFileSync(logPath, "utf8").trim();
      if (!text) return [];
      return text.split("\n").map((line) => JSON.parse(line) as FakeGhCall);
    },
  };
}

function newestMtime(dir: string): number {
  let newest = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest;
}

/** Rebuild dist when missing or older than src (helper bins load dist/). */
export function ensureDistBuild(): void {
  const dist = path.resolve("dist");
  const srcM = newestMtime(path.resolve("src"));
  const distM = newestMtime(dist);
  if (
    fs.existsSync(path.join(dist, "credential/helper.js")) &&
    fs.existsSync(path.join(dist, "gh/token.js")) &&
    distM >= srcM
  ) {
    return;
  }
  const b = spawnSync("npm", ["run", "build"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  if (b.status !== 0) {
    throw new Error(`npm run build failed: ${b.stderr || b.stdout}`);
  }
}

export function tmpRoot(prefix = "acct-test-"): string {
  return fs.mkdtempSync(path.join(process.cwd(), `.tmp-${prefix}`));
}
