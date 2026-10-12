import { fishQuote } from "../../src/shell/hooks.js";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { isolated } from "../harness/isolation.js";
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
  expect(harness.git(["init", "-q"]).status).toBe(0);
  expect(harness.run(["bind", harness.root, "a"]).status).toBe(0);
  expect(harness.run(["install"]).status).toBe(0);
}
function token() {
  expect(
    harness.run(
      ["profile", "token", "a", "--stdin"],
      harness.root,
      {},
      "fake-a",
    ).status,
  ).toBe(0);
}
describe("phase 4 truthful diagnostics and usability", () => {
  it("status and offline doctor explain missing shell setup", () => {
    setup();
    for (const argv of [["status"], ["doctor"]]) {
      const r = harness.run(argv, harness.root, { SHELL: "/bin/zsh" });
      expect(r.stdout).toContain("shell hook not loaded in this shell");
      expect(r.stdout).toContain("other-user");
      expect(r.stdout).toContain('eval "$(acct hook zsh)"');
      expect(r.stdout).toContain("~/.zshrc");
    }
  });
  it("offline doctor makes no API calls or gh token-value persistence", () => {
    setup();
    const fake = installFakeGh(harness.root, {
      tokens: { "github.com::alice": "fake-live" },
      apiFailure: true,
    });
    harness.run(["doctor"], harness.root, {
      ...fake.env(harness.env),
      ACCT_FOLLOW_GH: "1",
    });
    expect(fake.calls().some((c) => c.argv[0] === "api")).toBe(false);
    expect(fs.existsSync(path.join(harness.root, "acct/secrets.json"))).toBe(
      false,
    );
  });
  it("missing binding warns and rebind moves its entire subtree", () => {
    setup();
    const old = path.join(harness.root, "old"),
      nested = path.join(old, "nested");
    fs.mkdirSync(nested, { recursive: true });
    harness.git(["init", "-q", old]);
    harness.git(["init", "-q", nested]);
    expect(harness.run(["bind", old, "a"]).status).toBe(0);
    expect(harness.run(["bind", nested, "a"]).status).toBe(0);
    fs.rmSync(old, { recursive: true });
    expect(harness.run(["doctor"]).stdout).toContain(
      "binding path missing (moved or deleted?)",
    );
    const target = path.join(harness.root, "moved");
    fs.mkdirSync(target);
    harness.git(["init", "-q", target]);
    expect(harness.run(["rebind", old, target]).status).toBe(0);
    expect(
      fs.readFileSync(path.join(harness.root, "acct/config.yaml"), "utf8"),
    ).toContain(target + "/nested");
  });
  it.each(["v1", "v2"])(
    "doctor detects missing executable and stale %s hook header",
    (version) => {
      setup();
      const hook = path.join(harness.root, "acct/hooks/pre-commit");
      let s = fs.readFileSync(hook, "utf8");
      s = s.replace(process.execPath, "/missing/acct-node");
      fs.writeFileSync(hook, s);
      expect(harness.run(["doctor"]).stdout).toContain("shim-target-missing");
      fs.writeFileSync(
        hook,
        s.replace("# acct managed hook v3", `# acct managed hook ${version}`),
      );
      expect(harness.run(["doctor"]).stdout).toContain("hook-version-stale");
    },
  );
  it("doctor detects missing credential-helper JS path", () => {
    setup();
    const shim = path.join(harness.root, "acct/bin/git-credential-acct");
    let s = fs.readFileSync(shim, "utf8");
    s = s.replace(
      path.resolve("bin/git-credential-acct.js"),
      "/missing/helper.js",
    );
    fs.writeFileSync(shim, s);
    expect(harness.run(["doctor"]).stdout).toContain("shim-target-missing");
  });
  it("Fish gets native exports and the Fish hook requests them", () => {
    setup();
    token();
    const r = harness.run(["shell-env", "--fish"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("set -gx GH_TOKEN 'fake-a'");
    expect(r.stdout).toContain("set -e GITHUB_TOKEN");
    expect(r.stdout).not.toContain("export ");
    const script = harness.run(["hook", "fish"]).stdout;
    expect(script).toContain("shell-env --fish");
    expect(script).toContain("ACCT_SHELL_HOOK");
    expect(script).toContain("acct_refresh");
  });
  it("Fish serializer escapes backslashes and single quotes", () => {
    expect(fishQuote("a\\b'c")).toBe("'a\\\\b\\'c'");
  });
  it("native Fish evaluates the generated exports when installed", (ctx) => {
    if (spawnSync("fish", ["--version"], { env: harness.env }).error)
      ctx.skip();
    setup();
    token();
    const file = path.join(harness.root, "env.fish");
    fs.writeFileSync(file, harness.run(["shell-env", "--fish"]).stdout);
    const r = spawnSync(
      "fish",
      ["--no-config", "-c", `source '${file}'; printf '%s' "$GH_TOKEN"`],
      { env: harness.env, cwd: harness.root, encoding: "utf8" },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("fake-a");
  });
  it("wizard Ctrl-C exits one without a config mutation", async () => {
    const r = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        const c = spawn(
          process.execPath,
          [path.resolve("bin/acct.js"), "init"],
          { cwd: harness.root, env: harness.env },
        );
        let sent = false;
        c.stdout.on("data", (data) => {
          if (!sent && String(data).includes("Use the identity")) {
            sent = true;
            c.kill("SIGINT");
          }
        });
        c.stderr.resume();
        c.on("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    expect(r.code).toBe(1);
    expect(fs.existsSync(path.join(harness.root, "acct/config.yaml"))).toBe(
      false,
    );
  });
  it.each([
    ["ALICE", 0],
    ["other", 1],
    [null, 2],
  ])("whoami reports %s with exit %s", (user, code) => {
    setup();
    token();
    const fake = installFakeGh(harness.root, {
      apiUser: user ?? undefined,
      apiFailure: user === null,
    });
    const r = harness.run(["whoami"], harness.root, fake.env(harness.env));
    expect(r.status, r.stdout + r.stderr).toBe(code);
    if (user === null) expect(r.stdout).toContain("actual=unknown (");
  });
  it("status reports measured auth state and inactive local hooks", () => {
    setup();
    token();
    harness.git(["config", "--local", "core.hooksPath", ".husky"]);
    harness.git(["config", "--local", "user.email", "wrong@example.com"]);
    const fake = installFakeGh(harness.root, { apiUser: "ALICE" });
    const r = harness.run(["status"], harness.root, fake.env(harness.env));
    expect(r.stdout).toContain("auth state: verified");
    expect(r.stdout).toContain("not enforced here");
    expect(r.stdout).not.toContain("will refuse");
    expect(r.stdout).not.toContain("LEAK RISK");
    expect(r.stdout).toContain("acct install --repo");
  });
  it.each(["", "n\na\n"])(
    "wizard cancellation at EOF leaves config unchanged (%j)",
    (input) => {
      const r = spawnSync(
        process.execPath,
        [path.resolve("bin/acct.js"), "init"],
        {
          cwd: harness.root,
          env: harness.env,
          input,
          encoding: "utf8",
          timeout: 1500,
          maxBuffer: 16000,
        },
      );
      expect(r.status, r.error?.message).toBe(1);
      expect(r.stderr).toContain("cancelled");
      expect(fs.existsSync(path.join(harness.root, "acct/config.yaml"))).toBe(
        false,
      );
    },
  );
  it("partial flags seed the wizard including host and force", () => {
    const fake = installFakeGh(harness.root, {
      tokens: { "enterprise.example::alice": "fake-enterprise" },
    });
    const r = harness.run(
      [
        "init",
        "--id",
        "a",
        "--user",
        "alice",
        "--email",
        "alice@example.com",
        "--host",
        "enterprise.example",
        "--force",
        "--import-gh",
      ],
      harness.root,
      fake.env(harness.env),
      "Alice\ny\n",
    );
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).not.toContain("enter id:");
    expect(r.stdout).not.toContain("enter email:");
    expect(r.stdout).toContain("alice@enterprise.example");
    expect(harness.run(["profile", "show", "a"]).stdout).toContain(
      '"host": "enterprise.example"',
    );
  });
  it.each([
    "url=not-a-url\n",
    "url=https://github.com/a\nurl=https://github.com/b\n",
  ])("malformed or duplicate URL cannot return credentials", (suffix) => {
    setup();
    token();
    const r = spawnSync(
      process.execPath,
      [path.resolve("bin/git-credential-acct.js"), "get"],
      {
        cwd: harness.root,
        env: harness.env,
        input: "protocol=https\nhost=github.com\n" + suffix + "\n",
        encoding: "utf8",
      },
    );
    expect(r.stdout).toContain("quit=1");
    expect(r.stdout).not.toContain("fake-a");
  });
});
