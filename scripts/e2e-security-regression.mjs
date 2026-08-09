/**
 * Security regression harness (synthetic tokens + real resolution/helper).
 * Asserts I4 ambient env cannot cross accounts; I6 unbound quit; I8b dual plane;
 * I11b absolute hooks; I18 exec deny-list. Uses syntheticPair() only — no real people.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticPair, escapeRe } from "./e2e-identities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCT = path.join(ROOT, "bin/acct.js");
const HELPER = path.join(ROOT, "bin/git-credential-acct.js");

const { a: PRIMARY, b: SECONDARY } = syntheticPair();

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

const TOK_A = "gho_TEST_ONLY_USER_A_" + "x".repeat(20);
const TOK_B = "gho_TEST_ONLY_USER_B_" + "y".repeat(20);

console.log("=== security regression ===\n");

acct(
  [
    "init",
    "--id",
    PRIMARY.id,
    "--user",
    PRIMARY.githubUser,
    "--email",
    PRIMARY.email,
    "--name",
    PRIMARY.name,
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
    SECONDARY.id,
    "--user",
    SECONDARY.githubUser,
    "--email",
    SECONDARY.email,
    "--name",
    SECONDARY.name,
    "--protocol",
    "https",
  ],
  env,
);
acct(["bind", work, SECONDARY.id], env);

run(process.execPath, [ACCT, "profile", "token", PRIMARY.id, "--stdin"], {
  env,
  input: TOK_A,
});
run(process.execPath, [ACCT, "profile", "token", SECONDARY.id, "--stdin"], {
  env,
  input: TOK_B,
});
acct(["install"], env);

{
  const r = helper(
    "get",
    "protocol=https\nhost=github.com\n\n",
    work,
    { ...env, ACCT_PROFILE: PRIMARY.id },
  );
  if (
    r.stdout.includes(`username=${SECONDARY.githubUser}`) &&
    r.stdout.includes("gho_TEST_ONLY_USER_B_") &&
    !r.stdout.includes("USER_A_")
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
      SECONDARY.id,
      "--path",
      SECONDARY.sshKey || path.join(process.env.HOME || "/tmp", ".ssh/secondary_github"),
    ],
    env,
  );
  const inc = fs.readFileSync(path.join(configDir, "git", `${SECONDARY.id}.inc`), "utf8");
  if (inc.includes('helper = ""') && inc.includes("IdentitiesOnly=yes"))
    ok("ssh-key keeps HTTPS helper (I8b)");
  else fail("I8b dual", inc);
}

{
  const r = acct(["hook-run", "pre-push"], { ...env, ACCT_PROFILE: PRIMARY.id }, work);
  const repo = path.join(work, "repo");
  fs.mkdirSync(repo, { recursive: true });
  run("git", ["init"], { cwd: repo, env });
  run("git", ["config", "user.email", SECONDARY.email], {
    cwd: repo,
    env,
  });
  run("git", ["config", "user.name", SECONDARY.name], { cwd: repo, env });
  const r2 = acct(
    ["hook-run", "pre-push"],
    { ...env, ACCT_PROFILE: PRIMARY.id },
    repo,
  );
  // With ambient personal ignored, check uses work — principal check may fail without live token.
  // Identity mismatch requiring PRIMARY email would mean ambient was honored (regression).
  const out = r2.stdout + r2.stderr;
  const primaryEmailRe = new RegExp(`requires "${escapeRe(PRIMARY.email)}"`);
  if (!primaryEmailRe.test(out))
    ok("pre-push ignores ambient ACCT_PROFILE identity expectation");
  else fail("pre-push ambient", out);
  void r;
}

{
  const r = helper(
    "store",
    `protocol=https\nhost=github.com\nusername=${PRIMARY.githubUser}\npassword=${TOK_B}\n\n`,
    personal,
    env,
  );
  const g = helper("get", "protocol=https\nhost=github.com\n\n", personal, env);
  if (g.stdout.includes(TOK_A) && !g.stdout.includes(TOK_B))
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
  fs.writeFileSync(path.join(dir, ".acct"), `profile: ${SECONDARY.id}\n`);
  let r = acct(["status"], env, dir);
  if (
    new RegExp(`profile: ${escapeRe(SECONDARY.id)}`).test(r.stdout) &&
    /reason: local/.test(r.stdout)
  )
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
  fs.writeFileSync(path.join(repo, ".acct"), `profile: ${PRIMARY.id}\n`);
  fs.writeFileSync(path.join(pkg, ".acct"), `profile: ${SECONDARY.id}\n`);
  r = acct(["status"], env, pkg);
  if (
    new RegExp(`profile: ${escapeRe(SECONDARY.id)}`).test(r.stdout) &&
    /reason: local/.test(r.stdout)
  )
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
    // Round-3 / re-added creative bypasses
    ["bash", "-c", "a=g;b=h; $a$b auth token"],
    ["bash", "-c", "x=g;y=h; $x$y auth token"],
    ["bash", "-c", "x=gh; y=' auth token'; $x$y"],
    ["awk", 'BEGIN{system("gh auth token")}'],
    ["osascript", "-e", 'do shell script "gh auth token"'],
    ["git", "-c", "alias.p=!gh auth token", "p"],
    // Priority-1 I18 deny-list bypasses (REMEDIATION_PLAN / security review)
    ["sh", "-c", "gh $1 $2", "_", "auth", "token"],
    ["bash", "-c", 'gh "$@"', "_", "auth", "token"],
    ["bash", "-c", "$1 $2 $3", "_", "gh", "auth", "token"],
    ["pwsh", "-c", "gh auth token"],
    ["cmd", "/c", "gh auth token"],
    ["bash", "-c", "$'\\x67h auth \\x74oken'"],
    ["bash", "-c", "x=gh; y=token; $x auth $y"],
    ["bash", "-c", 'printf "\\x67h auth token\\n" | sh'],
    ["bash", "-c", "{gh,auth,token}"],
    ["bash", "-c", "alias g=gh; g auth token"],
    ["bash", "-c", "unset GH_TOKEN GITHUB_TOKEN; alias g=gh; g auth token"],
    ["git", "-c", "core.pager=gh auth token", "log"],
    ["git", "-c", "include.path=/tmp/evil.inc", "status"],
    ["git", "-c", "core.sshCommand=gh auth token", "fetch"],
    ["find", ".", "-exec", "gh", "auth", "token", ";"],
    ["ash", "-c", "gh auth token"],
    ["busybox", "sh", "-c", "gh auth token"],
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

{
  // Case-fold collision: work exists → reject WORK (I19)
  const r = acct(
    [
      "profile",
      "add",
      "--id",
      "WORK",
      "--user",
      "user-work-case",
      "--email",
      "user-work-case@example.com",
      "--name",
      "User Work Case",
      "--protocol",
      "https",
    ],
    env,
  );
  if (
    r.status !== 0 &&
    /collides with existing "work"|case.?fold|already exists/i.test(r.stderr + r.stdout)
  )
    ok("I19 rejects --id WORK when work exists");
  else fail("I19 case-fold WORK", r.stderr + r.stdout);
}

fs.rmSync(base, { recursive: true, force: true });
console.log(`\npassed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
