import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDistBuild } from "../harness/fake-gh.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bin = path.join(root, "bin/acct.js");

describe("CLI version", () => {
  it("acct --version prints package.json version", () => {
    ensureDistBuild();
    const r = spawnSync(process.execPath, [bin, "--version"], {
      encoding: "utf8",
      cwd: root,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });
});
