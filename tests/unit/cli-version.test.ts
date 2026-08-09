import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

describe("CLI version", () => {
  it("matches package.json", () => {
    const cliSrc = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../src/cli/index.ts",
      ),
      "utf8",
    );
    expect(cliSrc).toContain(".version(CLI_VERSION)");
    expect(cliSrc).toContain('require("../../package.json")');
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
