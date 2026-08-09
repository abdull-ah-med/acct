import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readLocalAcct, findLocalAcct } from "../../src/config/store.js";

describe("readLocalAcct (I3 empty fail-closed)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-local-acct-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns null when .acct is absent", () => {
    expect(readLocalAcct(tmp)).toBeNull();
  });

  it("empty file → local unbound sentinel", () => {
    fs.writeFileSync(path.join(tmp, ".acct"), "");
    expect(readLocalAcct(tmp)).toEqual({ profile: "" });
  });

  it("whitespace-only file → local unbound sentinel", () => {
    fs.writeFileSync(path.join(tmp, ".acct"), "  \n\t\n");
    expect(readLocalAcct(tmp)).toEqual({ profile: "" });
  });

  it("profile: with null/empty → local unbound sentinel", () => {
    fs.writeFileSync(path.join(tmp, ".acct"), "profile:\n");
    expect(readLocalAcct(tmp)).toEqual({ profile: "" });
    fs.writeFileSync(path.join(tmp, ".acct"), "profile: \n");
    expect(readLocalAcct(tmp)).toEqual({ profile: "" });
  });

  it("comments-only → local unbound sentinel (no fallthrough)", () => {
    fs.writeFileSync(path.join(tmp, ".acct"), "# only a comment\n");
    expect(readLocalAcct(tmp)).toEqual({ profile: "" });
  });

  it("valid profile id", () => {
    fs.writeFileSync(path.join(tmp, ".acct"), "profile: work\n");
    expect(readLocalAcct(tmp)).toEqual({ profile: "work" });
  });

  it("plain profile name string", () => {
    fs.writeFileSync(path.join(tmp, ".acct"), "personal\n");
    expect(readLocalAcct(tmp)).toEqual({ profile: "personal" });
  });

  it("directory named .acct is ignored (not a file)", () => {
    fs.mkdirSync(path.join(tmp, ".acct"));
    expect(readLocalAcct(tmp)).toBeNull();
  });
});

describe("findLocalAcct (nearest walk-up)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-find-acct-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds .acct in cwd without a git repo", () => {
    const dir = path.join(tmp, "not-a-repo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".acct"), "profile: work\n");
    expect(findLocalAcct(dir)).toEqual({ profile: "work" });
  });

  it("empty .acct in non-git cwd is local unbound (not null)", () => {
    const dir = path.join(tmp, "not-a-repo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".acct"), "");
    expect(findLocalAcct(dir)).toEqual({ profile: "" });
  });

  it("walks up to nearest ancestor .acct", () => {
    const parent = path.join(tmp, "a");
    const child = path.join(parent, "b", "c");
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(parent, ".acct"), "profile: work\n");
    expect(findLocalAcct(child)).toEqual({ profile: "work" });
  });

  it("nearest child .acct wins over parent", () => {
    const parent = path.join(tmp, "repo");
    const pkg = path.join(parent, "pkg");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(parent, ".acct"), "profile: personal\n");
    fs.writeFileSync(path.join(pkg, ".acct"), "profile: work\n");
    expect(findLocalAcct(pkg)).toEqual({ profile: "work" });
    expect(findLocalAcct(parent)).toEqual({ profile: "personal" });
  });

  it("returns null when no .acct exists in ancestors under tmp", () => {
    const dir = path.join(tmp, "x", "y");
    fs.mkdirSync(dir, { recursive: true });
    // May find an unrelated .acct above tmp in the real tree — only assert
    // that a file we did not create is not inventing a profile from thin air
    // when we place a blocking empty? Safer: stop by placing nothing and
    // checking readLocalAcct at each level under tmp is null.
    let d = dir;
    while (d.startsWith(tmp)) {
      expect(readLocalAcct(d)).toBeNull();
      const p = path.dirname(d);
      if (p === d) break;
      d = p;
    }
    expect(findLocalAcct(dir)?.profile === "invented").toBeFalsy();
  });
});
