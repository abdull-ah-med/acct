import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { isolated } from "../harness/isolation.js";
let harness: ReturnType<typeof isolated>;
beforeEach(() => {
  harness = isolated();
});
afterEach(() => harness.close());
const args = [
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
function add() {
  const r = harness.run(args);
  expect(r.status, r.stderr).toBe(0);
}
function repo() {
  const dir = path.join(harness.root, "repo");
  fs.mkdirSync(dir);
  expect(harness.git(["init", "-q", dir]).status).toBe(0);
  add();
  expect(harness.run(["bind", dir, "a"]).status).toBe(0);
  return dir;
}
function install(dir = harness.root, extra = {}) {
  const r = harness.run(["install"], dir, extra);
  expect(r.status, r.stderr).toBe(0);
}
function child(argv: string[], env = harness.env) {
  return new Promise<{ code: number | null; out: string; err: string }>(
    (resolve) => {
      const c = spawn(
        process.execPath,
        [path.resolve("bin/acct.js"), ...argv],
        { cwd: harness.root, env },
      );
      let out = "",
        err = "";
      c.stdout.on("data", (d) => (out += d));
      c.stderr.on("data", (d) => (err += d));
      c.on("exit", (code) => resolve({ code, out, err }));
    },
  );
}
function snapshot() {
  return Object.fromEntries(
    ["config.yaml", "git/a.inc", "git/_managed.inc"]
      .map((f) => [
        f,
        fs.existsSync(path.join(harness.root, "acct", f))
          ? fs.readFileSync(path.join(harness.root, "acct", f), "utf8")
          : null,
      ])
      .concat([
        [
          "gitconfig",
          fs.existsSync(harness.env.GIT_CONFIG_GLOBAL!)
            ? fs.readFileSync(harness.env.GIT_CONFIG_GLOBAL!, "utf8")
            : null,
        ],
      ]),
  );
}
describe("phase 3 transaction and lifecycle contracts", () => {
  it("concurrent profile writers preserve both updates", async () => {
    const results = await Promise.all([
      child(args),
      child(args.map((a) => (a === "a" ? "b" : a))),
    ]);
    expect(results.map((r) => r.code)).toEqual([0, 0]);
    const r = harness.run(["profile", "list"]);
    expect(r.stdout).toContain("a\t");
    expect(r.stdout).toContain("b\t");
  });
  it("live old lock is never stolen", () => {
    fs.mkdirSync(path.join(harness.root, "acct"));
    const lock = path.join(harness.root, "acct/config.lock");
    fs.writeFileSync(
      lock,
      JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        nonce: "owner",
        createdAt: 0,
      }),
    );
    fs.utimesSync(lock, new Date(0), new Date(0));
    const r = harness.run(args, harness.root, { ACCT_LOCK_TIMEOUT_MS: "150" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(String(process.pid));
    expect(JSON.parse(fs.readFileSync(lock, "utf8")).nonce).toBe("owner");
  });
  it("contention sleeps instead of consuming a CPU core", () => {
    const lock = path.join(harness.root, "wait.lock");
    fs.writeFileSync(
      lock,
      JSON.stringify({
        pid: process.pid,
        hostname: os.hostname(),
        nonce: "live",
        createdAt: 0,
      }),
    );
    const script = `import {withFileLock} from ${JSON.stringify(new URL("../../dist/util/fs-safe.js", import.meta.url).href)}; const start=process.cpuUsage();const time=Date.now();try{withFileLock(process.argv[1],()=>{},2050);}catch{}console.log(JSON.stringify({cpu:process.cpuUsage(start),elapsed:Date.now()-time}));`;
    const r = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script, lock],
      { cwd: harness.root, env: harness.env, encoding: "utf8" },
    );
    expect(r.status, r.stderr).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.elapsed).toBeGreaterThanOrEqual(2000);
    expect(
      (result.cpu.user + result.cpu.system) / 1000 / result.elapsed,
    ).toBeLessThan(0.2);
  });
  it("local marker failure restores repository config and marker", () => {
    const dir = repo();
    install(dir);
    const config = fs.readFileSync(path.join(dir, ".git/config"));
    const r = harness.run(["local", "set", "a"], dir, {
      ACCT_TEST_FAIL_AT: "local",
    });
    expect(r.status).toBe(1);
    expect(fs.readFileSync(path.join(dir, ".git/config"))).toEqual(config);
    expect(fs.existsSync(path.join(dir, ".acct"))).toBe(false);
  });
  it("dead local lock is recovered", () => {
    fs.mkdirSync(path.join(harness.root, "acct"));
    fs.writeFileSync(
      path.join(harness.root, "acct/config.lock"),
      JSON.stringify({
        pid: 2147483647,
        hostname: os.hostname(),
        nonce: "dead",
        createdAt: 0,
      }),
    );
    add();
    expect(fs.existsSync(path.join(harness.root, "acct/config.lock"))).toBe(
      false,
    );
  });
  it("uninstalled edits do not write Git artifacts", () => {
    add();
    expect(fs.existsSync(harness.env.GIT_CONFIG_GLOBAL!)).toBe(false);
    expect(fs.existsSync(path.join(harness.root, "acct/git/a.inc"))).toBe(
      false,
    );
    const dir = path.join(harness.root, "plain");
    fs.mkdirSync(dir);
    const r = harness.run(["bind", dir, "a"]);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain("acct is not installed");
    expect(fs.existsSync(harness.env.GIT_CONFIG_GLOBAL!)).toBe(false);
  });
  it.each(["config", "includes", "gitconfig", "hooks", "hook-config"])(
    "failed install restores bytes at %s",
    (stage) => {
      add();
      fs.writeFileSync(
        harness.env.GIT_CONFIG_GLOBAL!,
        "[alias]\n mine = status\n",
      );
      const before = snapshot();
      const r = harness.run(["install"], harness.root, {
        ACCT_TEST_FAIL_AT: stage,
      });
      expect(r.status, r.stdout + r.stderr).toBe(1);
      expect(snapshot()).toEqual(before);
    },
  );
  it("invalid import preflights before config mutation", () => {
    const before = snapshot();
    const r = harness.run([...args, "--import-gh"]);
    expect(r.status).toBe(1);
    expect(snapshot()).toEqual(before);
  });
  // Mode bits and unprivileged symlinks are POSIX-only.
  it.skipIf(process.platform === "win32")(
    "symlinked gitconfig retains link and 0600 target",
    () => {
      add();
      const target = path.join(harness.root, "dotfile");
      fs.writeFileSync(target, "[alias]\n mine = status\n", { mode: 0o600 });
      fs.symlinkSync(target, harness.env.GIT_CONFIG_GLOBAL!);
      install();
      expect(
        fs.lstatSync(harness.env.GIT_CONFIG_GLOBAL!).isSymbolicLink(),
      ).toBe(true);
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
      expect(fs.readFileSync(target, "utf8")).toContain("acct managed");
    },
  );
  it("Git's own held lock prevents a rewrite", () => {
    add();
    fs.writeFileSync(
      harness.env.GIT_CONFIG_GLOBAL!,
      "[alias]\n mine = status\n",
    );
    fs.writeFileSync(harness.env.GIT_CONFIG_GLOBAL! + ".lock", "external");
    const before = snapshot();
    const r = harness.run(["install"], harness.root, {
      ACCT_LOCK_TIMEOUT_MS: "150",
    });
    expect(r.status).toBe(1);
    expect(snapshot()).toEqual(before);
    expect(
      fs.readFileSync(harness.env.GIT_CONFIG_GLOBAL! + ".lock", "utf8"),
    ).toBe("external");
  });
  it("global hooks cover new repositories and chain repository hooks", () => {
    const dir = repo();
    fs.writeFileSync(
      path.join(dir, ".git/hooks/pre-commit"),
      "#!/bin/sh\nexit 17\n",
      { mode: 0o755 },
    );
    install(dir);
    expect(
      harness
        .git(["config", "--global", "--get", "core.hooksPath"])
        .stdout.trim(),
    ).toBe(path.join(harness.root, "acct/hooks"));
    expect(
      harness.git(["commit", "--allow-empty", "-qm", "blocked"], dir).status,
    ).not.toBe(0);
    expect(harness.git(["rev-parse", "--verify", "HEAD"], dir).status).not.toBe(
      0,
    );
  });
  it("repo install chains local hooks and uninstall restores exact paths", () => {
    const dir = repo(),
      previous = path.join(harness.root, "husky");
    fs.mkdirSync(previous);
    fs.writeFileSync(
      path.join(previous, "commit-msg"),
      "#!/bin/sh\necho ran >> '" +
        path.join(harness.root, "message.log") +
        "'\n",
      { mode: 0o755 },
    );
    harness.git(["config", "--local", "core.hooksPath", previous], dir);
    expect(harness.run(["install", "--repo"], dir).status).toBe(0);
    expect(
      harness.git(["commit", "--allow-empty", "-qm", "chain"], dir).status,
    ).toBe(0);
    expect(
      fs.readFileSync(path.join(harness.root, "message.log"), "utf8"),
    ).toContain("ran");
    expect(harness.run(["uninstall"], dir).status).toBe(0);
    expect(
      harness
        .git(["config", "--local", "--get", "core.hooksPath"], dir)
        .stdout.trim(),
    ).toBe(previous);
  });
  it("pre-push preserves stdin and arguments for the chained hook", () => {
    const dir = repo();
    const target = path.join(dir, ".git/hooks/pre-push"),
      log = path.join(harness.root, "push.log");
    fs.writeFileSync(
      target,
      `#!/bin/sh\necho "$1|$2" > '${log}'\ncat >> '${log}'\n`,
      { mode: 0o755 },
    );
    install(dir);
    const input =
      "refs/heads/gone " +
      "0".repeat(40) +
      " refs/heads/gone " +
      "0".repeat(40) +
      "\n";
    const stdin = path.join(harness.root, "stdin");
    fs.writeFileSync(stdin, input);
    const r = harness.git(
      [
        "hook",
        "run",
        "--to-stdin",
        stdin,
        "pre-push",
        "--",
        "origin",
        "/local/remote.git",
      ],
      dir,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(log, "utf8")).toBe(
      "origin|/local/remote.git\n" + input,
    );
  });
  it("missing required fields are rejected instead of defaulted", () => {
    add();
    const file = path.join(harness.root, "acct/config.yaml");
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        bindings: [],
        defaultEnforce: "strict",
        installed: false,
      }),
    );
    const r = harness.run(["profile", "list"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("profiles");
  });
  it.each([
    ["protocol", "other"],
    ["enforce", "wat"],
    ["githubUser", 42],
  ])("invalid runtime field %s fails without leaking value", (field, value) => {
    add();
    const file = path.join(harness.root, "acct/config.yaml");
    const raw = {
      version: 1,
      defaultEnforce: "strict",
      installed: false,
      bindings: [],
      profiles: [
        {
          id: "a",
          name: "Alice",
          email: "a@example.com",
          host: "github.com",
          githubUser: "alice",
          protocol: "https",
          [field]: value,
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(raw));
    const r = harness.run(["profile", "list"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("profiles[0]." + field);
  });
  it.each(
    [
      ["profile", "add", ...args.slice(2), "--protocol", "wrong"],
      ["enforce", "wrong"],
      ["hook", "wrong"],
    ].map((argv) => [argv]),
  )("enum choices reject %j", (argv) => {
    expect(harness.run(argv).status).toBe(1);
  });
});
