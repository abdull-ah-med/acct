import { beforeEach, afterEach, expect, it } from "vitest";
import { isolated } from "../harness/isolation.js";
let w: ReturnType<typeof isolated>;
beforeEach(() => {
  w = isolated();
  expect(
    w.run([
      "profile",
      "add",
      "--id",
      "work",
      "--user",
      "work-user",
      "--name",
      "Work User",
      "--email",
      "work@corp.com",
    ]).status,
  ).toBe(0);
  expect(w.git(["init", "--template="]).status).toBe(0);
  expect(w.run(["bind", w.root, "work"]).status).toBe(0);
});
afterEach(() => w.close());
it("I11 blocks effective wrong author and committer", () => {
  const r = w.run(["hook-run", "pre-commit"], w.root, {
    GIT_AUTHOR_NAME: "Wrong",
    GIT_AUTHOR_EMAIL: "wrong@example.com",
    GIT_COMMITTER_NAME: "Wrong",
    GIT_COMMITTER_EMAIL: "wrong@example.com",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("blocked commit");
  expect(r.stderr).toContain("work@corp.com");
});
it("allows effective matching identity with case-insensitive email", () => {
  const r = w.run(["hook-run", "pre-commit"], w.root, {
    GIT_AUTHOR_NAME: "Work User",
    GIT_AUTHOR_EMAIL: "WORK@corp.com",
    GIT_COMMITTER_NAME: "Work User",
    GIT_COMMITTER_EMAIL: "work@corp.com",
  });
  expect(r.status, r.stderr).toBe(0);
});
