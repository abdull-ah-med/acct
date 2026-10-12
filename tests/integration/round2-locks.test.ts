import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolated } from "../harness/isolation.js";

let harness: ReturnType<typeof isolated>;
beforeEach(() => {
  harness = isolated();
});
afterEach(() => harness.close());
const add = [
  "profile",
  "add",
  "--id",
  "a",
  "--user",
  "alice",
  "--name",
  "Alice",
  "--email",
  "alice@example.com",
];
function writeLock(file: string, content: string, ageMs: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const mtime = new Date(Date.now() - ageMs);
  fs.utimesSync(file, mtime, mtime);
}
it.each(["", "unfinished{", "{}", '{"pid":1,"hostname":"host"}'])(
  "R3 old invalid config lock %j is recovered",
  (content) => {
    const lock = path.join(harness.root, "acct/config.lock");
    writeLock(lock, content, 120000);
    const result = harness.run(add, harness.root, {
      ACCT_LOCK_TIMEOUT_MS: "150",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(harness.run(["profile", "list"]).stdout).toContain("a\t");
    expect(fs.existsSync(lock)).toBe(false);
    expect(fs.existsSync(lock + ".recovery")).toBe(false);
  },
);
it("R3 fresh empty lock times out with a path and manual recovery instructions", () => {
  const lock = path.join(harness.root, "acct/config.lock");
  writeLock(lock, "", 1000);
  const result = harness.run(add, harness.root, {
    ACCT_LOCK_TIMEOUT_MS: "150",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(lock);
  expect(result.stderr).toContain("no acct process is running");
  expect(result.stderr).toContain(`rm '${lock}'`);
  expect(fs.readFileSync(lock, "utf8")).toBe("");
  expect(fs.existsSync(path.join(harness.root, "acct/config.yaml"))).toBe(
    false,
  );
});
it("R3 credential fill recovers an old empty secrets lock", () => {
  expect(harness.run(add).status).toBe(0);
  expect(harness.run(["bind", harness.root, "a"]).status).toBe(0);
  expect(
    harness.run(
      ["profile", "token", "a", "--stdin"],
      harness.root,
      {},
      "FAKE_STORED",
    ).status,
  ).toBe(0);
  expect(harness.run(["install"]).status).toBe(0);
  const lock = path.join(harness.root, "acct/secrets.json.lock");
  writeLock(lock, "", 120000);
  const result = harness.git(
    ["credential", "fill"],
    harness.root,
    { ACCT_LOCK_TIMEOUT_MS: "150" },
    "protocol=https\nhost=github.com\n\n",
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("password=FAKE_STORED");
  expect(fs.existsSync(lock)).toBe(false);
});
