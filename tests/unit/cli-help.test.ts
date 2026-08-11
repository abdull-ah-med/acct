import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bin = path.join(root, "bin/acct.js");

function helpText(args: string[] = ["--help"]): string {
  const r = spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    cwd: root,
  });
  expect(r.status).toBe(0);
  return `${r.stdout}\n${r.stderr}`;
}

describe("acct --help", () => {
  it("lists bind and unbind with descriptions", () => {
    const out = helpText();
    expect(out).toMatch(/bind\s+.*Bind a directory tree to a profile/s);
    expect(out).toMatch(/unbind\s+.*Remove a directory/s);
    expect(out).toMatch(/doctor[\s\S]*keychain/i);
    expect(out).toMatch(/status\s+.*profile resolution/i);
    expect(out).toMatch(/init\s+/);
    expect(out).toMatch(/profile\s+/);
  });

  it("lists profile subcommands with descriptions", () => {
    const out = helpText(["profile", "--help"]);
    expect(out).toMatch(/add\s+.*Create a profile/i);
    expect(out).toMatch(/list\s+.*List profiles/i);
    expect(out).toMatch(/token\s+.*OS keychain/i);
  });
});
