/**
 * Install the published tarball the way npm does and run the packed bins.
 * Oracle: package.json version and git-credential capability "version 0"
 * (https://git-scm.com/docs/git-credential). Not dist/ source text.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = createRequire(import.meta.url)("../package.json");
const expectedVersion = pkg.version;

const distCli = path.join(root, "dist/cli/index.js");
if (!fs.existsSync(distCli)) {
  console.error("dist/ missing — run npm run build first");
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: root,
    ...opts,
  });
}

const pack = run("npm", ["pack", "--silent"]);
if (pack.status !== 0) {
  console.error(pack.stderr || pack.stdout);
  process.exit(pack.status ?? 1);
}
const tgzName = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
if (!tgzName) {
  console.error("npm pack produced no tarball name");
  process.exit(1);
}
const tgz = path.resolve(root, tgzName);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acct-pack-smoke-"));
let failed = false;
try {
  const init = run("npm", ["init", "-y"], { cwd: tmp, stdio: "ignore" });
  if (init.status !== 0) {
    console.error("npm init failed in smoke dir");
    process.exit(init.status ?? 1);
  }
  const install = run("npm", ["install", tgz], { cwd: tmp });
  if (install.status !== 0) {
    console.error(install.stderr || install.stdout);
    process.exit(install.status ?? 1);
  }

  const acctJs = path.join(tmp, "node_modules/acct-sh/bin/acct.js");
  const helperJs = path.join(tmp, "node_modules/acct-sh/bin/git-credential-acct.js");

  const ver = run(process.execPath, [acctJs, "--version"], { cwd: tmp });
  const got = (ver.stdout || "").trim();
  if (ver.status !== 0 || got !== expectedVersion) {
    console.error(
      `packed acct --version: got ${JSON.stringify(got)} want ${JSON.stringify(expectedVersion)}`,
    );
    console.error(ver.stderr);
    failed = true;
  } else {
    console.log(`packed acct --version=${got}`);
  }

  const cap = run(process.execPath, [helperJs, "capability"], { cwd: tmp });
  if (cap.status !== 0 || !(cap.stdout || "").includes("version 0")) {
    console.error(
      `packed git-credential-acct capability: got ${JSON.stringify(cap.stdout)}`,
    );
    console.error(cap.stderr);
    failed = true;
  } else {
    console.log("packed git-credential-acct capability=version 0");
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log(`pack-smoke ok ${tgzName}`);
