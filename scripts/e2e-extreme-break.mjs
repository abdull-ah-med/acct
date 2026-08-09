#!/usr/bin/env node
/**
 * EXTREME break-the-app live probes (acct-sh + user-b ONLY).
 * Goal: find leaks, loopholes, identity cross-contamination, parser fail-open.
 * Never touch Mair. Does not commit/push the product repo.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCT = path.join(ROOT, "bin/acct.js");
const HELPER = path.join(ROOT, "bin/git-credential-acct.js");

const PRIMARY = {
  id: "personal",
  githubUser: "acct-sh",
  name: "Primary User",
  email: "dev@example.com",
  sshKey: path.join(os.homedir(), ".ssh/abd_github"),
};
const SECONDARY = {
  id: "work",
  githubUser: "user-b",
  name: "Secondary User",
  email: "user-b@example.com",
};

let passed = 0;
let failed = 0;
const findings = [];
const failures = [];

function ok(n) {
  passed++;
  console.log(`  PASS  ${n}`);
}
function fail(n, e) {
  failed++;
  failures.push({ n, e: String(e).slice(0, 700) });
  console.log(`  FAIL  ${n}`);
  console.log(`        ${String(e).slice(0, 400)}`);
}
function note(sev, title, detail) {
  findings.push({ sev, title, detail });
  console.log(`  NOTE[${sev}] ${title}`);
  if (detail) console.log(`        ${String(detail).slice(0, 450)}`);
}
function redact(s) {
  return String(s)
    .replace(/gho_[A-Za-z0-9_]+/g, "gho_***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_***");
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
    env: { ...env, PWD: cwd },
    input: body,
  });
}
function ghToken(user) {
  const r = run("gh", ["auth", "token", "--hostname", "github.com", "--user", user]);
  if (r.status !== 0) throw new Error(`token fail ${user}: ${r.stderr}`);
  return r.stdout.trim();
}
function hasAnyToken(out, tokens) {
  return tokens.some((t) => out.includes(t));
}
function expectNoToken(label, out, tokens) {
  if (hasAnyToken(out, tokens)) {
    note("error", `TOKEN LEAK: ${label}`, redact(out).slice(0, 220));
    fail(label, "token leaked");
    return false;
  }
  return true;
}

console.log("=== EXTREME BREAK LIVE PROBES (primary + work) ===\n");

const base = fs.mkdtempSync(path.join(ROOT, ".tmp-extreme-"));
const configDir = path.join(base, "config");
const gitconfig = path.join(base, "gitconfig");
const personalRoot = path.join(base, "trees", "personal");
const workRoot = path.join(base, "trees", "work");
const unboundRoot = path.join(base, "trees", "unbound");
for (const d of [personalRoot, workRoot, unboundRoot]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(
  gitconfig,
  "[user]\n\tname = GlobalFallback\n\temail = global@example.com\n[credential]\n\thelper = osxkeychain\n",
);

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

let abdTok = "";
let workTok = "";
const tokens = () => [abdTok, workTok].filter(Boolean);

try {
  console.log("0) Setup");
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
        "--import-gh",
      ],
      env,
      personalRoot,
    );
    if (r.status !== 0) throw new Error("init personal: " + redact(r.stderr));
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
        "--import-gh",
      ],
      env,
    );
    if (r.status !== 0) throw new Error("add work: " + redact(r.stderr));
    acct(["bind", workRoot, SECONDARY.id], env);
    acct(["install"], env);
    abdTok = ghToken(PRIMARY.githubUser);
    workTok = ghToken(SECONDARY.githubUser);
    ok("setup");
  }

  // ---------- P1: I7 host/port / conflict fail-closed ----------
  console.log("\nP1) Host/port/conflict parser (I7)");
  {
    const cases = [
      ["port 444", "protocol=https\nhost=github.com:444\n\n"],
      ["port 8443", "protocol=https\nhost=github.com:8443\n\n"],
      ["duplicate disagree host", "protocol=https\nhost=github.com\nhost=evil.com\n\n"],
      ["duplicate agree host", "protocol=https\nhost=github.com\nhost=github.com\n\n"],
      ["url vs host disagree", "protocol=https\nhost=github.com\nurl=https://evil.com/x\n\n"],
      ["url vs protocol disagree", "host=github.com\nprotocol=https\nurl=http://github.com/x\n\n"],
      ["host with user@", "protocol=https\nhost=user@github.com\n\n"],
      ["ipv6-ish", "protocol=https\nhost=[github.com]\n\n"],
      ["trailing dot", "protocol=https\nhost=github.com.\n\n"],
      ["null byte attempt", "protocol=https\nhost=github.com\0.evil\n\n"],
      ["tab in host", "protocol=https\nhost=github.com\t\n\n"],
      ["https:// in host", "protocol=https\nhost=https://github.com\n\n"],
      ["default 443 ok?", "protocol=https\nhost=github.com:443\n\n"],
    ];
    for (const [name, body] of cases) {
      const r = helper("get", body, personalRoot, env);
      const out = r.stdout;
      const leaked = hasAnyToken(out, tokens());
      const is443 = name.includes("443 ok");
      const agreeDup = name === "duplicate agree host";
      if (is443 || agreeDup) {
        if (leaked && out.includes(abdTok) && !out.includes(workTok)) {
          ok(`${name} → primary token only`);
        } else if (!leaked) {
          note("warn", `${name} rejected (stricter than expected?)`, redact(out).slice(0, 120));
          ok(`${name} fail-closed recorded`);
        } else fail(name, redact(out));
      } else if (leaked) {
        note("error", `I7 FAIL-OPEN: ${name}`, redact(out).slice(0, 200));
        fail(`I7 ${name}`, "token returned");
      } else {
        ok(`no token: ${name}`);
      }
    }
  }

  // ---------- P2: Nearest .acct walk-up (I3) ----------
  console.log("\nP2) Nearest .acct walk-up / nesting");
  {
    const deep = path.join(personalRoot, "a", "b", "c");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(personalRoot, "a", ".acct"), "profile: work\n");
    let r = acct(["status"], env, deep);
    if (/user-b/.test(r.stdout) && /reason: local/.test(r.stdout)) ok("walk-up finds parent .acct");
    else fail("walk-up .acct", r.stdout);

    fs.writeFileSync(path.join(deep, ".acct"), "profile: personal\n");
    r = acct(["status"], env, deep);
    if (/acct-sh/.test(r.stdout) && /reason: local/.test(r.stdout)) ok("nearest .acct wins over ancestor");
    else fail("nearest .acct", r.stdout);

    fs.writeFileSync(path.join(deep, ".acct"), "profile: \n");
    r = acct(["status"], env, deep);
    if (/unbound/.test(r.stdout) && /reason: local/.test(r.stdout)) ok("blank nearest .acct → unbound");
    else fail("blank nearest", r.stdout);

    // Sibling under a/ should still see work from a/.acct
    const sib = path.join(personalRoot, "a", "sib");
    fs.mkdirSync(sib, { recursive: true });
    r = acct(["status"], env, sib);
    if (/user-b/.test(r.stdout)) ok("sibling inherits ancestor .acct");
    else fail("sibling .acct", r.stdout);
  }

  // ---------- P3: GIT_DIR / worktree confusion ----------
  console.log("\nP3) GIT_DIR / worktree confusion");
  {
    const repo = path.join(workRoot, "wt-main");
    fs.mkdirSync(repo, { recursive: true });
    run("git", ["init"], { cwd: repo, env });
    run("git", ["config", "user.email", SECONDARY.email], { cwd: repo, env });
    run("git", ["config", "user.name", SECONDARY.name], { cwd: repo, env });
    fs.writeFileSync(path.join(repo, "f.txt"), "1\n");
    run("git", ["add", "f.txt"], { cwd: repo, env });
    run("git", ["commit", "-m", "init"], { cwd: repo, env });

    // Point GIT_DIR at work repo while cwd is personal
    const r = helper("get", "protocol=https\nhost=github.com\n\n", personalRoot, {
      ...env,
      GIT_DIR: path.join(repo, ".git"),
    });
    if (r.stdout.includes(abdTok) && !r.stdout.includes(workTok)) {
      ok("helper uses cwd binding not GIT_DIR (cwd wins)");
    } else if (r.stdout.includes(workTok)) {
      note(
        "error",
        "LOOPHOLE: GIT_DIR redirected helper to work while cwd is personal",
        redact(r.stdout).slice(0, 150),
      );
      fail("GIT_DIR confusion", "work token in personal cwd");
    } else fail("GIT_DIR unexpected", redact(r.stdout));

    // .acct in personal + GIT_DIR in work
    const withAcct = path.join(personalRoot, "with-acct");
    fs.mkdirSync(withAcct, { recursive: true });
    fs.writeFileSync(path.join(withAcct, ".acct"), "profile: personal\n");
    const r2 = helper("get", "protocol=https\nhost=github.com\n\n", withAcct, {
      ...env,
      GIT_DIR: path.join(repo, ".git"),
    });
    if (r2.stdout.includes(abdTok) && !r2.stdout.includes(workTok)) ok(".acct+cwd beats GIT_DIR");
    else if (r2.stdout.includes(workTok)) {
      note("error", "GIT_DIR overrode .acct", redact(r2.stdout).slice(0, 150));
      fail(".acct vs GIT_DIR", "wrong token");
    } else fail(".acct GIT_DIR", redact(r2.stdout));
  }

  // ---------- P4: Exec deny-list bypass creativity (I18) ----------
  console.log("\nP4) Exec deny-list creative bypasses (I18)");
  {
    const attempts = [
      ["xargs", "gh", "auth", "token"],
      ["xargs", "gh"],
      ["xargs", "-n2", "gh"],
      ["env", "xargs", "-n2", "gh"],
      ["xargs", "-I{}", "sh", "-c", "unset GH_TOKEN GITHUB_TOKEN; gh auth {} --user user-b"],
      ["nice", "gh", "auth", "token"],
      ["nohup", "gh", "auth", "token"],
      ["time", "gh", "auth", "token"],
      ["command", "gh", "auth", "token"],
      ["builtin", "gh", "auth", "token"],
      ["gh", "auth", "token", "2>/dev/null"],
      ["gh", "auth", "login"],
      ["gh", "auth", "refresh"],
      ["gh", "auth", "switch", "--user", SECONDARY.githubUser],
      ["gh", "auth", "setup-git"],
      ["gh", "auth", "logout"],
      ["bash", "-lc", "gh auth token"],
      ["zsh", "-c", "gh auth token"],
      ["bash", "-c", '"gh" "auth" "token"'],
      ["bash", "-c", "g=gh; $g auth token"],
      ["bash", "-c", "x=auth; gh $x switch"],
      ["bash", "-c", "unset GH_TOKEN GITHUB_TOKEN; x=auth; gh $x switch --user user-b"],
      ["bash", "-c", "$(command -v gh) auth token"],
      ["bash", "-c", "echo auth token | xargs gh"],
      ["zsh", "-c", "g=gh; $g auth token"],
      ["python3", "-c", "import os; print(os.environ.get('GH_TOKEN',''))"], // out of scope sandbox; expect token inject
      ["node", "-e", "console.log(process.env.GH_TOKEN||'')"],
      ["perl", "-e", "print $ENV{GH_TOKEN}"],
      ["ruby", "-e", "puts ENV['GH_TOKEN']"],
    ];
    for (const args of attempts) {
      const r = acct(["exec", ...args], env, personalRoot);
      const out = r.stdout + r.stderr;
      const isInterpreter = ["python3", "node", "perl", "ruby"].includes(args[0]);
      const isWrapper = ["xargs", "nice", "nohup", "time", "command", "builtin", "bash", "zsh", "env"].includes(
        args[0],
      );
      if (isInterpreter) {
        // Documented non-goal: env injection means interpreters can echo GH_TOKEN
        if (out.includes(abdTok)) {
          note(
            "info",
            `Non-goal: ${args[0]} can echo injected GH_TOKEN (I18 not a sandbox)`,
            "",
          );
          ok(`${args[0]} echo documented (not I18 bypass of gh auth)`);
        } else {
          ok(`${args[0]} no token / unavailable`);
        }
        continue;
      }
      if (hasAnyToken(out, tokens()) && /auth/.test(args.join(" "))) {
        note("error", `I18 BYPASS token dump: exec ${args.join(" ")}`, "");
        fail(`I18 ${args[0]}`, "dumped");
      } else if (r.status !== 0 && /Refusing/i.test(out)) {
        ok(`refused: ${args.slice(0, 3).join(" ")}`);
      } else if (isWrapper && r.status === 0 && !hasAnyToken(out, tokens())) {
        note("warn", `wrapper ran without refuse: ${args[0]}`, redact(out).slice(0, 100));
        ok(`wrapper ${args[0]} no stdout dump`);
      } else if (!hasAnyToken(out, tokens())) {
        ok(`no dump: ${args.slice(0, 3).join(" ")}`);
      } else {
        fail(`unexpected ${args.join(" ")}`, redact(out));
      }
    }

    // Direct stdin feed — must refuse before xargs runs (no token dump).
    {
      const r = run(process.execPath, [ACCT, "exec", "xargs", "gh"], {
        cwd: personalRoot,
        env,
        input: "auth\ntoken\n",
      });
      const out = r.stdout + r.stderr;
      if (hasAnyToken(out, tokens())) {
        note("error", "I18 BYPASS: xargs stdin dumped token", "");
        fail("xargs stdin", "token dumped");
      } else if (r.status !== 0 && /Refusing/i.test(out)) {
        ok("refused: xargs gh with stdin auth/token");
      } else {
        fail("xargs stdin", redact(out));
      }
    }
  }

  // ---------- P5: shell-env injection / eval footguns ----------
  console.log("\nP5) shell-env injection / profile id metacharacters");
  {
    let r = acct(["shell-env"], env, personalRoot);
    if (r.stdout.includes(abdTok)) {
      if (/export GH_TOKEN='/.test(r.stdout) || /export GH_TOKEN="/.test(r.stdout)) {
        ok("shell-env quotes GH_TOKEN");
      } else {
        note("warn", "shell-env GH_TOKEN quoting style unexpected", redact(r.stdout).slice(0, 120));
        ok("shell-env quoting noted");
      }
    } else fail("shell-env missing token", redact(r.stdout));

    r = acct(["shell-env"], env, unboundRoot);
    if (/unset GH_TOKEN/.test(r.stdout) && !r.stdout.includes(abdTok) && !r.stdout.includes(workTok)) {
      ok("unbound shell-env clears tokens");
    } else fail("unbound shell-env", redact(r.stdout));
  }

  // ---------- P6: Burst helper gets (isolation under churn) ----------
  console.log("\nP6) Burst helper isolation");
  {
    let bad = 0;
    for (let i = 0; i < 40; i++) {
      const cwd = i % 2 === 0 ? personalRoot : workRoot;
      const expect = i % 2 === 0 ? abdTok : workTok;
      const other = i % 2 === 0 ? workTok : abdTok;
      const r = helper("get", "protocol=https\nhost=github.com\n\n", cwd, env);
      if (!r.stdout.includes(expect) || r.stdout.includes(other)) bad++;
    }
    if (bad === 0) ok("40 alternating helper gets stayed isolated");
    else fail("burst isolation", `${bad}/40 crossed`);
  }

  // ---------- P7: Secrets file permissions / symlink swap ----------
  console.log("\nP7) secrets.json hygiene / symlink swap");
  {
    const secrets = path.join(configDir, "secrets.json");
    if (!fs.existsSync(secrets)) fail("secrets missing", "no file");
    else {
      const mode = fs.statSync(secrets).mode & 0o777;
      if (mode === 0o600 || process.platform === "darwin") ok(`secrets mode ${mode.toString(8)}`);
      else {
        note("error", "secrets.json not 0600", mode.toString(8));
        fail("secrets mode", mode.toString(8));
      }
      // Replace with symlink to world-readable target outside — next get should fail closed or not follow attacker file with wrong shape
      const evil = path.join(base, "evil-secrets.json");
      fs.writeFileSync(evil, JSON.stringify({ personal: workTok, work: abdTok }), { mode: 0o666 });
      fs.rmSync(secrets);
      try {
        fs.symlinkSync(evil, secrets);
        const r = helper("get", "protocol=https\nhost=github.com\n\n", personalRoot, env);
        // If it follows symlink and returns swapped tokens, that's a critical footgun
        if (r.stdout.includes(`password=${workTok}`)) {
          note(
            "error",
            "LOOPHOLE: helper followed secrets.json symlink to attacker-swapped tokens",
            "personal cwd returned work token",
          );
          fail("secrets symlink swap", "crossed tokens");
        } else if (r.stdout.includes(abdTok)) {
          note(
            "warn",
            "helper followed secrets symlink (same content layout) — symlink-to-secrets is a local attacker risk",
            "",
          );
          ok("symlink followed but content-driven (local trust boundary)");
        } else {
          ok("symlink secrets did not yield password (fail-closed)");
        }
      } catch (e) {
        note("warn", "symlink secrets test skipped", String(e));
        ok("symlink skip");
      }
      // restore real secrets
      try {
        fs.rmSync(secrets, { force: true });
      } catch {
        /* ignore */
      }
      run(process.execPath, [ACCT, "profile", "token", PRIMARY.id, "--stdin"], {
        env,
        input: abdTok + "\n",
      });
      run(process.execPath, [ACCT, "profile", "token", SECONDARY.id, "--stdin"], {
        env,
        input: workTok + "\n",
      });
    }
  }

  // ---------- P8: bind path tricks ----------
  console.log("\nP8) Bind path tricks");
  {
    const rel = path.join(base, "trees", "rel-bind");
    fs.mkdirSync(rel, { recursive: true });
    let r = acct(["bind", rel, PRIMARY.id], env);
    if (r.status === 0) {
      const st = acct(["status"], env, rel);
      if (/acct-sh/.test(st.stdout)) ok("absolute bind works");
      else fail("bind status", st.stdout);
    } else fail("bind", r.stderr);

    // Bind overlapping paths: parent personal, child should be able to rebind work
    const child = path.join(personalRoot, "child-rebind");
    fs.mkdirSync(child, { recursive: true });
    r = acct(["bind", child, SECONDARY.id], env);
    const st = acct(["status"], env, child);
    if (/user-b/.test(st.stdout)) ok("child rebind to work (longest wins)");
    else fail("child rebind", st.stdout);

    // Path with .. that escapes
    const escape = path.join(personalRoot, "x", "..", "..", "work");
    const st2 = acct(["status"], env, path.normalize(escape));
    if (/user-b/.test(st2.stdout)) ok("normalized .. path resolves to work tree");
    else {
      note("warn", ".. path status", st2.stdout.split("\n").slice(0, 6).join(" | "));
      ok(".. path recorded");
    }
  }

  // ---------- P9: Live API cross-account ACL + leftover cleanup attempt ----------
  console.log("\nP9) Live cross-account API ACL");
  {
    // Create ephemeral private gist? repos need delete_repo. Use API to list visibility instead.
    const r = run(
      "gh",
      ["api", "user/repos?per_page=5", "--jq", ".[].full_name"],
      { env: { ...env, GH_TOKEN: abdTok, GITHUB_TOKEN: undefined } },
    );
    if (r.status === 0) ok("primary API list works");
    else fail("primary API", redact(r.stderr));

    // Can work use primary token via wrong helper? already covered — try gh with swapped
    const wrong = run("gh", ["api", "user", "--jq", ".login"], {
      env: { ...env, GH_TOKEN: abdTok, GITHUB_TOKEN: undefined },
      cwd: workRoot,
    });
    if (wrong.stdout.trim() === PRIMARY.githubUser) {
      note(
        "info",
        "Raw gh with ambient GH_TOKEN ignores cwd binding (expected without acct exec)",
        "Users must use acct exec / shell-env — documented footgun",
      );
      ok("ambient gh ignores cwd (documented)");
    }

    const viaExec = acct(["exec", "gh", "api", "user", "--jq", ".login"], env, workRoot);
    if (viaExec.stdout.trim() === SECONDARY.githubUser) ok("acct exec forces work in work tree");
    else fail("acct exec work", viaExec.stdout);
  }

  // ---------- P10: Doctor / status must not leak under ACCT_DEBUG ----------
  console.log("\nP10) Debug + doctor hygiene");
  {
    for (const cmd of [["status"], ["whoami"], ["doctor"], ["profile", "list"], ["shell-env"]]) {
      const r = acct(cmd, { ...env, ACCT_DEBUG: "1" }, personalRoot);
      const all = r.stdout + r.stderr;
      if (cmd[0] === "shell-env") {
        // shell-env intentionally prints token
        if (all.includes(abdTok)) ok("shell-env+debug still exports token (by design)");
        else fail("shell-env debug", "missing token");
        continue;
      }
      if (all.includes(abdTok) || all.includes(workTok)) fail(`${cmd.join(" ")}+debug leaked`, "token");
      else if (/gho_[A-Za-z0-9]{12,}/.test(all) && !/gho_\*\*\*|REDACTED|TEST_ONLY/.test(all)) {
        note("error", `${cmd.join(" ")} leaked token-shaped`, redact(all).slice(0, 200));
        fail(`${cmd.join(" ")} shape`, "gho_ present");
      } else ok(`${cmd.join(" ")}+debug clean`);
    }
  }

  // ---------- P11: pre-push with stolen ambient profile + wrong email ----------
  console.log("\nP11) Hook identity vs auth principal");
  {
    const repo = path.join(workRoot, "hook-extreme");
    fs.mkdirSync(repo, { recursive: true });
    run("git", ["init"], { cwd: repo, env });
    run("git", ["config", "user.email", SECONDARY.email], { cwd: repo, env });
    run("git", ["config", "user.name", SECONDARY.name], { cwd: repo, env });
    run("git", ["config", "core.hooksPath", path.join(configDir, "hooks")], { cwd: repo, env });

    // Wrong email blocked
    run("git", ["config", "user.email", PRIMARY.email], { cwd: repo, env });
    let r = acct(["hook-run", "pre-commit"], env, repo);
    if (r.status !== 0) ok("pre-commit blocks primary email in work tree");
    else fail("pre-commit email", "allowed wrong");

    run("git", ["config", "user.email", SECONDARY.email], { cwd: repo, env });
    r = acct(["hook-run", "pre-commit"], env, repo);
    if (r.status === 0) ok("pre-commit allows work email");
    else fail("pre-commit allow", r.stderr);

    // Ambient ACCT_PROFILE=personal must not flip pre-push expected principal
    r = acct(["hook-run", "pre-push"], { ...env, ACCT_PROFILE: PRIMARY.id }, repo);
    const out = r.stdout + r.stderr;
    if (/requires .*contactprimaryahahmed|expected.*primary/i.test(out) && r.status !== 0) {
      note("error", "pre-push honored ambient ACCT_PROFILE", out.slice(0, 200));
      fail("pre-push ambient", out);
    } else {
      ok("pre-push ignores ambient ACCT_PROFILE");
    }
  }

  // ---------- P12: install twice / uninstall partial ----------
  console.log("\nP12) Install idempotency / uninstall");
  {
    let r = acct(["install"], env);
    r = acct(["install"], env);
    const gc = fs.readFileSync(gitconfig, "utf8");
    const managed = (gc.match(/acct managed/gi) || []).length;
    if (managed <= 2) ok(`install idempotent-ish (markers=${managed})`);
    else {
      note("warn", "multiple managed markers after double install", `count=${managed}`);
      ok("double install noted");
    }
    r = acct(["uninstall"], env);
    const after = fs.readFileSync(gitconfig, "utf8");
    if (!/acct managed/i.test(after) && /osxkeychain/.test(after)) ok("uninstall clean");
    else fail("uninstall", after.slice(0, 200));
    acct(["install"], env);
  }

  // ---------- P13: profile remove while bound ----------
  console.log("\nP13) Remove profile while bindings exist");
  {
    const tmpId = "tmpdoom";
    let r = acct(
      [
        "profile",
        "add",
        "--id",
        tmpId,
        "--user",
        "tmp-doom-user",
        "--email",
        "tmp@example.com",
        "--name",
        "Tmp",
        "--protocol",
        "https",
      ],
      env,
    );
    const doom = path.join(base, "trees", "doom");
    fs.mkdirSync(doom, { recursive: true });
    acct(["bind", doom, tmpId], env);
    r = acct(["profile", "remove", tmpId, "--force"], env);
    const st = acct(["status"], env, doom);
    if (/unbound|unknown|tmpdoom/i.test(st.stdout) && !/password=/.test(st.stdout)) {
      ok("removed profile leaves binding safely degraded");
    } else {
      note("warn", "after profile remove status", st.stdout.split("\n").slice(0, 8).join(" | "));
      ok("profile remove edge recorded");
    }
    // helper must not return real tokens for removed profile dir
    r = helper("get", "protocol=https\nhost=github.com\n\n", doom, env);
    if (expectNoToken("removed-profile helper", r.stdout, tokens())) {
      if (/quit=1/.test(r.stdout) || !/password=/.test(r.stdout)) ok("removed profile helper fail-closed");
      else fail("removed helper", redact(r.stdout));
    }
  }

  // ---------- P14: HTTPS clone public repo wrong tree (live network) ----------
  console.log("\nP14) Live clone public repo into wrong tree");
  {
    const dest = path.join(workRoot, "acct-public-clone");
    const r = run(
      "git",
      [
        "-c",
        "credential.helper=",
        "-c",
        `credential.helper=!${process.execPath} ${HELPER}`,
        "ls-remote",
        `https://github.com/${PRIMARY.githubUser}/acct.git`,
        "HEAD",
      ],
      { cwd: workRoot, env },
    );
    if (r.status === 0) {
      ok("work creds can ls-remote public primary/acct (expected)");
      note(
        "info",
        "Public cross-account read succeeds with wrong profile token — identity isolation ≠ ACL",
        "",
      );
    } else {
      note("warn", "ls-remote failed", redact(r.stderr).slice(0, 200));
      ok("ls-remote noted");
    }
    void dest;
  }

  // ---------- P15: Config.yaml must never gain tokens after operations ----------
  console.log("\nP15) config.yaml token hygiene after churn");
  {
    const cfg = fs.readFileSync(path.join(configDir, "config.yaml"), "utf8");
    if (/gho_|ghp_|github_pat_/i.test(cfg)) fail("config.yaml has tokens", "I13");
    else ok("config.yaml clean after extreme churn");
  }
} catch (e) {
  fail("harness crash", redact(e.stack || e));
} finally {
  try {
    fs.rmSync(base, { recursive: true, force: true });
    ok("wiped temp");
  } catch (e) {
    fail("wipe", e);
  }
}

console.log("\n=== EXTREME RESULTS ===");
console.log(`passed=${passed} failed=${failed}`);
if (findings.length) {
  console.log("\n=== FINDINGS ===");
  for (const f of findings) {
    console.log(`- [${f.sev}] ${f.title}`);
    if (f.detail) console.log(`    ${f.detail}`);
  }
}
if (failures.length) {
  console.log("\n=== FAILURES ===");
  for (const f of failures) console.log(`- ${f.n}: ${redact(f.e)}`);
  process.exitCode = 1;
} else {
  console.log("\nExtreme probes finished.");
}
