import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolated } from "../harness/isolation.js";
import { installFakeGh } from "../harness/fake-gh.js";

let harness: ReturnType<typeof isolated>;
beforeEach(() => {
  harness = isolated();
});
afterEach(() => harness.close());
function passthroughEnv() {
  const fake = installFakeGh(harness.root, { passthrough: true });
  return { fake, env: { ...fake.env(harness.env), ACCT_VIA_SHIM: undefined } };
}
it("R4 direct unbound acct exec explains that gh is unmanaged", () => {
  const { fake, env } = passthroughEnv();
  const result = harness.run(["exec", "gh", "--version"], harness.root, env);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain(
    "acct note: unbound directory — acct is not managing gh here",
  );
  expect(fake.calls().map((call) => call.argv)).toEqual([["--version"]]);
});
it("R4 installed gh shim forwards an unbound call silently", () => {
  const { fake, env } = passthroughEnv();
  expect(harness.run(["wrap-install"], harness.root, env).status).toBe(0);
  const shim = path.join(
    harness.env.ACCT_CONFIG_DIR!,
    "wrap-bin",
    process.platform === "win32" ? "gh.cmd" : "gh",
  );
  const result =
    process.platform === "win32"
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", `""${shim}" --version"`],
          { cwd: harness.root, env, encoding: "utf8" },
        )
      : spawnSync(shim, ["--version"], {
          cwd: harness.root,
          env,
          encoding: "utf8",
        });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout).argv).toEqual(["--version"]);
  expect(fake.calls().map((call) => call.argv)).toEqual([["--version"]]);
});
it("R4 an empty but set shim marker also suppresses the unbound note", () => {
  const { fake, env } = passthroughEnv();
  const result = harness.run(["exec", "gh", "--version"], harness.root, {
    ...env,
    ACCT_VIA_SHIM: "",
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(fake.calls().map((call) => call.argv)).toEqual([["--version"]]);
});
