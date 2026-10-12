import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, it, expect } from "vitest";
import { isolated } from "../harness/isolation.js";
let harness: ReturnType<typeof isolated>;
beforeEach(() => {
  harness = isolated();
});
afterEach(() => harness.close());
it("default test runner isolates HOME/config/cache and puts fake gh first", () => {
  const script = `const fs=require('node:fs'); require('node:child_process').execFileSync('gh',['--version']);const state=JSON.parse(fs.readFileSync(process.env.ACCT_FAKE_GH_STATE));console.log(JSON.stringify({home:process.env.HOME,config:process.env.ACCT_CONFIG_DIR,backend:process.env.ACCT_SECRET_BACKEND,offline:process.env.npm_config_offline,calls:fs.readFileSync(state.log,'utf8').trim().split('\\n').map(JSON.parse)}));`;
  const r = spawnSync(
    process.execPath,
    [path.resolve("scripts/test-isolated.mjs"), process.execPath, "-e", script],
    { cwd: path.resolve("."), env: harness.env, encoding: "utf8" },
  );
  expect(r.status, r.stderr).toBe(0);
  const result = JSON.parse(r.stdout);
  expect(result.home).not.toBe(harness.root);
  expect(result.config).toBe(path.join(result.home, "acct"));
  expect(result.backend).toBe("file");
  expect(result.offline).toBe("true");
  expect(result.calls.map((c: { argv: string[] }) => c.argv)).toEqual([
    ["--version"],
  ]);
  expect(fs.existsSync(result.home)).toBe(false);
});
