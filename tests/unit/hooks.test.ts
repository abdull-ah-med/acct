import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  installHooks,
  renderHookScript,
  resolveAcctCliPaths,
} from "../../src/enforce/hooks.js";

describe("enforce hooks (I11b)", () => {
  let tmp: string;
  let prev: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-hooks-"));
    prev = process.env.ACCT_CONFIG_DIR;
    process.env.ACCT_CONFIG_DIR = path.join(tmp, "config");
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.ACCT_CONFIG_DIR;
    else process.env.ACCT_CONFIG_DIR = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("renderHookScript uses absolute quoted paths not bare acct", () => {
    const script = renderHookScript(
      "pre-commit",
      "/usr/local/bin/node",
      "/opt/acct/bin/acct.js",
    );
    expect(script).toContain("exec '/usr/local/bin/node' '/opt/acct/bin/acct.js' hook-run pre-commit");
    expect(script).not.toMatch(/^acct /m);
  });

  it("installHooks writes absolute invocation", () => {
    const dir = installHooks();
    const body = fs.readFileSync(path.join(dir, "pre-commit"), "utf8");
    expect(body).toContain("hook-run pre-commit");
    expect(body).toContain("exec ");
    expect(body).not.toMatch(/\nacct hook-run/);
    const { node, acctJs } = resolveAcctCliPaths();
    expect(body).toContain(node);
    expect(body).toContain(acctJs);
    if (process.platform === "win32") {
      expect(fs.existsSync(path.join(dir, "pre-commit.cmd"))).toBe(true);
    } else {
      expect(fs.statSync(path.join(dir, "pre-commit")).mode & 0o111).toBeTruthy();
    }
  });
});
