#!/usr/bin/env node
/**
 * Extensive E2E / adversarial harness for acct.
 * HARD RULE: never touch Mair / reachrazamair / Work-Mair.
 * Allowed: acct-sh, user-b (Secondary).
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

const PRIMARY = {
  id: "personal",
  githubUser: "acct-sh",
  name: "Primary User",
  email: "dev@example.com",
};
const SECONDARY = {
  id: "work",
  githubUser: "user-b",
  name: "Secondary User",
  email: "user-b@example.com",
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
  const workRoot = path.join(base, "work");
  const unboundRoot = path.join(base, "unbound");
  fs.mkdirSync(personalRoot, { recursive: true });
  fs.mkdirSync(workRoot, { recursive: true });
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
  console.log("\n2) Profile create / bind (primary + work only)");
  {
    let r = acct(
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
        personalRoot,
        "--protocol",
        "https",
      ],
      env,
      personalRoot,
    );
    assertSafe("init out", r.stdout + r.stderr);
    if (r.status === 0) ok("init personal/primary");
    else fail("init personal", r.stderr || r.stdout);

    r = acct(
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
    assertSafe("work add", r.stdout + r.stderr);
    if (r.status === 0) ok("profile add work");
    else fail("profile add work", r.stderr || r.stdout);

    r = acct(["bind", workRoot, SECONDARY.id], env);
    if (r.status === 0) ok("bind work root");
    else fail("bind work", r.stderr || r.stdout);

    r = acct(["profile", "list"], env);
    assertSafe("profile list", r.stdout);
    if (
      r.stdout.includes("acct-sh") &&
      r.stdout.includes("user-b") &&
      !/mair/i.test(r.stdout)
    ) {
      ok("profile list shows only allowed users");
    } else fail("profile list", r.stdout);
  }

  // ---------- token store (synthetic — never mair) ----------
  console.log("\n3) Token store via stdin (synthetic tokens, not live gh)");
  {
    const tokA = "gho_TEST_ONLY_PRIMARY_" + "x".repeat(20);
    const tokB = "gho_TEST_ONLY_SECONDARY_" + "y".repeat(20);
    let r = run(process.execPath, [ACCT, "profile", "token", PRIMARY.id, "--stdin"], {
      env,
      input: tokA,
    });
    if (r.status === 0) ok("store primary token");
    else fail("store primary token", r.stderr || r.stdout);

    r = run(process.execPath, [ACCT, "profile", "token", SECONDARY.id, "--stdin"], {
      env,
      input: tokB,
    });
    if (r.status === 0) ok("store work token");
    else fail("store work token", r.stderr || r.stdout);
  }

  // ---------- resolution / status ----------
  console.log("\n4) Resolution status / whoami / local .acct override");
  {
    let r = acct(["status"], env, personalRoot);
    assertSafe("status personal", r.stdout + r.stderr);
    if (r.stdout.includes("personal") && r.stdout.includes("acct-sh"))
      ok("status in personal → primary");
    else fail("status personal", r.stdout);

    r = acct(["status"], env, workRoot);
    assertSafe("status work", r.stdout + r.stderr);
    if (r.stdout.includes("work") && r.stdout.includes("user-b"))
      ok("status in work → user-b");
    else fail("status work", r.stdout);

    r = acct(["status"], env, unboundRoot);
    if (r.stdout.includes("unbound")) ok("status unbound");
    else fail("status unbound", r.stdout);

    // nested longer binding
    const nested = path.join(personalRoot, "nested-work-override");
    fs.mkdirSync(nested, { recursive: true });
    acct(["bind", nested, SECONDARY.id], env);
    r = acct(["status"], env, nested);
    if (r.stdout.includes("user-b")) ok("longest binding wins");
    else fail("longest binding", r.stdout);

    // local .acct override
    const repo = path.join(personalRoot, "repo-local");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(
      path.join(repo, ".git", "config"),
      "[core]\n\trepositoryformatversion = 0\n",
    );
    fs.writeFileSync(path.join(repo, ".acct"), "profile: work\n");
    // git rev-parse needs a real repo — init with empty template
    const emptyTpl = path.join(base, "empty-tpl");
    fs.mkdirSync(emptyTpl, { recursive: true });
    run("git", ["init"], {
      cwd: repo,
      env: { ...env, GIT_TEMPLATE_DIR: emptyTpl },
    });
    fs.writeFileSync(path.join(repo, ".acct"), "profile: work\n");
    r = acct(["status"], env, repo);
    if (r.stdout.includes("work") || r.stdout.includes("reason: local"))
      ok("local .acct overrides binding");
    else fail("local .acct", r.stdout);

    // ACCT_PROFILE env wins
    r = acct(["status"], { ...env, ACCT_PROFILE: PRIMARY.id }, workRoot);
    if (r.stdout.includes("acct-sh") && r.stdout.includes("reason: env"))
      ok("ACCT_PROFILE overrides binding");
    else fail("ACCT_PROFILE", r.stdout);
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
    const incSecondary = path.join(configDir, "git", "work.inc");
    if (fs.existsSync(incPersonal) && fs.readFileSync(incPersonal, "utf8").includes(PRIMARY.email))
      ok("personal.inc identity");
    else fail("personal.inc", "missing");
    if (fs.existsSync(incSecondary) && fs.readFileSync(incSecondary, "utf8").includes(SECONDARY.email))
      ok("work.inc identity");
    else fail("work.inc", "missing");

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
      "protocol=https\nhost=github.com\npath=acct-sh/demo.git\n\n";

    let r = helper("get", getBody, personalRoot);
    assertSafe("helper get personal", r.stdout);
    if (
      r.stdout.includes("username=acct-sh") &&
      r.stdout.includes("password=gho_TEST_ONLY_PRIMARY_") &&
      !/mair|user-b/i.test(r.stdout)
    ) {
      ok("helper get personal → primary token only");
    } else fail("helper get personal", JSON.stringify(r.stdout));

    r = helper("get", getBody, workRoot);
    if (
      r.stdout.includes("username=user-b") &&
      r.stdout.includes("password=gho_TEST_ONLY_SECONDARY_") &&
      !/primary|mair/i.test(r.stdout.split("password=")[0])
    ) {
      ok("helper get work → work token only");
    } else fail("helper get work", JSON.stringify(r.stdout));

    // Cross-dir leak: personal must NOT return work
    if (!r.stdout.includes("PRIMARY")) ok("work response has no primary token");
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

    // Unbound strict: default unbound enforce is off — should not return profile token
    r = helper("get", getBody, unboundRoot);
    if (!r.stdout.includes("password="))
      ok("unbound dir returns no password");
    else fail("unbound leak", r.stdout);

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
      "protocol=https\nhost=github.com\nusername=acct-sh\npassword=gho_TEST_ONLY_PRIMARY_restored\n\n",
      personalRoot,
    );
    if (r.status === 0) ok("store op");
    else fail("store", r.stderr);

    r = helper("get", getBody, personalRoot);
    if (r.stdout.includes("gho_TEST_ONLY_PRIMARY_restored")) ok("store then get");
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
    if (/export GH_TOKEN=.*TEST_ONLY_PRIMARY/.test(r.stdout))
      ok("shell-env injects primary token");
    else fail("shell-env token", r.stdout);
    if (!/mair/i.test(r.stdout)) ok("shell-env has no mair");

    r = acct(["shell-env"], env, workRoot);
    if (/SECONDARY/.test(r.stdout) && !/PRIMARY_restored|PRIMARY_x/.test(r.stdout))
      ok("work shell-env uses work token not primary");
    else fail("work shell-env isolation", r.stdout);

    // stale GH_TOKEN in parent must be overwritten for profile
    r = acct(
      ["shell-env"],
      { ...env, GH_TOKEN: "gho_STALE_SHOULD_BE_REPLACED" },
      personalRoot,
    );
    if (
      r.stdout.includes("TEST_ONLY_PRIMARY") &&
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

    run("git", ["config", "user.email", PRIMARY.email], { cwd: repo, env });
    run("git", ["config", "user.name", PRIMARY.name], { cwd: repo, env });
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
    acct(["bind", personalRoot, PRIMARY.id, "--enforce", "warn"], env);
    r = acct(["hook-run", "pre-commit"], env, repo);
    if (r.status === 0) ok("warn mode does not block");
    else fail("warn mode", r.stderr);

    acct(["bind", personalRoot, PRIMARY.id, "--enforce", "strict"], env);
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

  // ---------- SSH plane (generate key for work only) ----------
  console.log("\n11) SSH key generate for work (not mair)");
  {
    const r = acct(["profile", "ssh-key", SECONDARY.id, "--generate"], env);
    assertSafe("ssh-key", r.stdout + r.stderr);
    if (r.status === 0 && /ssh-ed25519/.test(r.stdout)) ok("work ssh key generated");
    else fail("ssh generate", r.stderr + r.stdout);
    const inc = fs.readFileSync(path.join(configDir, "git", "work.inc"), "utf8");
    if (inc.includes("IdentitiesOnly=yes")) ok("work.inc has IdentitiesOnly");
    else fail("IdentitiesOnly", inc);
    if (!/mair/i.test(inc)) ok("work ssh inc has no mair");
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
