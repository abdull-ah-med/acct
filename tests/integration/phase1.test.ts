import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { installNativeCommand } from "../harness/native-command.js";
import { isolated } from "../harness/isolation.js";
import { installFakeGh, ensureDistBuild } from "../harness/fake-gh.js";

ensureDistBuild();
let w: ReturnType<typeof isolated>;
beforeEach(() => { w = isolated(); });
afterEach(() => w.close());
function profile(id = "work", host = "github.com", user = "work-user") {
  const r = w.run(["profile", "add", "--id", id, "--user", user, "--host", host, "--name", "Work User", "--email", "work@example.com"]);
  expect(r.status, r.stderr).toBe(0);
}
function bound(mode = "strict") {
  profile();
  expect(w.run(["bind", w.root, "work", "--enforce", mode]).status).toBe(0);
}
function token(id = "work", value = "FAKE_WORK_TOKEN") {
  expect(w.run(["profile", "token", id, "--stdin"], w.root, {}, value + "\n").status).toBe(0);
}
describe("Phase 1 isolation boundaries", () => {
  it("G01 uses the user-scoped live token offline without querying api", () => {
    bound();
    const fake = installFakeGh(w.root, {tokens: {"github.com::work-user": "FAKE_A"}, activeUser: "other", apiFailure: true});
    const r = w.run(["shell-env"], w.root, {...fake.env(w.env), ACCT_FOLLOW_GH: "1"});
    expect(r.stdout).toContain("GH_TOKEN='FAKE_A'");
    expect(fake.calls().some(c => c.argv[0] === "api")).toBe(false);
    expect(fs.existsSync(path.join(w.env.ACCT_CONFIG_DIR!, "secrets.json"))).toBe(false);
  });
  it.each(["strict", "warn", "off"])("G01 missing token is safe in %s mode", mode => {
    bound(mode);
    const r = w.run(["shell-env"]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.includes("acct-blocked-no-token")).toBe(mode === "strict");
    if (mode !== "off") expect(r.stderr).toContain("no token for profile work");
  });
  it("C06 replaces inherited Enterprise host and tokens with canonical public host", () => {
    profile("work", "GitHub.COM:443");
    expect(w.run(["bind", w.root, "work"]).status).toBe(0);
    token();
    const r = w.run(["shell-env"], w.root, {GH_HOST: "enterprise.invalid", GH_ENTERPRISE_TOKEN: "FAKE_STALE"});
    expect(r.stdout).toContain("GH_HOST='github.com'");
    expect(r.stdout).toContain("GH_TOKEN='FAKE_WORK_TOKEN'");
    expect(r.stdout).toContain("unset GH_ENTERPRISE_TOKEN");
  });
  it("C07 refuses unknown forced profiles and missing-token gh before child invocation", () => {
    const fake = installFakeGh(w.root, {passthrough: true});
    expect(w.run(["exec", "--profile", "missing", "gh", "--version"], w.root, fake.env(w.env)).status).not.toBe(0);
    expect(fake.calls()).toHaveLength(0);
    bound();
    expect(w.run(["exec", "gh", "--version"], w.root, fake.env(w.env)).status).not.toBe(0);
    expect(fake.calls()).toHaveLength(0);
  });
  it.each([["--help"], ["--version"], ["--profile", "x", "pr", "list"]].map(args => [args]))("C08 C24 wraps once and forwards child flags %j", args => {
    bound(); token();
    const fake = installFakeGh(w.root, {passthrough: true});
    expect(w.run(["wrap-install"]).status).toBe(0);
    const env = {...fake.env(w.env), PATH: path.join(w.env.ACCT_CONFIG_DIR!, "wrap-bin") + path.delimiter + fake.env(w.env).PATH};
    const r = w.run(["exec", "gh", ...args], w.root, env);
    expect(r.status, r.stderr).toBe(0);
    expect(fake.calls().map(c => c.argv)).toEqual([args]);
  });
  it.each([["auth", "--hostname", "github.com", "token"], ["auth", "-h", "github.com", "token"], ["auth", "status", "-t"], ["auth", "status", "--show-token"]].map(args => [args]))("C25 blocks structural auth bypass %j", args => {
    const r = w.run(["exec", "gh", ...args]);
    expect(r.status).not.toBe(0);
    expect(w.fake.calls()).toHaveLength(0);
  });
  it.each(["secrets.json", "config.yaml"])("C04 C27 corrupt %s cannot fall through or disclose contents", file => {
    bound(); token();
    const marker = path.join(w.root, "later-called");
    fs.writeFileSync(path.join(w.env.ACCT_CONFIG_DIR!, file), "SECRET_SENTINEL_BAD_JSON");
    const helper = `!${process.execPath} ${path.resolve("bin/git-credential-acct.js")}`;
    const r = w.git(["-c", "credential.helper=", "-c", "credential.helper=" + helper, "-c", `credential.helper=!touch '${marker}'; printf 'username=other\\npassword=FAKE_FALLBACK\\n'`, "credential", "fill"], w.root, {}, "protocol=https\nhost=github.com\n\n");
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
    expect(r.stdout + r.stderr).not.toContain("SECRET_SENTINEL");
  });
  it("C05 token deletion removes active and legacy backup copies", () => {
    profile(); token();
    const dir = w.env.ACCT_CONFIG_DIR!;
    fs.copyFileSync(path.join(dir, "secrets.json"), path.join(dir, "secrets.json.bak"));
    expect(w.run(["profile", "remove", "work"]).status).toBe(0);
    expect(fs.existsSync(path.join(dir, "secrets.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "secrets.json.bak"))).toBe(false);
  });
  it("C28 removing a profile preserves a shared account token", () => {
    profile(); profile("second"); token();
    expect(w.run(["profile", "remove", "work"]).status).toBe(0);
    expect(w.run(["bind", w.root, "second"]).status).toBe(0);
    expect(w.run(["shell-env"]).stdout).toContain("FAKE_WORK_TOKEN");
  });
  it.each(["FAKE TOKEN", "FAKE\rTOKEN", "FAKE\0TOKEN", "FAKE\nTOKEN", "FAKE_TOKEN\n\n"])("C11 refuses malformed stdin token %j", value => {
    profile();
    expect(w.run(["profile", "token", "work", "--stdin"], w.root, {}, value).status).not.toBe(0);
    expect(fs.existsSync(path.join(w.env.ACCT_CONFIG_DIR!, "secrets.json"))).toBe(false);
  });
  it.each(["bash", "zsh"])("C23 %s clears stale vars and retries after failure", shell => {
    const fail = path.join(w.root, "failing-node");
    fs.writeFileSync(fail, "#!/bin/sh\nexit 1\n", {mode: 0o755});
    const hook = w.run(["hook", shell], w.root, {ACCT_NODE_PATH: fail});
    const script = hook.stdout + '\nprintf "state:%s:%s:%s\\n" "${GH_TOKEN-unset}" "${_ACCT_LAST_PWD-unset}" "${ACCT_SHELL_HOOK-unset}"\n';
    const r = spawnSync(shell, [shell === "zsh" ? "-f" : "--norc", "-c", script], {env: {...w.env, GH_TOKEN: "FAKE_STALE"}, cwd: w.root, encoding: "utf8"});
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`state:unset:unset:${shell}`);
    expect(r.stderr).toContain("acct:");
  });
  it("C03 real hook rejects author and committer environment overrides", () => {
    bound(); token();
    expect(w.git(["init", "--template="]).status).toBe(0);
    expect(w.run(["install"]).status).toBe(0);
    const r = w.git(["commit", "--allow-empty", "-m", "wrong"], w.root, {GIT_AUTHOR_NAME: "Wrong", GIT_AUTHOR_EMAIL: "wrong@example.com", GIT_COMMITTER_NAME: "Work User", GIT_COMMITTER_EMAIL: "work@example.com"});
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("blocked commit");
  });
});

it("C24 clone forwards flags after the URL to git", () => {
  const native = installNativeCommand(w.fake.binDir, "git", 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const r = w.run(["clone", "https://example.invalid/test", "--depth", "1", "dest"], w.root, native.env);
  expect(r.status, r.stderr).toBe(0);
  expect(JSON.parse(r.stdout)).toEqual(["clone", "https://example.invalid/test", "--depth", "1", "dest"]);
});
