import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isolated } from "../harness/isolation.js";

let harness: ReturnType<typeof isolated>;
beforeEach(() => {
  harness = isolated();
});
afterEach(() => harness.close());

function setup() {
  const repo = path.join(harness.root, "repo");
  fs.mkdirSync(repo);
  expect(harness.git(["init", "-q", repo]).status).toBe(0);
  expect(
    harness.run([
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
    ]).status,
  ).toBe(0);
  expect(harness.run(["bind", repo, "a"]).status).toBe(0);
  return repo;
}
function install(repo: string, args: string[] = []) {
  const result = harness.run(["install", ...args], repo);
  expect(result.status, result.stderr).toBe(0);
}
interface TraceEvent {
  event: string;
  sid: string;
  time: string;
  child_class?: string;
  child_id?: number;
  hook_name?: string;
  argv?: string[];
}
function hookCalls(repo: string, args: string[]) {
  const trace = path.join(harness.root, "trace.log");
  const eventFile = path.join(harness.root, "events.json");
  fs.writeFileSync(trace, "");
  fs.writeFileSync(eventFile, "");
  const result = harness.git(args, repo, {
    GIT_TRACE: trace,
    GIT_TRACE2_EVENT: eventFile,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(fs.readFileSync(trace, "utf8")).toContain("built-in: git");
  const events: TraceEvent[] = fs
    .readFileSync(eventFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const sid = events.find((event) => event.event === "start")!.sid;
  const hooks = events.filter(
    (event) =>
      event.sid === sid &&
      event.event === "child_start" &&
      event.child_class === "hook",
  );
  return hooks.flatMap((hook) => {
    const end = events.find(
      (event) =>
        event.sid === sid &&
        event.event === "child_exit" &&
        event.child_id === hook.child_id,
    )!;
    return events
      .filter(
        (event) =>
          event.event === "start" &&
          event.sid !== sid &&
          event.time >= hook.time &&
          event.time <= end.time,
      )
      .map((event) => ({ hook: hook.hook_name, argv: event.argv }));
  });
}

it("R1/R2 normal checkout, commit and status spawn no Git from pass-through hooks", () => {
  const repo = setup();
  install(repo);
  expect(
    harness.git(["commit", "--allow-empty", "-qm", "seed"], repo).status,
  ).toBe(0);
  for (const args of [
    ["checkout", "-b", "trace-branch"],
    ["commit", "--allow-empty", "-qm", "trace"],
    ["status", "--porcelain"],
  ]) {
    const calls = hookCalls(repo, args);
    expect(
      calls.filter(
        (call) =>
          !["pre-commit", "pre-merge-commit", "pre-push"].includes(call.hook!),
      ),
    ).toEqual([]);
    expect(
      calls.filter(
        (call) =>
          call.argv?.[1] === "config" &&
          call.argv?.includes("acct.chainHooksPath"),
      ),
    ).toEqual([]);
  }
});

it("R1 global hooks leave git init stderr empty", () => {
  const repo = setup();
  install(repo);
  const fresh = path.join(harness.root, "fresh");
  fs.mkdirSync(fresh);
  const result = harness.git(["init", "-q"], fresh);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
});

it("R1 absent chained stdin hooks need no temporary file", () => {
  const repo = setup();
  install(repo);
  const result = harness.git(
    ["hook", "run", "reference-transaction", "--", "prepared"],
    repo,
    { TMPDIR: path.join(harness.root, "missing") },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
});

it("R1 global previous hooks are baked and survive reinstall", () => {
  const repo = setup();
  const chain = path.join(harness.root, "global-hooks");
  fs.mkdirSync(chain);
  fs.writeFileSync(path.join(chain, "commit-msg"), "#!/bin/sh\nexit 17\n", {
    mode: 0o755,
  });
  expect(
    harness.git(["config", "--global", "core.hooksPath", chain]).status,
  ).toBe(0);
  install(repo);
  install(repo);
  // The restore record can change without changing an already generated hook.
  expect(
    harness.git([
      "config",
      "--global",
      "acct.chainHooksPath",
      path.join(harness.root, "unused"),
    ]).status,
  ).toBe(0);
  expect(
    harness.git(["commit", "--allow-empty", "-qm", "blocked"], repo).status,
  ).not.toBe(0);
  expect(harness.git(["rev-parse", "--verify", "HEAD"], repo).status).not.toBe(
    0,
  );
});

it("R1 repo installs have independent baked chains and remove their directories on uninstall", () => {
  const first = setup();
  const second = path.join(harness.root, "second");
  fs.mkdirSync(second);
  expect(harness.git(["init", "-q", second]).status).toBe(0);
  expect(harness.run(["bind", second, "a"]).status).toBe(0);
  for (const repo of [first, second]) {
    const chain = path.join(repo, ".husky");
    fs.mkdirSync(chain);
    fs.writeFileSync(
      path.join(chain, "commit-msg"),
      "#!/bin/sh\necho chained >> hook.log\n",
      { mode: 0o755 },
    );
    expect(
      harness.git(["config", "--local", "core.hooksPath", ".husky"], repo)
        .status,
    ).toBe(0);
    install(repo, ["--repo"]);
    const commonDir = fs.realpathSync
      .native(path.join(repo, ".git"))
      .replace(/\\/g, "/");
    const digest = createHash("sha256")
      .update(commonDir)
      .digest("hex")
      .slice(0, 16);
    const expected = path.join(harness.root, "acct", "hooks-repo", digest);
    expect(
      harness
        .git(["config", "--local", "--get", "core.hooksPath"], repo)
        .stdout.trim(),
    ).toBe(expected);
    expect(
      fs.readFileSync(path.join(expected, "post-commit"), "utf8"),
    ).toContain("# acct managed hook v3");
  }
  for (const repo of [first, second]) {
    expect(
      harness.git(["commit", "--allow-empty", "-qm", "chain"], repo).status,
    ).toBe(0);
    expect(fs.readFileSync(path.join(repo, "hook.log"), "utf8")).toBe(
      "chained\n",
    );
    expect(harness.run(["status"], repo).stdout).not.toContain(
      "hooks not active",
    );
    expect(harness.run(["doctor"], repo).stdout).not.toMatch(
      /hook-version-stale|shim-target-missing|shim-missing/,
    );
  }
  const dirs = [first, second].map((repo) =>
    harness
      .git(["config", "--local", "--get", "core.hooksPath"], repo)
      .stdout.trim(),
  );
  expect(harness.run(["uninstall"], first).status).toBe(0);
  for (const [index, repo] of [first, second].entries()) {
    expect(
      harness
        .git(["config", "--local", "--get", "core.hooksPath"], repo)
        .stdout.trim(),
    ).toBe(".husky");
    expect(fs.existsSync(dirs[index]!)).toBe(false);
  }
});

it("R1 linked worktree fallback chains the common hooks with stdin and argv", () => {
  const repo = setup();
  const linked = path.join(harness.root, "linked");
  const gitdir = path.join(repo, ".git", "worktrees", "linked");
  fs.mkdirSync(linked);
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(linked, ".git"), `gitdir: ${gitdir}\n`);
  fs.writeFileSync(path.join(gitdir, "commondir"), "../..\n");
  fs.writeFileSync(
    path.join(gitdir, "gitdir"),
    path.join(linked, ".git") + "\n",
  );
  fs.writeFileSync(path.join(gitdir, "HEAD"), "ref: refs/heads/linked\n");
  fs.writeFileSync(
    path.join(repo, ".git/hooks/reference-transaction"),
    '#!/bin/sh\necho "$1" > chained.log\ncat >> chained.log\n',
    { mode: 0o755 },
  );
  install(repo);
  const input = path.join(harness.root, "stdin");
  fs.writeFileSync(input, "unchanged stdin\n");
  const result = harness.git(
    [
      "hook",
      "run",
      "--to-stdin",
      input,
      "reference-transaction",
      "--",
      "prepared",
    ],
    linked,
  );
  expect(result.status, result.stderr).toBe(0);
  expect(fs.readFileSync(path.join(linked, "chained.log"), "utf8")).toBe(
    "prepared\nunchanged stdin\n",
  );
});
