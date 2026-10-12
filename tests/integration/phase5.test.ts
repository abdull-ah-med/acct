import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, it, expect } from "vitest";
import { isolated } from "../harness/isolation.js";
import { installNativeCommand } from "../harness/native-command.js";
import { installFakeGh } from "../harness/fake-gh.js";
let harness: ReturnType<typeof isolated>;
beforeEach(() => {
  harness = isolated();
});
afterEach(() => harness.close());
function setup() {
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
  harness.git(["init", "-q"]);
  harness.run(["bind", harness.root, "a"]);
  expect(harness.run(["install"]).status).toBe(0);
}
function commit(message = "base") {
  const r = harness.git(["commit", "--allow-empty", "-qm", message]);
  expect(r.status, r.stderr).toBe(0);
  return harness.git(["rev-parse", "HEAD"]).stdout.trim();
}
it("records matching author/committer and allows an amend", () => {
  setup();
  commit();
  expect(
    harness.git(["commit", "--amend", "--allow-empty", "--no-edit"]).status,
  ).toBe(0);
  expect(
    harness.git(["log", "-1", "--format=%an <%ae>|%cn <%ce>"]).stdout.trim(),
  ).toBe("Alice <alice@example.com>|Alice <alice@example.com>");
});
it("cherry-pick preserves foreign author and verifies the matching committer before push", () => {
  setup();
  const base = commit(),
    tree = harness.git(["rev-parse", "HEAD^{tree}"]).stdout.trim();
  const foreign = harness
    .git(["commit-tree", tree, "-p", base, "-m", "foreign"], harness.root, {
      GIT_AUTHOR_NAME: "Foreign",
      GIT_AUTHOR_EMAIL: "foreign@example.com",
      GIT_COMMITTER_NAME: "Foreign",
      GIT_COMMITTER_EMAIL: "foreign@example.com",
    })
    .stdout.trim();
  const pick = harness.git(["cherry-pick", "--allow-empty", foreign]);
  expect(pick.status, pick.stderr).toBe(0);
  expect(harness.git(["log", "-1", "--format=%an|%cn"]).stdout.trim()).toBe(
    "Foreign|Alice",
  );
  const sha = harness.git(["rev-parse", "HEAD"]).stdout.trim();
  const push = harness.run(
    ["hook-run", "pre-push", "origin", "/local.git"],
    harness.root,
    {},
    `refs/heads/main ${sha} refs/heads/main ${base}\n`,
  );
  expect(push.status, push.stderr).toBe(0);
});
it("a merge uses the matching identity and the merge hook catches an override", () => {
  setup();
  const base = commit(),
    tree = harness.git(["rev-parse", "HEAD^{tree}"]).stdout.trim();
  const other = harness
    .git(["commit-tree", tree, "-p", base, "-m", "other"])
    .stdout.trim();
  const merge = harness.git(
    ["merge", "--no-ff", other, "-m", "merge"],
    harness.root,
    {
      GIT_COMMITTER_EMAIL: "wrong@example.com",
    },
  );
  expect(merge.status).not.toBe(0);
  expect(merge.stderr).toContain("committer");
});
it("SSH verification ignores a wrong PAT and honors the effective SSH command", () => {
  setup();
  harness.run(
    ["profile", "token", "a", "--stdin"],
    harness.root,
    {},
    "fake-wrong",
  );
  const native = installNativeCommand(
    path.join(harness.root, "ssh-bin"),
    "ssh",
    `if(process.argv.includes("-G"))console.log("hostname github.com");else {console.error("Hi ALICE! authenticated");process.exitCode=1;}`,
  );
  const r = harness.run(
    ["hook-run", "pre-push", "origin", "ssh://git@work-alias/repo.git"],
    harness.root,
    { ...native.env, GIT_SSH_COMMAND: `'${native.executable}'` },
    "",
  );
  expect(r.status, r.stderr).toBe(0);
  expect(harness.fake.calls().some((c) => c.argv[0] === "api")).toBe(false);
});
it("unmanaged SSH host does not query profile authentication", () => {
  setup();
  const native = installNativeCommand(
    path.join(harness.root, "ssh-bin"),
    "ssh",
    `console.log("hostname gitlab.com");`,
  );
  const r = harness.run(
    ["hook-run", "pre-push", "origin", "git@gitlab-alias:owner/repo"],
    harness.root,
    { ...native.env, GIT_SSH_COMMAND: `'${native.executable}'` },
    "",
  );
  expect(r.status, r.stderr).toBe(0);
  expect(r.stderr).toContain("unmanaged SSH host");
});
it("profile changes after uninstall do not reinstall includes or hooks", () => {
  setup();
  harness.run(["uninstall"]);
  const before = fs.readFileSync(harness.env.GIT_CONFIG_GLOBAL!, "utf8");
  harness.run(
    ["profile", "token", "a", "--stdin"],
    harness.root,
    {},
    "fake-new",
  );
  harness.run(["enforce", "warn"]);
  harness.run(["unbind", harness.root]);
  expect(fs.readFileSync(harness.env.GIT_CONFIG_GLOBAL!, "utf8")).toBe(before);
  expect(
    harness.git(["config", "--global", "--get", "core.hooksPath"]).stdout,
  ).toBe("");
});
it("rebind rollback restores all configuration bytes", () => {
  setup();
  const before = fs.readFileSync(path.join(harness.root, "acct/config.yaml"));
  const target = path.join(harness.root, "new");
  fs.mkdirSync(target);
  harness.git(["init", "-q", target]);
  expect(
    harness.run(["rebind", harness.root, target], harness.root, {
      ACCT_TEST_FAIL_AT: "gitconfig",
    }).status,
  ).toBe(1);
  expect(fs.readFileSync(path.join(harness.root, "acct/config.yaml"))).toEqual(
    before,
  );
});
it("canonical case rules agree with Git on darwin", (ctx) => {
  if (process.platform !== "darwin") ctx.skip();
  setup();
  const upper = harness.root.replace("acct-remediation-", "ACCT-REMEDIATION-");
  const r = harness.run(["bind", upper, "a"]);
  expect(r.status, r.stderr).toBe(0);
  expect(
    (
      fs
        .readFileSync(path.join(harness.root, "acct/config.yaml"), "utf8")
        .match(/profileId:/g) ?? []
    ).length,
  ).toBe(1);
  expect(harness.git(["config", "--get", "user.email"]).stdout.trim()).toBe(
    "alice@example.com",
  );
});
it("bare repository resolution respects GIT_DIR without inheriting ambient profile", () => {
  setup();
  const bare = path.join(harness.root, "bare.git");
  harness.git(["init", "--bare", "-q", bare]);
  const r = harness.run(["status"], harness.root, {
    GIT_DIR: bare,
    ACCT_PROFILE: "wrong",
  });
  expect(r.stdout).toContain("profile: a");
});
it("dangling binding error names its field and gives a working unbind repair", () => {
  setup();
  const file = path.join(harness.root, "acct/config.yaml");
  const source = fs
    .readFileSync(file, "utf8")
    .replace("profileId: a", "profileId: missing");
  fs.writeFileSync(file, source);
  const r = harness.run(["status"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("bindings[0].profileId");
  expect(r.stderr).toContain("acct unbind");
  expect(harness.run(["unbind", harness.root]).status).toBe(0);
});
it("gh returned whitespace is rejected without being persisted or exported", () => {
  setup();
  const fake = installFakeGh(harness.root, {
    tokens: { "github.com::alice": "fake token" },
  });
  const r = harness.run(["shell-env"], harness.root, {
    ...fake.env(harness.env),
    ACCT_FOLLOW_GH: "1",
  });
  expect(r.status).toBe(1);
  expect(r.stdout).not.toContain("fake token");
  expect(fs.existsSync(path.join(harness.root, "acct/secrets.json"))).toBe(
    false,
  );
});
it("Git-config serializers roundtrip quoted helper and include paths", (ctx) => {
  if (process.platform === "win32") ctx.skip();
  const root = path.join(harness.root, 'config "quoted"'),
    dir = path.join(harness.root, 'repo "quoted"');
  fs.mkdirSync(dir);
  harness.git(["init", "-q", dir]);
  const env = { ACCT_CONFIG_DIR: root };
  expect(
    harness.run(
      [
        "profile",
        "add",
        "--id",
        "a",
        "--user",
        "alice",
        "--name",
        "Alice",
        "--email",
        "a@example.com",
      ],
      dir,
      env,
    ).status,
  ).toBe(0);
  harness.run(["bind", dir, "a"], dir, env);
  harness.run(["install"], dir, env);
  harness.run(["profile", "token", "a", "--stdin"], dir, env, "fake-a");
  const r = harness.git(
    ["credential", "fill"],
    dir,
    env,
    "protocol=https\nhost=github.com\n\n",
  );
  expect(r.status, r.stderr).toBe(0);
  expect(r.stdout).toContain("password=fake-a");
});
it("credential erase accepts case variants of the same login", () => {
  setup();
  harness.run(["profile", "token", "a", "--stdin"], harness.root, {}, "fake-a");
  const r = spawnSync(
    process.execPath,
    [path.resolve("bin/git-credential-acct.js"), "erase"],
    {
      cwd: harness.root,
      env: harness.env,
      input:
        "protocol=https\nhost=github.com\nusername=ALICE\npassword=fake-a\n\n",
      encoding: "utf8",
    },
  );
  expect(r.status).toBe(0);
  expect(fs.existsSync(path.join(harness.root, "acct/secrets.json"))).toBe(
    false,
  );
});

it("clone refuses an unknown explicit profile before starting Git", () => {
  setup();
  const source = path.join(harness.root, "source.git"),
    dest = path.join(harness.root, "dest");
  harness.git(["init", "--bare", "-q", source]);
  const r = harness.run(["clone", "--profile", "missing", source, dest]);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain("Unknown profile");
  expect(fs.existsSync(dest)).toBe(false);
});
it("local edits after uninstall leave native Git configuration alone", () => {
  setup();
  harness.run(["uninstall"]);
  const before = fs.readFileSync(path.join(harness.root, ".git/config"));
  const r = harness.run(["local", "set", "a"]);
  expect(r.status, r.stderr).toBe(0);
  expect(r.stderr).toContain("acct is not installed");
  expect(fs.readFileSync(path.join(harness.root, ".git/config"))).toEqual(
    before,
  );
  expect(harness.run(["local", "clear"]).status).toBe(0);
  expect(fs.readFileSync(path.join(harness.root, ".git/config"))).toEqual(
    before,
  );
});
it("strict worktree conflicts block both gh host families and clone", () => {
  setup();
  harness.run([
    "profile",
    "add",
    "--id",
    "b",
    "--host",
    "enterprise.example",
    "--user",
    "bob",
    "--name",
    "Bob",
    "--email",
    "bob@example.com",
  ]);
  const other = isolated();
  try {
    const linked = other.root,
      gitdir = path.join(harness.root, ".git/worktrees/linked");
    harness.run(["bind", linked, "b"]);
    fs.mkdirSync(gitdir, { recursive: true });
    fs.writeFileSync(path.join(linked, ".git"), "gitdir: " + gitdir + "\n");
    fs.writeFileSync(path.join(gitdir, "commondir"), "../..\n");
    fs.writeFileSync(
      path.join(gitdir, "gitdir"),
      path.join(linked, ".git") + "\n",
    );
    fs.writeFileSync(path.join(gitdir, "HEAD"), "ref: refs/heads/linked\n");
    const shell = harness.run(["shell-env"], linked);
    expect(shell.stdout).toContain("GH_TOKEN='acct-blocked-no-token'");
    expect(shell.stdout).toContain(
      "GH_ENTERPRISE_TOKEN='acct-blocked-no-token'",
    );
    const source = path.join(harness.root, "source.git"),
      dest = path.join(linked, "dest");
    harness.git(["init", "--bare", "-q", source]);
    const clone = harness.run(["clone", source, dest], linked);
    expect(clone.status).toBe(1);
    expect(clone.stderr).toContain("cross-profile worktrees");
    expect(fs.existsSync(dest)).toBe(false);
  } finally {
    other.close();
  }
});

it("records both matching identities on a real merge commit", () => {
  setup();
  const base = commit(),
    tree = harness.git(["rev-parse", "HEAD^{tree}"]).stdout.trim();
  const other = harness
    .git(["commit-tree", tree, "-p", base, "-m", "other"])
    .stdout.trim();
  const merge = harness.git(["merge", "--no-ff", other, "-m", "merge"]);
  expect(merge.status, merge.stderr).toBe(0);
  expect(
    harness.git(["log", "-1", "--format=%an <%ae>|%cn <%ce>"]).stdout.trim(),
  ).toBe("Alice <alice@example.com>|Alice <alice@example.com>");
  expect(
    harness
      .git(["rev-list", "--parents", "-1", "HEAD"])
      .stdout.trim()
      .split(" "),
  ).toHaveLength(3);
});
it("doctor explains the configured SSH key limitation", () => {
  setup();
  const key = path.join(harness.root, "ssh-key");
  fs.writeFileSync(key, "fake key");
  expect(harness.run(["profile", "ssh-key", "a", "--path", key]).status).toBe(
    0,
  );
  expect(harness.run(["doctor"]).stdout).toContain(
    "IdentitiesOnly stops agent keys; keys configured for that host in ~/.ssh/config are still offered — acct verifies the authenticated account on push.",
  );
});
