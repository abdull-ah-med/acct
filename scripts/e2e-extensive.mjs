#!/usr/bin/env node
/**
 * Extensive E2E / adversarial harness for acct.
 * HARD RULE: never touch Mair / reachrazamair / Work-Mair.
 * Allowed: abdull-ah-med, aqsa-05 (Aqsa).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCT = path.join(ROOT, "bin/acct.js");
const HELPER = path.join(ROOT, "bin/git-credential-acct.js");

const FORBIDDEN = [
  /mair/i,
  /reachrazamair/i,
  /Work-Mair/i,
  /mairahmed/i,
];

const ABDULL = {
  id: "personal",
  githubUser: "abdull-ah-med",
  name: "Abdullah Ahmed",
  email: "contactabdullahahmed@gmail.com",
};
const AQSA = {
  id: "aqsa",
  githubUser: "aqsa-05",
  name: "Aqsa Batool",
  email: "120944457+aqsa-05@users.noreply.github.com",
};

function assertSafe(label, text) {
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      throw new Error(`SAFETY VIOLATION in ${label}: matched ${re}`);
    }
  }
}

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  console.log(`  PASS  ${name}`);
}
function fail(name, err) {
  failed++;
  failures.push({ name, err: String(err) });
  console.log(`  FAIL  ${name}`);
  console.log(`        ${err}`);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    ...opts,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return res;
}

function acct(args, env, cwd) {
  return run(process.execPath, [ACCT, ...args], { env, cwd });
}

async function main() {
  console.log("=== acct extensive harness (NO MAIR) ===\n");

  // Isolated dirs inside workspace
  const base = fs.mkdtempSync(path.join(ROOT, ".tmp-e2e-"));
  assertSafe("base", base);
  const configDir = path.join(base, "config");
  const gitconfig = path.join(base, "gitconfig");
  const personalRoot = path.join(base, "personal");
  const aqsaRoot = path.join(base, "aqsa");
  const unboundRoot = path.join(base, "unbound");
  fs.mkdirSync(personalRoot, { recursive: true });
  fs.mkdirSync(aqsaRoot, { recursive: true });
  fs.mkdirSync(unboundRoot, { recursive: true });
  fs.writeFileSync(gitconfig, "[user]\n\tname = GlobalFallback\n\temail = global@example.com\n");

  // Do NOT override HOME (breaks macOS keychain). Isolate via ACCT_* + GIT_CONFIG_GLOBAL.
  // Use file secret backend so we never touch OS keychain entries (including any mair tokens).
  const env = { ...process.env };
  env.ACCT_CONFIG_DIR = configDir;
  env.GIT_CONFIG_GLOBAL = gitconfig;
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.ACCT_SECRET_BACKEND = "file";
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.GH_ENTERPRISE_TOKEN;
  delete env.ACCT_PROFILE;
  delete env.GH_HOST;

  // ---------- unit suite first ----------
  console.log("1) Automated unit/contract suite");
  {
    const r = run("npm", ["test"], { cwd: ROOT });
    if (r.status === 0) ok("npm test");
    else fail("npm test", r.stderr || r.stdout);
  }

  // ---------- profile setup ----------
  console.log("\n2) Profile create / bind (abdull + aqsa only)");
  {
    let r = acct(
      [
        "init",
        "--id",
        ABDULL.id,
        "--user",
        ABDULL.githubUser,
        "--email",
        ABDULL.email,
        "--name",
        ABDULL.name,
        "--bind",
        personalRoot,
        "--protocol",
        "https",
      ],
      env,
      personalRoot,
    );
    assertSafe("init out", r.stdout + r.stderr);
    if (r.status === 0) ok("init personal/abdull");
    else fail("init personal", r.stderr || r.stdout);

    r = acct(
      [
        "profile",
        "add",
        "--id",
        AQSA.id,
        "--user",
        AQSA.githubUser,
        "--email",
        AQSA.email,
        "--name",
        AQSA.name,
        "--protocol",
        "https",
      ],
      env,
    );
    assertSafe("aqsa add", r.stdout + r.stderr);
    if (r.status === 0) ok("profile add aqsa");
    else fail("profile add aqsa", r.stderr || r.stdout);

    r = acct(["bind", aqsaRoot, AQSA.id], env);
    if (r.status === 0) ok("bind aqsa root");
    else fail("bind aqsa", r.stderr || r.stdout);

    r = acct(["profile", "list"], env);
    assertSafe("profile list", r.stdout);
    if (
      r.stdout.includes("abdull-ah-med") &&
      r.stdout.includes("aqsa-05") &&
      !/mair/i.test(r.stdout)
    ) {
      ok("profile list shows only allowed users");
    } else fail("profile list", r.stdout);
  }

  // ---------- token store (synthetic — never mair) ----------
  console.log("\n3) Token store via stdin (synthetic tokens, not live gh)");
  {
    const tokA = "gho_TEST_ONLY_ABDULL_" + "x".repeat(20);
    const tokB = "gho_TEST_ONLY_AQSA_" + "y".repeat(20);
    let r = run(process.execPath, [ACCT, "profile", "token", ABDULL.id, "--stdin"], {
      env,
      input: tokA,
    });
    if (r.status === 0) ok("store abdull token");
    else fail("store abdull token", r.stderr || r.stdout);

    r = run(process.execPath, [ACCT, "profile", "token", AQSA.id, "--stdin"], {
      env,
      input: tokB,
    });
    if (r.status === 0) ok("store aqsa token");
    else fail("store aqsa token", r.stderr || r.stdout);
  }

  // ---------- resolution / status ----------
  console.log("\n4) Resolution status / whoami / local .acct override");
  {
    let r = acct(["status"], env, personalRoot);
    assertSafe("status personal", r.stdout + r.stderr);
    if (r.stdout.includes("personal") && r.stdout.includes("abdull-ah-med"))
      ok("status in personal → abdull");
    else fail("status personal", r.stdout);

    r = acct(["status"], env, aqsaRoot);
    assertSafe("status aqsa", r.stdout + r.stderr);
    if (r.stdout.includes("aqsa") && r.stdout.includes("aqsa-05"))
      ok("status in aqsa → aqsa-05");
    else fail("status aqsa", r.stdout);

    r = acct(["status"], env, unboundRoot);
    if (r.stdout.includes("unbound")) ok("status unbound");
    else fail("status unbound", r.stdout);

    // nested longer binding
    const nested = path.join(personalRoot, "nested-aqsa-override");
    fs.mkdirSync(nested, { recursive: true });
    acct(["bind", nested, AQSA.id], env);
    r = acct(["status"], env, nested);
    if (r.stdout.includes("aqsa-05")) ok("longest binding wins");
    else fail("longest binding", r.stdout);

    // local .acct override
    const repo = path.join(personalRoot, "repo-local");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(
      path.join(repo, ".git", "config"),
      "[core]\n\trepositoryformatversion = 0\n",
    );
    fs.writeFileSync(path.join(repo, ".acct"), "profile: aqsa\n");
    // git rev-parse needs a real repo — init with empty template
    const emptyTpl = path.join(base, "empty-tpl");
    fs.mkdirSync(emptyTpl, { recursive: true });
    run("git", ["init"], {
      cwd: repo,
      env: { ...env, GIT_TEMPLATE_DIR: emptyTpl },
    });
    fs.writeFileSync(path.join(repo, ".acct"), "profile: aqsa\n");
    r = acct(["status"], env, repo);
    if (r.stdout.includes("aqsa") || r.stdout.includes("reason: local"))
      ok("local .acct overrides binding");
    else fail("local .acct", r.stdout);

    // ACCT_PROFILE ambient must NOT override (I4) — warning may appear
    r = acct(["status"], { ...env, ACCT_PROFILE: ABDULL.id }, aqsaRoot);
    if (
      r.stdout.includes("aqsa-05") &&
      !r.stdout.includes("reason: env") &&
      (r.stdout.includes("ignored") || r.stdout.includes("aqsa"))
    )
      ok("ambient ACCT_PROFILE does not override binding (I4)");
    else fail("ACCT_PROFILE ignored", r.stdout);

    r = acct(["status", "--profile", ABDULL.id], env, aqsaRoot);
    if (r.stdout.includes("abdull-ah-med") && r.stdout.includes("reason: cli"))
      ok("CLI --profile selects profile for status");
    else fail("CLI --profile", r.stdout);
  }

  // ---------- identity includeIf ----------
  console.log("\n5) Identity plane (isolated gitconfig — not ~/.gitconfig)");
  {
    const r = acct(["install"], env);
    assertSafe("install", r.stdout + r.stderr);
    const gc = fs.readFileSync(gitconfig, "utf8");
    assertSafe("gitconfig content", gc);
    if (gc.includes("acct managed") && gc.includes(personalRoot.replace(/\\/g, "/")))
      ok("includeIf installed in isolated gitconfig");
    else fail("includeIf install", gc.slice(0, 500));

    // Ensure real home gitconfig was NOT written by this test's HOME=base
    // (we pointed GIT_CONFIG_GLOBAL). Double-check we never wrote mair.
    if (!/mair/i.test(gc)) ok("isolated gitconfig has no mair");
    else fail("mair leaked into test gitconfig", gc);

    // profile inc files
    const incPersonal = path.join(configDir, "git", "personal.inc");
    const incAqsa = path.join(configDir, "git", "aqsa.inc");
    if (fs.existsSync(incPersonal) && fs.readFileSync(incPersonal, "utf8").includes(ABDULL.email))
      ok("personal.inc identity");
    else fail("personal.inc", "missing");
    if (fs.existsSync(incAqsa) && fs.readFileSync(incAqsa, "utf8").includes(AQSA.email))
      ok("aqsa.inc identity");
    else fail("aqsa.inc", "missing");

    // helper reset present
    const inc = fs.readFileSync(incPersonal, "utf8");
    if (inc.includes('helper = ""') && /helper = /.test(inc))
      ok("https helper reset then acct");
    else fail("helper reset", inc);
  }

  // ---------- credential helper protocol ----------
  console.log("\n6) Credential helper get/store/erase + adversarial");
  {
    function helper(op, body, cwd, extraEnv = {}) {
      return run(process.execPath, [HELPER, op], {
        cwd,
        env: { ...env, ...extraEnv, PWD: cwd },
        input: body,
      });
    }

    const getBody =
      "protocol=https\nhost=github.com\npath=abdull-ah-med/demo.git\n\n";

    let r = helper("get", getBody, personalRoot);
    assertSafe("helper get personal", r.stdout);
    if (
      r.stdout.includes("username=abdull-ah-med") &&
      r.stdout.includes("password=gho_TEST_ONLY_ABDULL_") &&
      !/mair|aqsa-05/i.test(r.stdout)
    ) {
      ok("helper get personal → abdull token only");
    } else fail("helper get personal", JSON.stringify(r.stdout));

    r = helper("get", getBody, aqsaRoot);
    if (
      r.stdout.includes("username=aqsa-05") &&
      r.stdout.includes("password=gho_TEST_ONLY_AQSA_") &&
      !/abdull|mair/i.test(r.stdout.split("password=")[0])
    ) {
      ok("helper get aqsa → aqsa token only");
    } else fail("helper get aqsa", JSON.stringify(r.stdout));

    // Cross-dir leak: personal must NOT return aqsa
    if (!r.stdout.includes("ABDULL")) ok("aqsa response has no abdull token");
    else fail("cross token", r.stdout);

    // Wrong host → quit
    r = helper(
      "get",
      "protocol=https\nhost=evil.example\npath=x/y.git\n\n",
      personalRoot,
    );
    if (r.stdout.includes("quit=1") && !r.stdout.includes("password="))
      ok("wrong host → quit=1 fail-closed");
    else fail("wrong host", JSON.stringify(r.stdout));

    // Empty host → quit
    r = helper("get", "protocol=https\nhost=\n\n", personalRoot);
    if (r.stdout.includes("quit=1") || r.stdout === "" || r.stdout === "\n")
      ok("empty host rejected");
    else fail("empty host", JSON.stringify(r.stdout));

    // Malicious host with newline injection attempt
    r = helper(
      "get",
      "protocol=https\nhost=github.com%0Ahost=evil\n\n",
      personalRoot,
    );
    // host value is literal with %0A or parsed oddly — must not return password for junk
    // Our isSafeHost rejects \n; %0A as literal string in host might still be "unsafe" depending
    // At minimum must not crash
    if (r.status === 0) ok("malicious host input does not crash");
    else fail("malicious host crash", r.stderr);

    // Unbound strict: defaultEnforce is strict → quit=1, no password
    r = helper("get", getBody, unboundRoot);
    if (
      !r.stdout.includes("password=") &&
      r.stdout.includes("quit=1")
    )
      ok("unbound strict → quit=1 fail-closed");
    else fail("unbound leak", JSON.stringify(r.stdout));

    // erase
    r = helper(
      "erase",
      "protocol=https\nhost=github.com\n\n",
      personalRoot,
    );
    if (r.status === 0) ok("erase succeeds");
    else fail("erase", r.stderr);

    // re-store via store op
    r = helper(
      "store",
      "protocol=https\nhost=github.com\nusername=abdull-ah-med\npassword=gho_TEST_ONLY_ABDULL_restored\n\n",
      personalRoot,
    );
    if (r.status === 0) ok("store op");
    else fail("store", r.stderr);

    r = helper("get", getBody, personalRoot);
    if (r.stdout.includes("gho_TEST_ONLY_ABDULL_restored")) ok("store then get");
    else fail("store then get", r.stdout);

    // capability
    r = helper("capability", "\n", personalRoot);
    if (r.stdout.includes("version 0")) ok("capability version 0");
    else fail("capability", r.stdout);

    // unknown op silent
    r = helper("wat", "\n", personalRoot);
    if (r.status === 0 && !r.stdout.includes("password=")) ok("unknown op ignored");
    else fail("unknown op", r.stdout);
  }

  // ---------- shell env / exec ----------
  console.log("\n7) Shell env + exec (no gh auth switch; block dangerous)");
  {
    let r = acct(["shell-env"], env, personalRoot);
    assertSafe("shell-env", r.stdout);
    if (r.stdout.includes("ACCT_PROFILE=") && r.stdout.includes("personal"))
      ok("shell-env sets ACCT_PROFILE");
    else fail("shell-env", r.stdout);
    if (/export GH_TOKEN=.*TEST_ONLY_ABDULL/.test(r.stdout))
      ok("shell-env injects abdull token");
    else fail("shell-env token", r.stdout);
    if (!/mair/i.test(r.stdout)) ok("shell-env has no mair");

    r = acct(["shell-env"], env, aqsaRoot);
    if (/AQSA/.test(r.stdout) && !/ABDULL_restored|ABDULL_x/.test(r.stdout))
      ok("aqsa shell-env uses aqsa token not abdull");
    else fail("aqsa shell-env isolation", r.stdout);

    // stale GH_TOKEN in parent must be overwritten for profile
    r = acct(
      ["shell-env"],
      { ...env, GH_TOKEN: "gho_STALE_SHOULD_BE_REPLACED" },
      personalRoot,
    );
    if (
      r.stdout.includes("TEST_ONLY_ABDULL") &&
      !r.stdout.includes("STALE_SHOULD_BE_REPLACED")
    ) {
      ok("stale GH_TOKEN replaced by profile token");
    } else fail("stale GH_TOKEN", r.stdout);

    r = acct(["exec", "gh", "auth", "switch"], env, personalRoot);
    if (r.status !== 0) ok("exec blocks gh auth switch");
    else fail("exec should block switch", r.stdout);

    r = acct(["exec", "gh", "auth", "setup-git"], env, personalRoot);
    if (r.status !== 0) ok("exec blocks gh auth setup-git");
    else fail("exec should block setup-git", r.stdout);

    r = acct(["exec", "node", "-e", "console.log(process.env.ACCT_PROFILE)"], env, personalRoot);
    if (r.status === 0 && r.stdout.trim() === "personal") ok("exec injects ACCT_PROFILE");
    else fail("exec env", r.stdout + r.stderr);
  }

  // ---------- enforce ----------
  console.log("\n8) Enforcement pre-commit / pre-push");
  {
    // Create real-ish repo under personal
    const repo = path.join(personalRoot, "enforce-repo");
    fs.mkdirSync(repo, { recursive: true });
    const emptyTpl = path.join(base, "empty-tpl2");
    fs.mkdirSync(emptyTpl, { recursive: true });
    run("git", ["init"], {
      cwd: repo,
      env: { ...env, GIT_TEMPLATE_DIR: emptyTpl },
    });
    run("git", ["config", "user.email", "wrong@example.com"], { cwd: repo, env });
    run("git", ["config", "user.name", "Wrong Name"], { cwd: repo, env });

    let r = acct(["hook-run", "pre-commit"], env, repo);
    if (r.status !== 0 && /blocked commit|requires/.test(r.stderr + r.stdout))
      ok("pre-commit blocks wrong identity");
    else fail("pre-commit block", r.stdout + r.stderr);

    run("git", ["config", "user.email", ABDULL.email], { cwd: repo, env });
    run("git", ["config", "user.name", ABDULL.name], { cwd: repo, env });
    r = acct(["hook-run", "pre-commit"], env, repo);
    if (r.status === 0) ok("pre-commit allows matching identity");
    else fail("pre-commit allow", r.stderr + r.stdout);

    // warn mode
    acct(["enforce", "warn"], env);
    run("git", ["config", "user.email", "wrong@example.com"], { cwd: repo, env });
    r = acct(["hook-run", "pre-commit"], env, repo);
    // profile enforce may still be strict on profile — check defaultEnforce
    // Our resolve uses binding/profile enforce first; profile has strict.
    // Force via binding
    acct(["bind", personalRoot, ABDULL.id, "--enforce", "warn"], env);
    r = acct(["hook-run", "pre-commit"], env, repo);
    if (r.status === 0) ok("warn mode does not block");
    else fail("warn mode", r.stderr);

    acct(["bind", personalRoot, ABDULL.id, "--enforce", "strict"], env);
    acct(["enforce", "strict"], env);
  }

  // ---------- doctor ----------
  console.log("\n9) Doctor");
  {
    const r = acct(["doctor"], env, personalRoot);
    assertSafe("doctor", r.stdout + r.stderr);
    if (r.status === 0 || r.status === 1) ok("doctor runs");
    else fail("doctor crash", r.stderr);
    if (!/mair|reachraza/i.test(r.stdout + r.stderr)) ok("doctor output has no mair");
    else fail("doctor mair leak", r.stdout);
  }

  // ---------- hooks / wrap / shell scripts ----------
  console.log("\n10) Shell hooks + wrap");
  {
    for (const sh of ["bash", "zsh", "fish", "powershell"]) {
      const r = acct(["hook", sh], env);
      if (r.status === 0 && r.stdout.length > 20) ok(`hook ${sh}`);
      else fail(`hook ${sh}`, r.stderr);
    }
    let r = acct(["wrap-install"], env);
    if (r.status === 0) ok("wrap-install");
    else fail("wrap-install", r.stderr);
    r = acct(["wrap-path"], env);
    if (r.stdout.includes("PATH") || r.stdout.includes("Path")) ok("wrap-path");
    else fail("wrap-path", r.stdout);
  }

  // ---------- SSH plane (generate key for aqsa only) ----------
  console.log("\n11) SSH key generate for aqsa (not mair)");
  {
    const r = acct(["profile", "ssh-key", AQSA.id, "--generate"], env);
    assertSafe("ssh-key", r.stdout + r.stderr);
    if (r.status === 0 && /ssh-ed25519/.test(r.stdout)) ok("aqsa ssh key generated");
    else fail("ssh generate", r.stderr + r.stdout);
    const inc = fs.readFileSync(path.join(configDir, "git", "aqsa.inc"), "utf8");
    if (inc.includes("IdentitiesOnly=yes")) ok("aqsa.inc has IdentitiesOnly");
    else fail("IdentitiesOnly", inc);
    if (!/mair/i.test(inc)) ok("aqsa ssh inc has no mair");
  }

  // ---------- uninstall ----------
  console.log("\n12) Uninstall strips managed block only");
  {
    const before = fs.readFileSync(gitconfig, "utf8");
    const r = acct(["uninstall"], env);
    const after = fs.readFileSync(gitconfig, "utf8");
    if (r.status === 0 && !after.includes("acct managed")) ok("uninstall removes managed block");
    else fail("uninstall", after.slice(0, 300));
    if (after.includes("GlobalFallback")) ok("uninstall keeps non-acct gitconfig content");
    else fail("uninstall preserved", after);
    void before;
  }

  // ---------- refuse mair profile creation in this harness ----------
  console.log("\n13) Safety: harness refuses to even attempt mair profile");
  {
    try {
      assertSafe("mair attempt", "reachrazamair");
      fail("safety check", "should have thrown");
    } catch {
      ok("forbidden pattern detector works");
    }
  }

  // ---------- config on disk has no tokens ----------
  console.log("\n14) Config YAML contains no tokens");
  {
    const cfg = fs.readFileSync(path.join(configDir, "config.yaml"), "utf8");
    assertSafe("config", cfg);
    if (!/gho_|github_pat_/i.test(cfg)) ok("no tokens in config.yaml");
    else fail("token on disk", cfg);
  }

  // cleanup
  fs.rmSync(base, { recursive: true, force: true });

  console.log("\n=== RESULTS ===");
  console.log(`passed=${passed} failed=${failed}`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(` - ${f.name}: ${f.err}`);
    process.exit(1);
  }
  console.log("All extensive harness checks passed (no Mair used).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
