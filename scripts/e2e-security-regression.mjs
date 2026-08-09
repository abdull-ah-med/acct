/**
 * Security regression harness (synthetic tokens + real resolution/helper).
 * Asserts I4 ambient env cannot cross accounts; I6 unbound quit; I8b dual plane;
 * I11b absolute hooks. Never touches Mair.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCT = path.join(ROOT, "bin/acct.js");
const HELPER = path.join(ROOT, "bin/git-credential-acct.js");

let passed = 0;
let failed = 0;

function ok(n) {
  passed++;
  console.log(`  PASS  ${n}`);
}
function fail(n, e) {
  failed++;
  console.log(`  FAIL  ${n}`);
  console.log(`        ${e}`);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    ...opts,
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function acct(args, env, cwd) {
  return run(process.execPath, [ACCT, ...args], { env, cwd });
}

function helper(op, body, cwd, env) {
  return run(process.execPath, [HELPER, op], {
    cwd,
    env: { ...env },
    input: body,
  });
}

const base = fs.mkdtempSync(path.join(ROOT, ".tmp-sec-"));
const configDir = path.join(base, "config");
const gitconfig = path.join(base, "gitconfig");
const personal = path.join(base, "personal");
const work = path.join(base, "work");
const unbound = path.join(base, "unbound");
for (const d of [personal, work, unbound]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(
  gitconfig,
  "[user]\n\tname = G\n\temail = g@e.com\n[credential]\n\thelper = osxkeychain\n",
);

const env = {
  ...process.env,
  ACCT_CONFIG_DIR: configDir,
  GIT_CONFIG_GLOBAL: gitconfig,
  GIT_CONFIG_NOSYSTEM: "1",
  ACCT_SECRET_BACKEND: "file",
};
delete env.GH_TOKEN;
delete env.GITHUB_TOKEN;
delete env.ACCT_PROFILE;

console.log("=== security regression ===\n");

acct(
  [
    "init",
    "--id",
    "personal",
    "--user",
    "acct-sh",
    "--email",
    "dev@example.com",
    "--name",
    "Primary User",
    "--bind",
    personal,
    "--protocol",
    "https",
  ],
  env,
  personal,
);
acct(
  [
    "profile",
    "add",
    "--id",
    "work",
    "--user",
    "user-b",
    "--email",
    "user-b@example.com",
    "--name",
    "Secondary User",
    "--protocol",
    "https",
  ],
  env,
);
acct(["bind", work, "work"], env);

run(process.execPath, [ACCT, "profile", "token", "personal", "--stdin"], {
  env,
  input: "gho_TEST_ONLY_PRIMARY_" + "x".repeat(20),
});
run(process.execPath, [ACCT, "profile", "token", "work", "--stdin"], {
  env,
  input: "gho_TEST_ONLY_SECONDARY_" + "y".repeat(20),
});
acct(["install"], env);

{
  const r = helper(
    "get",
    "protocol=https\nhost=github.com\n\n",
    work,
    { ...env, ACCT_PROFILE: "personal" },
  );
  if (
    r.stdout.includes("username=user-b") &&
    r.stdout.includes("gho_TEST_ONLY_SECONDARY_") &&
    !r.stdout.includes("PRIMARY")
  )
    ok("helper ignores ambient ACCT_PROFILE (I4)");
  else fail("I4 helper", JSON.stringify(r.stdout));
}

{
  const r = helper("get", "protocol=https\nhost=github.com\n\n", unbound, env);
  if (r.stdout.includes("quit=1") && !r.stdout.includes("password="))
    ok("unbound strict quit=1 (I6)");
  else fail("I6 unbound", JSON.stringify(r.stdout));
}

{
  const gc = fs.readFileSync(gitconfig, "utf8");
  const begin = gc.indexOf("acct managed begin");
  const inc = gc.indexOf("includeIf", begin);
  const reset = gc.indexOf('helper = ""', begin);
  if (reset >= 0 && reset < inc) ok("global helper reset before includeIf (I8)");
  else fail("I8 global reset", gc.slice(0, 400));
}

{
  const hooks = path.join(configDir, "hooks", "pre-commit");
  const body = fs.readFileSync(hooks, "utf8");
  if (body.includes("exec ") && body.includes("hook-run") && !/^acct /m.test(body))
    ok("hooks absolute path (I11b)");
  else fail("I11b hooks", body);
}

{
  acct(
    [
      "profile",
      "ssh-key",
      "work",
      "--path",
      path.join(process.env.HOME || "/tmp", ".ssh/work_github"),
    ],
    env,
  );
  const inc = fs.readFileSync(path.join(configDir, "git", "work.inc"), "utf8");
  if (inc.includes('helper = ""') && inc.includes("IdentitiesOnly=yes"))
    ok("ssh-key keeps HTTPS helper (I8b)");
  else fail("I8b dual", inc);
}

{
  const r = acct(["hook-run", "pre-push"], { ...env, ACCT_PROFILE: "personal" }, work);
  // Should evaluate work cwd profile, not personal — may fail identity or pass if no repo
  // Create a fake repo under work with work identity
  const repo = path.join(work, "repo");
  fs.mkdirSync(repo, { recursive: true });
  run("git", ["init"], { cwd: repo, env });
  run("git", ["config", "user.email", "user-b@example.com"], {
    cwd: repo,
    env,
  });
  run("git", ["config", "user.name", "Secondary User"], { cwd: repo, env });
  const r2 = acct(
    ["hook-run", "pre-push"],
    { ...env, ACCT_PROFILE: "personal" },
    repo,
  );
  // With ambient personal ignored, check uses work — principal check may fail without live token
  // Identity check should be ok. If ambient were honored, identity would fail (primary email required).
  // So status 0 or auth-missing for work is OK; identity mismatch for primary would mean regression.
  const out = r2.stdout + r2.stderr;
  if (!/requires "dev@example.com"/.test(out))
    ok("pre-push ignores ambient ACCT_PROFILE identity expectation");
  else fail("pre-push ambient", out);
  void r;
}

{
  const r = helper(
    "store",
    `protocol=https\nhost=github.com\nusername=acct-sh\npassword=gho_TEST_ONLY_SECONDARY_${"y".repeat(20)}\n\n`,
    personal,
    env,
  );
  const g = helper("get", "protocol=https\nhost=github.com\n\n", personal, env);
  if (
    g.stdout.includes("gho_TEST_ONLY_PRIMARY_") &&
    !g.stdout.includes("gho_TEST_ONLY_SECONDARY_")
  )
    ok("store poison ignored (I17)");
  else fail("I17 store poison", JSON.stringify(g.stdout));
  void r;
}

{
  const r = helper("get", "protocol=http\nhost=github.com\n\n", personal, env);
  if (r.stdout.includes("quit=1") && !r.stdout.includes("password="))
    ok("http protocol quit=1 (I16)");
  else fail("I16 http", JSON.stringify(r.stdout));
}

{
  const bad = helper(
    "get",
    "protocol=https\nhost=github.com:8443\n\n",
    personal,
    env,
  );
  const ok443 = helper(
    "get",
    "protocol=https\nhost=github.com:443\n\n",
    personal,
    env,
  );
  const dup = helper(
    "get",
    "protocol=https\nhost=evil.com\nhost=github.com\n\n",
    personal,
    env,
  );
  if (
    bad.stdout.includes("quit=1") &&
    !bad.stdout.includes("password=") &&
    ok443.stdout.includes("password=") &&
    dup.stdout.includes("quit=1") &&
    !dup.stdout.includes("password=")
  ) {
    ok("I7 port allowlist + duplicate host fail-closed");
  } else {
    fail("I7 port/dup", JSON.stringify({ bad: bad.stdout, ok443: ok443.stdout, dup: dup.stdout }));
  }
}

{
  const repo = path.join(personal, "empty-acct-repo");
  fs.mkdirSync(repo, { recursive: true });
  run("git", ["init"], { cwd: repo, env });
  fs.writeFileSync(path.join(repo, ".acct"), "");
  const r = acct(["status"], env, repo);
  if (
    /profile: \(unbound\)/.test(r.stdout) &&
    /reason: local/.test(r.stdout) &&
    !/profile: personal/.test(r.stdout)
  ) {
    ok("I3 empty .acct is local unbound (no parent fallthrough)");
  } else fail("I3 empty .acct", r.stdout);
}

{
  // Non-git directory: .acct must still win (nearest walk-up)
  const dir = path.join(personal, "not-a-repo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".acct"), "profile: work\n");
  let r = acct(["status"], env, dir);
  if (/profile: work/.test(r.stdout) && /reason: local/.test(r.stdout))
    ok("I3 .acct honored without git repo");
  else fail("I3 non-git .acct", r.stdout);

  fs.writeFileSync(path.join(dir, ".acct"), "");
  r = acct(["status"], env, dir);
  if (
    /profile: \(unbound\)/.test(r.stdout) &&
    /reason: local/.test(r.stdout) &&
    !/profile: personal/.test(r.stdout)
  ) {
    ok("I3 empty .acct unbound without git repo");
  } else fail("I3 empty non-git .acct", r.stdout);

  // Nested pkg/.acct inside a git repo
  const repo = path.join(personal, "nested-acct-repo");
  const pkg = path.join(repo, "pkg");
  fs.mkdirSync(pkg, { recursive: true });
  run("git", ["init"], { cwd: repo, env });
  fs.writeFileSync(path.join(repo, ".acct"), "profile: personal\n");
  fs.writeFileSync(path.join(pkg, ".acct"), "profile: work\n");
  r = acct(["status"], env, pkg);
  if (/profile: work/.test(r.stdout) && /reason: local/.test(r.stdout))
    ok("I3 nearest nested .acct wins over toplevel");
  else fail("I3 nested .acct", r.stdout);
}

{
  const r = acct(["exec", "gh", "auth", "token"], env, personal);
  if (r.status !== 0 && /Refusing to run/.test(r.stderr + r.stdout))
    ok("exec blocks gh auth token (I18)");
  else fail("I18 exec token", r.stderr + r.stdout);
}

{
  const cases = [
    ["env", "gh", "auth", "token"],
    ["bash", "-c", "gh auth token"],
    ["/usr/bin/gh", "auth", "token"],
    ["xargs", "-I{}", "gh", "auth", "token"],
    ["xargs", "gh", "auth", "token"],
    ["xargs", "gh"],
    ["xargs", "-n2", "gh"],
    ["env", "xargs", "-n2", "gh"],
    ["xargs", "-I{}", "sh", "-c", "unset GH_TOKEN; gh auth {} --user other"],
    ["bash", "-c", '"gh" "auth" "token"'],
    ["bash", "-c", "g=gh; $g auth token"],
    ["bash", "-c", "x=auth; gh $x switch"],
    ["bash", "-c", "unset GH_TOKEN GITHUB_TOKEN; x=auth; gh $x switch"],
    ["bash", "-c", "$(command -v gh) auth token"],
    ["bash", "-c", "echo auth token | xargs gh"],
    ["zsh", "-c", "g=gh; $g auth token"],
    // Round-2 live bypasses
    ["bash", "-c", "a=to; b=ken; gh auth $a$b"],
    ["bash", "-c", 'gh auth "$(echo token)"'],
    ["bash", "-c", "IFS=; gh$IFS auth$IFS token"],
    ["bash", "-c", String.raw`printf 'auth\ntoken\n' | xargs -n2 gh`],
    ["bash", "-c", "echo Z2ggYXV0aCB0b2tlbg== | base64 -d | sh"],
    ["bash", "-c", "base64 -d <<<'Z2ggYXV0aCB0b2tlbg==' | bash"],
  ];
  let allOk = true;
  for (const cmd of cases) {
    const r = acct(["exec", ...cmd], env, personal);
    if (!(r.status !== 0 && /Refusing to run/.test(r.stderr + r.stdout))) {
      allOk = false;
      fail(`I18 wrapper ${cmd.join(" ")}`, r.stderr + r.stdout);
    }
  }
  if (allOk) ok("I18 blocks env/bash/-c/absolute/xargs + shell obfuscation");
}

{
  const badIds = ["evil$(whoami)", "evil`id`", "../personal", "has space"];
  let allOk = true;
  for (const id of badIds) {
    const r = acct(
      [
        "profile",
        "add",
        "--id",
        id,
        "--user",
        "x",
        "--email",
        "x@y.z",
        "--name",
        "X",
        "--protocol",
        "https",
      ],
      env,
    );
    if (!(r.status !== 0 && /Invalid profile id/i.test(r.stderr + r.stdout))) {
      allOk = false;
      fail(`profile id reject ${JSON.stringify(id)}`, r.stderr + r.stdout);
    }
  }
  if (allOk) ok("profile id allowlist rejects metacharacters/paths");
}

fs.rmSync(base, { recursive: true, force: true });
console.log(`\npassed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
