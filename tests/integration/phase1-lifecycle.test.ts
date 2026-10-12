import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { installFakeGh } from "../harness/fake-gh.js";
import { isolated } from "../harness/isolation.js";
import {
  FileSecretStore,
  MemorySecretStore,
  PreferKeyringStore,
} from "../../src/secrets/store.js";
let harness: ReturnType<typeof isolated>;
beforeEach(() => {
  harness = isolated();
});
afterEach(() => harness.close());
it("C05 auto store sweeps every plaintext account on first access, retaining primary values", async () => {
  const file = path.join(harness.root, "secrets.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      "github.com::one": "FAKE_OLD",
      "github.com::two": "FAKE_TWO",
    }),
  );
  fs.copyFileSync(file, file + ".bak");
  const primary = new MemorySecretStore();
  await primary.set("github.com::one", "FAKE_PRIMARY");
  const store = new PreferKeyringStore(primary, new FileSecretStore(file));
  expect(await store.get("github.com::one")).toBe("FAKE_PRIMARY");
  expect(await primary.get("github.com::two")).toBe("FAKE_TWO");
  expect(fs.existsSync(file)).toBe(false);
  expect(fs.existsSync(file + ".bak")).toBe(false);
});
it("C27 backend denial propagates rather than masquerading as a missing token", async () => {
  class Denied extends MemorySecretStore {
    async get(): Promise<string | null> {
      throw new Error("denied");
    }
    async delete(): Promise<void> {
      throw new Error("denied");
    }
  }
  const store = new PreferKeyringStore(new Denied(), new MemorySecretStore());
  await expect(store.get("x")).rejects.toThrow();
  await expect(store.delete("x")).rejects.toThrow();
});
it("C03 installs merge/post hooks and catches a foreign recorded author before push", () => {
  const add = harness.run([
    "profile",
    "add",
    "--id",
    "work",
    "--user",
    "work-user",
    "--name",
    "Work User",
    "--email",
    "work@example.com",
  ]);
  expect(add.status, add.stderr).toBe(0);
  expect(harness.git(["init", "--template="]).status).toBe(0);
  expect(harness.run(["bind", harness.root, "work"]).status).toBe(0);
  expect(harness.run(["install"]).status).toBe(0);
  expect(
    fs.existsSync(
      path.join(harness.env.ACCT_CONFIG_DIR!, "hooks/pre-merge-commit"),
    ),
  ).toBe(true);
  expect(
    fs.existsSync(path.join(harness.env.ACCT_CONFIG_DIR!, "hooks/post-commit")),
  ).toBe(true);
  const commit = harness.git([
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--allow-empty",
    "--author=Foreign <foreign@example.com>",
    "-m",
    "foreign",
  ]);
  expect(commit.status, commit.stderr).toBe(0);
  const sha = harness.git(["rev-parse", "HEAD"]).stdout.trim();
  const post = harness.run(["hook-run", "post-commit"]);
  expect(post.stderr).toContain("blocked commit");
  const push = harness.run(
    ["hook-run", "pre-push", "origin", "/tmp/local.git"],
    harness.root,
    {},
    `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\n`,
  );
  expect(push.status).not.toBe(0);
  expect(push.stderr).toContain("foreign@example.com");
});

it("G01 status verifies and persists a newly followed user token", () => {
  expect(
    harness.run([
      "profile",
      "add",
      "--id",
      "work",
      "--user",
      "work-user",
      "--name",
      "Work User",
      "--email",
      "work@example.com",
    ]).status,
  ).toBe(0);
  expect(harness.run(["bind", harness.root, "work"]).status).toBe(0);
  const fake = installFakeGh(harness.root, {
    tokens: { "github.com::work-user": "FAKE_LIVE" },
  });
  const r = harness.run(["status"], harness.root, {
    ...fake.env(harness.env),
    ACCT_FOLLOW_GH: "1",
  });
  expect(r.stdout).toContain("work");
  expect(
    fs.existsSync(path.join(harness.env.ACCT_CONFIG_DIR!, "secrets.json")),
  ).toBe(true);
  expect(fake.calls().some((c) => c.argv[0] === "api")).toBe(true);
});
