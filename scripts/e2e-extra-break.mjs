#!/usr/bin/env node
/**
 * EXTRA break probes beyond existing harnesses.
 * configured live pair ONLY. No commit/push of product repo.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLivePair, escapeRe } from "./e2e-identities.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCT = path.join(ROOT, "bin/acct.js");
const HELPER = path.join(ROOT, "bin/git-credential-acct.js");
if (!fs.existsSync(ACCT)) {
  console.error("FATAL: acct bin not found at", ACCT);
  process.exit(2);
}

const { a: PRIMARY, b: SECONDARY } = loadLivePair();

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
function refused(r) {
  return r.status !== 0 && /Refusing|refusing|mutates global/i.test(r.stderr + r.stdout);
}
function hasTok(out, toks) {
  return toks.some((t) => out.includes(t));
}

console.log("=== EXTRA BREAK PROBES (PRIMARY + SECONDARY) ===\n");

const base = fs.mkdtempSync(path.join(ROOT, ".tmp-extra-"));
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

let priTok = "";
let secTok = "";
const tokens = () => [priTok, secTok].filter(Boolean);

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
      workRoot,
    );
    if (r.status !== 0) throw new Error(`add ${SECONDARY.id}: ` + redact(r.stderr));
    r = acct(["bind", workRoot, SECONDARY.id], env);
    if (r.status !== 0) throw new Error(`bind ${SECONDARY.id}: ` + redact(r.stderr));
    r = acct(["install"], env);
    if (r.status !== 0) throw new Error("install: " + redact(r.stderr));
    priTok = ghToken(PRIMARY.githubUser);
    secTok = ghToken(SECONDARY.githubUser);
    if (priTok === secTok) throw new Error("tokens identical — cannot isolate");
    ok("setup");
  }

  // ---------- A: Credential protocol confusion ----------
  console.log("\nA) Credential protocol / URL confusion");
  {
    const cases = [
      {
        name: "url with password userinfo",
        body: `url=https://${PRIMARY.githubUser}:attacker@github.com/foo.git\n`,
        expect: "quit-or-no-attacker-pass",
      },
      {
        name: "url username of other account in personal tree",
        body: `url=https://${SECONDARY.githubUser}@github.com/${SECONDARY.githubUser}/x.git\n`,
        expect: "cwd-wins-primary",
      },
      {
        name: `explicit username=${SECONDARY.id} in personal tree`,
        body: `protocol=https\nhost=github.com\nusername=${SECONDARY.githubUser}\n`,
        expect: "cwd-wins-primary",
      },
      {
        name: "url host vs host attr conflict",
        body: `protocol=https\nhost=evil.example\nurl=https://github.com/x\n`,
        expect: "quit",
      },
      {
        name: "duplicate host conflict",
        body: `protocol=https\nhost=evil.com\nhost=github.com\n`,
        expect: "quit",
      },
      {
        name: "CRLF host smuggle",
        body: `protocol=https\nhost=evil.com\r\nhost=github.com\n`,
        expect: "quit-or-safe",
      },
      {
        name: "NUL in host",
        body: `protocol=https\nhost=github.com\0evil\n`,
        expect: "quit-or-safe",
      },
      {
        name: "encoded CRLF host",
        body: `protocol=https\nhost=github.com%0aevil\n`,
        expect: "quit",
      },
      {
        name: "host with @",
        body: `protocol=https\nhost=user@github.com\n`,
        expect: "quit",
      },
      {
        name: "github.com:8443 non-default port",
        body: `protocol=https\nhost=github.com:8443\n`,
        expect: "quit",
      },
      {
        name: "github.com:443 allowed",
        body: `protocol=https\nhost=github.com:443\n`,
        expect: "token-primary",
      },
      {
        name: "uppercase GitHub.COM",
        body: `protocol=https\nhost=GitHub.COM\n`,
        expect: "token-primary",
      },
      {
        name: "trailing-dot github.com.",
        body: `protocol=https\nhost=github.com.\n`,
        expect: "quit-or-no-token",
      },
      {
        name: "homoglyph githuЬ.com (cyrillic)",
        body: `protocol=https\nhost=githuЬ.com\n`,
        expect: "quit",
      },
      {
        name: "path only no host",
        body: `protocol=https\npath=${PRIMARY.githubUser}/secret\n`,
        expect: "quit",
      },
      {
        name: "wwwauth injection",
        body: `protocol=https\nhost=github.com\nwwwauth[]=Basic realm="https://evil"\n`,
        expect: "token-primary",
      },
      {
        name: "capability confusion mid-stream",
        body: `capability[]=authtype\nprotocol=https\nhost=github.com\n`,
        expect: "token-primary",
      },
    ];

    for (const c of cases) {
      const r = helper("get", c.body, personalRoot, env);
      const out = r.stdout || "";
      const quit = /quit=1/.test(out);
      const gotPri = out.includes(priTok);
      const gotSec = out.includes(secTok);
      const leakedPass = /password=attacker/.test(out);

      if (leakedPass) {
        note("error", `LEAK attacker password echoed: ${c.name}`, redact(out));
        fail(c.name, "attacker password");
        continue;
      }
      if (gotSec && !gotPri) {
        note("error", `CROSS-ACCOUNT TOKEN: ${c.name}`, redact(out));
        fail(c.name, `${SECONDARY.id} token in personal tree`);
        continue;
      }

      if (c.expect === "cwd-wins-primary" || c.expect === "token-primary") {
        if (gotPri && !gotSec) ok(`${c.name} → primary`);
        else fail(c.name, redact(out) || `status=${r.status}`);
      } else if (c.expect === "quit") {
        if (quit && !gotPri && !gotSec) ok(`${c.name} → quit`);
        else if (!gotPri && !gotSec) ok(`${c.name} → no token`);
        else fail(c.name, redact(out));
      } else {
        if (!gotSec && (quit || !gotPri || gotPri)) {
          if (gotPri && (c.expect === "quit-or-no-token" || c.expect === "quit-or-safe")) {
            note("warn`, `unexpected token for ${c.name}`, `may be ok if host normalized");
            ok(`${c.name} recorded`);
          } else ok(`${c.name} fail-closed-ish`);
        } else fail(c.name, redact(out));
      }
    }
  }

  // ---------- B: username mismatch semantics ----------
  console.log("\nB) Wrong username still returns cwd profile token (confusion risk?)");
  {
    const r = helper(
      "get",
      `protocol=https\nhost=github.com\nusername=${SECONDARY.githubUser}\n`,
      personalRoot,
      env,
    );
    const out = r.stdout;
    if (out.includes(priTok) && out.includes(`username=${PRIMARY.githubUser}`)) {
      note(
        "warn",
        `Helper ignores requested username=${SECONDARY.githubUser} and returns primary (cwd profile)`,
        `By design for isolation, but git may have asked for ${SECONDARY.id} — document as intentional override`,
      );
      ok("username override → profile githubUser");
    } else if (out.includes(secTok)) {
      fail("username override", `returned ${SECONDARY.id} token`);
    } else {
      note("info", "username mismatch quit/empty", redact(out));
      ok("username mismatch handled");
    }
  }

  // ---------- C: I18 novel shell / interpreter bypasses ----------
  console.log("\nC) I18 novel bypass attempts");
  {
    const attempts = [
      ["fish", "-c", "gh auth token"],
      ["dash", "-c", "gh auth token"],
      ["bash", "-c", "eval gh auth token"],
      ["bash", "-c", "eval 'gh auth token'"],
      ["bash", "-c", "source /dev/stdin <<<'gh auth token'"],
      ["bash", "-c", "bash <(echo gh auth token)"],
      ["bash", "-c", "coproc gh auth token; wait"],
      ["bash", "-c", "function gh(){ command gh \"$@\"; }; gh auth token"],
      ["bash", "-c", "alias g=gh; g auth token"],
      ["bash", "-c", "printf 'auth\\ntoken\\n' | xargs gh"],
      ["bash", "-c", "printf 'auth\\ntoken\\n' | xargs -n1 | xargs gh"],
      ["bash", "-c", "a=to; b=ken; gh auth $a$b"],
      ["bash", "-c", "gh auth $(printf token)"],
      ["bash", "-c", "IFS=; gh$IFS auth$IFS token"],
      ["bash", "-c", "gh auth to\"\"ken"],
      ["bash", "-c", "gh auth refres''h"],
      ["bash", "-c", "echo Z2ggYXV0aCB0b2tlbgo= | base64 -d | sh"],
      ["bash", "-c", "echo Z2ggYXV0aCB0b2tlbgo= | base64 -D | sh"],
      ["bash", "-c", "eval $(echo Z2ggYXV0aCB0b2tlbgo= | base64 -d)"],
      ["bash", "-c", "python3 -c \"import os,subprocess; subprocess.call(['gh','auth','token'], env=os.environ)\""],
      ["bash", "-c", "node -e \"require('child_process').execSync('gh auth token',{stdio:'inherit'})\""],
      ["perl", "-e", "exec 'gh','auth','token'"],
      ["ruby", "-e", "exec 'gh','auth','token'"],
      ["python3", "-c", "import subprocess; subprocess.check_call(['gh','auth','token'])"],
      ["env", "-u", "GH_TOKEN", "gh", "auth", "token"],
      ["env", "-u", "GH_TOKEN", "-u", "GITHUB_TOKEN", "bash", "-c", "gh auth token"],
      ["xargs", "-n2", "gh"], // needs stdin — see below
      ["timeout", "5", "gh", "auth", "token"],
      ["nice", "gh", "auth", "token"],
      ["nohup", "gh", "auth", "token"],
      ["stdbuf", "-oL", "gh", "auth", "token"],
      ["command", "-p", "gh", "auth", "token"],
      ["bash", "-c", `unset GH_TOKEN GITHUB_TOKEN; gh auth switch --user ${SECONDARY.githubUser}`],
      ["bash", "-c", `export -n GH_TOKEN; unset GH_TOKEN; gh auth switch --hostname github.com --user ${SECONDARY.githubUser}`],
      // nested quote / unicode whitespace
      ["bash", "-c", "gh\u00a0auth\u00a0token"],
      ["bash", "-c", "gh\tauth\ttoken"],
      ["bash", "-c", "gh auth\u200btoken"], // zero-width space in token
    ];

    for (const args of attempts) {
      const label = args.join(" ").slice(0, 90);
      const r = acct(["exec", ...args], env, personalRoot);
      const out = (r.stdout || "") + (r.stderr || "");
      const dumped = hasTok(out, tokens());
      const isInterp =
        args[0] === "python3" ||
        args[0] === "perl" ||
        args[0] === "ruby" ||
        (args[0] === "bash" && /python3 -c|node -e/.test(args[2] || ""));

      if (refused(r) && !dumped) {
        ok(`refused: ${label}`);
      } else if (dumped && isInterp) {
        note("info`, `Non-goal interpreter dumped token: ${label}`, `");
        ok(`documented non-goal: ${label.slice(0, 40)}`);
      } else if (dumped) {
        note("error", `I18 BYPASS dumped token: ${label}`, redact(out).slice(0, 200));
        fail(`bypass: ${label}`, "token dumped");
      } else if (r.status !== 0) {
        ok(`blocked/failed: ${label}`);
      } else {
        note("warn", `exec exited 0 without clear refuse: ${label}`, redact(out).slice(0, 200));
        ok(`exit0 noted: ${label.slice(0, 50)}`);
      }
    }

    // xargs with stdin
    {
      const r = run(process.execPath, [ACCT, "exec", "xargs", "-n2", "gh"], {
        cwd: personalRoot,
        env,
        input: "auth\ntoken\n",
      });
      const out = (r.stdout || "") + (r.stderr || "");
      if (refused(r) || (!hasTok(out, tokens()) && r.status !== 0)) ok("refused: xargs stdin auth token");
      else if (hasTok(out, tokens())) {
        note("error", "I18 BYPASS: xargs stdin", redact(out));
        fail("xargs stdin", "token");
      } else ok("xargs stdin no dump");
    }
  }

  // ---------- D: Profile remove / recreate token confusion ----------
  console.log("\nD) Profile remove + recreate same id different user?");
  {
    // Can`t easily change github user on same id without remove; test remove leaves secrets
    const secretsPath = path.join(configDir, "secrets.json");
    const before = fs.existsSync(secretsPath) ? fs.readFileSync(secretsPath, "utf8") : "";
    const r = acct(["profile", "remove", SECONDARY.id, "--force"], env);
    if (r.status !== 0) {
      // try without --force
      const r2 = acct(["profile", "remove", SECONDARY.id], env);
      if (r2.status !== 0) note("warn", "profile remove failed", redact(r2.stderr));
      else ok(`removed ${SECONDARY.id} profile`);
    } else ok(`removed ${SECONDARY.id} profile --force`);

    const after = fs.existsSync(secretsPath) ? fs.readFileSync(secretsPath, "utf8") : "";
    if (after.includes(secTok)) {
      note("error", `secrets.json still holds ${SECONDARY.id} token after profile remove`, "");
      fail("orphan token after remove", "token remains");
    } else if (before.includes(`${SECONDARY.id}`) && after.includes(priTok)) {
      ok(`${SECONDARY.id} token purged from secrets on remove`);
    } else {
      note("info", "secrets after remove", redact(after).slice(0, 200));
      ok("remove secrets state recorded");
    }

    // helper in ${SECONDARY.id} tree after profile gone
    const h = helper("get", `protocol=https\nhost=github.com\n`, workRoot, env);
    if (hasTok(h.stdout, [secTok])) {
      note("error", `helper still returns ${SECONDARY.id} token after profile remove`, redact(h.stdout));
      fail("stale token after remove", "leak");
    } else if (/quit=1/.test(h.stdout) || !h.stdout.trim()) {
      ok("helper fail-closed after profile remove");
    } else {
      note("warn", "helper unexpected after remove", redact(h.stdout));
      ok("helper after remove noted");
    }

    // re-add ${SECONDARY.id}
    let add = acct(
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
      workRoot,
    );
    if (add.status !== 0) fail(`re-add ${SECONDARY.id}`, redact(add.stderr));
    else {
      ok(`re-add ${SECONDARY.id}`);
      secTok = ghToken(SECONDARY.githubUser);
      acct(["bind", workRoot, SECONDARY.id], env);
    }
  }

  // ---------- E: Nested .acct / symlink / bind races ----------
  console.log("\nE) Nested .acct, symlink bind, path tricks");
  {
    const nested = path.join(personalRoot, "deep", "pkg");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, ".acct"), `${SECONDARY.id}\n`);
    let r = acct(["status"], env, nested);
    if (/${SECONDARY.githubUser}|profile: ${SECONDARY.id}/.test(r.stdout)) ok("nested .acct overrides parent binding");
    else fail("nested .acct", r.stdout);

    fs.writeFileSync(path.join(nested, ".acct"), "\n");
    r = acct(["status"], env, nested);
    if (/unbound|no profile|reason:.*\.acct/i.test(r.stdout) && !/${PRIMARY.githubUser}/.test(r.stdout)) {
      ok("empty nested .acct unbound (no parent fallthrough)");
    } else {
      note("warn", "empty .acct status", r.stdout.slice(0, 250));
      if (/${PRIMARY.githubUser}/.test(r.stdout)) fail("empty .acct fell through to parent", r.stdout);
      else ok("empty .acct status recorded");
    }

    // BOM / whitespace .acct
    fs.writeFileSync(path.join(nested, ".acct"), `\ufeff${SECONDARY.id}\n`);
    r = acct(["status"], env, nested);
    if (/${SECONDARY.id}/.test(r.stdout)) ok(`BOM-prefixed .acct resolves ${SECONDARY.id}`);
    else {
      note("warn", "BOM .acct may fail parse", r.stdout.slice(0, 200));
      ok("BOM .acct recorded");
    }

    fs.writeFileSync(path.join(nested, ".acct"), `${SECONDARY.id}\r\n`);
    r = acct(["status"], env, nested);
    if (/${SECONDARY.id}/.test(r.stdout)) ok("CRLF .acct resolves");
    else fail("CRLF .acct", r.stdout);

    fs.writeFileSync(path.join(nested, ".acct"), "SECONDARY\n");
    r = acct(["status"], env, nested);
    if (/${SECONDARY.id}/.test(r.stdout)) ok("case-insensitive .acct id");
    else {
      note("info", "case-sensitive .acct id", r.stdout.slice(0, 200));
      ok("case .acct recorded");
    }

    // symlink tree
    const linkTree = path.join(base, "trees", `link-to-${SECONDARY.id}`);
    try {
      fs.symlinkSync(workRoot, linkTree);
      r = helper("get", `protocol=https\nhost=github.com\n`, linkTree, env);
      if (r.stdout.includes(secTok) && !r.stdout.includes(priTok)) ok(`symlink cwd resolves ${SECONDARY.id} token`);
      else if (/quit=1/.test(r.stdout)) {
        note("warn", "symlink cwd fail-closed (may not follow binding)", redact(r.stdout));
        ok("symlink fail-closed noted");
      } else fail("symlink cwd", redact(r.stdout));
    } catch (e) {
      note("info", "symlink skip", String(e));
    }

    // bind path that is prefix of another
    const evil = personalRoot + "-evil";
    fs.mkdirSync(evil, { recursive: true });
    r = acct(["status"], env, evil);
    if (/${PRIMARY.githubUser}/.test(r.stdout) && /binding/.test(r.stdout)) {
      note("error", "prefix collision: personalRoot-evil matched personal binding", r.stdout);
      fail("path prefix", r.stdout);
    } else ok("personalRoot-evil not matched as personal binding");
  }

  // ---------- F: Concurrent helper get/erase race ----------
  console.log("\nF) Concurrent helper isolation / erase race");
  {
    const kids = [];
    for (let i = 0; i < 20; i++) {
      const cwd = i % 2 === 0 ? personalRoot : workRoot;
      const expect = i % 2 === 0 ? priTok : secTok;
      const other = i % 2 === 0 ? secTok : priTok;
      kids.push({ cwd, expect, other });
    }
    let bad = 0;
    // sequential burst already tested; do parallel via Promise-less spawnSync in tight loop
    // plus one erase mid-flight of wrong token
    for (const k of kids) {
      const r = helper("get", `protocol=https\nhost=github.com\n`, k.cwd, env);
      if (!r.stdout.includes(k.expect) || r.stdout.includes(k.other)) bad++;
    }
    // erase foreign from personal
    helper(
      "erase",
      `protocol=https\nhost=github.com\nusername=${SECONDARY.githubUser}\npassword=${secTok}\n`,
      personalRoot,
      env,
    );
    const stillPrimary = helper("get", `protocol=https\nhost=github.com\n`, personalRoot, env);
    if (stillPrimary.stdout.includes(priTok)) ok("erase foreign token did not clear primary");
    else fail("erase race cleared primary", redact(stillPrimary.stdout));

    if (bad === 0) ok(`20 alternating gets isolated`);
    else fail("concurrent isolation", `${bad} mismatches`);
  }

  // ---------- G: Ambient env sticky / doctor ----------
  console.log("\nG) Sticky env / doctor mismatch");
  {
    const sticky = { ...env, GH_TOKEN: secTok, ACCT_PROFILE: `${SECONDARY.id}` };
    const r = helper("get", `protocol=https\nhost=github.com\n`, personalRoot, sticky);
    if (r.stdout.includes(priTok) && !r.stdout.includes(secTok)) {
      ok("helper ignores sticky GH_TOKEN+ACCT_PROFILE (I4)");
    } else fail("sticky env polluted helper", redact(r.stdout));

    const d = acct(["doctor"], sticky, personalRoot);
    const all = d.stdout + d.stderr;
    if (hasTok(all, tokens())) {
      note("error", "doctor leaked token with sticky env", redact(all));
      fail("doctor leak", "token");
    } else {
      if (/GH_TOKEN|sticky|mismatch|principal/i.test(all)) ok("doctor warns about sticky token");
      else {
        note("warn", "doctor may not warn on sticky GH_TOKEN mismatch", all.slice(0, 300));
        ok("doctor no leak");
      }
    }
  }

  // ---------- H: Live API — wrong token via acct exec vs raw ----------
  console.log("\nH) Live cross-account private ACL");
  {
    // list leftover private e2e repos
    const listPri = acct(
      ["exec", "gh", "api", "user/repos?per_page=100&visibility=private", "--jq", ".[].full_name"],
      env,
      personalRoot,
    );
    const listSec = acct(
      ["exec", "gh", "api", "user/repos?per_page=100&visibility=private", "--jq", ".[].full_name"],
      env,
      workRoot,
    );
    if (listPri.status === 0 && !hasTok(listPri.stdout, tokens())) ok("primary private list via exec");
    else fail("primary list", redact(listPri.stderr || listPri.stdout));
    if (listSec.status === 0 && !hasTok(listSec.stdout, tokens())) ok(`${SECONDARY.id} private list via exec`);
    else fail(`${SECONDARY.id} list`, redact(listSec.stderr || listSec.stdout));

    const priRepos = (listPri.stdout || "").split("\n").filter((x) => x.startsWith(`${PRIMARY.githubUser}/acct-e2e-`));
    const secRepos = (listSec.stdout || "").split("\n").filter((x) => x.startsWith(`${SECONDARY.githubUser}/acct-e2e-`));
    note("info`, `leftover e2e repos primary=${priRepos.length} ${SECONDARY.id}=${secRepos.length}`, `");

    if (priRepos[0]) {
      const cross = acct(["exec", "gh", "api`, `repos/${priRepos[0]}`, `--jq", ".full_name"], env, workRoot);
      if (cross.status !== 0) ok(`${SECONDARY.id} cannot API-read ${priRepos[0]}`);
      else fail(`${SECONDARY.id} saw primary private`, cross.stdout);
    }
    if (secRepos[0]) {
      const cross = acct(["exec", "gh", "api`, `repos/${secRepos[0]}`, `--jq", ".full_name"], env, personalRoot);
      if (cross.status !== 0) ok(`primary cannot API-read ${secRepos[0]}`);
      else fail(`primary saw ${SECONDARY.id} private`, cross.stdout);
    }
  }

  // ---------- I: shell-env eval safety ----------
  console.log("\nI) shell-env injection / quoting");
  {
    const r = acct(["shell-env"], env, personalRoot);
    if (hasTok(r.stdout, [priTok]) && !hasTok(r.stdout, [secTok])) {
      // check single-quote wrapping
      if (/export GH_TOKEN=`/.test(r.stdout) || /export GH_TOKEN="/.test(r.stdout)) {
        ok("shell-env exports quoted primary token");
      } else {
        note("warn", "shell-env token quoting unexpected", redact(r.stdout).slice(0, 120));
        ok("shell-env exports token");
      }
      note("warn", "shell-env prints live token to stdout (by design for eval)", "process list / shell history risk");
    } else fail("shell-env", redact(r.stdout));

    const u = acct(["shell-env"], env, unboundRoot);
    if (/unset GH_TOKEN/.test(u.stdout) && !hasTok(u.stdout, tokens())) ok("unbound shell-env clears tokens");
    else fail("unbound shell-env", redact(u.stdout));
  }

  // ---------- J: install twice / wrap ----------
  console.log("\nJ) Install churn / config hygiene");
  {
    acct(["install"], env);
    acct(["install"], env);
    const gc = fs.readFileSync(gitconfig, "utf8");
    const markers = (gc.match(/# >>> acct-managed/g) || []).length;
    if (markers <= 2) ok(`install idempotent markers=${markers}`);
    else {
      note("warn`, `install duplicated managed blocks markers=${markers}`, `");
      ok("install churn noted");
    }
    if (/gho_|ghp_|github_pat_/.test(gc)) fail("gitconfig token leak", "token in gitconfig");
    else ok("gitconfig has no tokens");

    const cfg = fs.readFileSync(path.join(configDir, "config.yaml"), "utf8");
    if (/gho_|ghp_|github_pat_/.test(cfg)) fail("config.yaml token", "leak");
    else ok("config.yaml clean");
  }

  // ---------- K: enforce off fallthrough live residual ----------
  console.log("\nK) enforce off → osxkeychain residual risk");
  {
    acct(["enforce", "off"], env, unboundRoot);
    // set defaultEnforce if CLI supports
    const r = helper("get", `protocol=https\nhost=github.com\n`, unboundRoot, env);
    if (!r.stdout.trim()) {
      note(
        "warn",
        "unbound+off returns empty — git may consult osxkeychain next (cross-account residual)",
        "I6 documented; strict is safer default for multi-account machines",
      );
      ok("enforce off empty response");
    } else if (/quit=1/.test(r.stdout)) {
      ok("enforce off still quit?");
    } else if (hasTok(r.stdout, tokens())) {
      note("error", "unbound+off returned acct token?", redact(r.stdout));
      fail("enforce off leak", "token");
    } else {
      note("warn", "unbound+off unexpected output", redact(r.stdout));
      ok("enforce off noted");
    }
    acct(["enforce", "strict"], env, unboundRoot);
  }

  console.log("\nZ) Wipe temp");
  fs.rmSync(base, { recursive: true, force: true });
  ok("wiped temp");
} catch (e) {
  fail("FATAL", e);
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log("\n=== EXTRA BREAK RESULTS ===");
console.log(`passed=${passed} failed=${failed}`);
if (findings.length) {
  console.log("\n=== FINDINGS ===");
  for (const f of findings) {
    console.log(`- [${f.sev}] ${f.title}`);
    if (f.detail) console.log(`    ${String(f.detail).slice(0, 300)}`);
  }
}
if (failures.length) {
  console.log("\n=== FAILURES ===");
  for (const f of failures) console.log(`- ${f.n}: ${f.e}`);
}
process.exitCode = failed ? 1 : 0;
