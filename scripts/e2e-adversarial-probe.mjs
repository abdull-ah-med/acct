#!/usr/bin/env node
/**
 * Adversarial live probes — try to break acct identity isolation.
 * Allowed: configured live pair ONLY. Never touch Mair.
 * Does not commit/push to the acct product repo.
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
  failures.push({ n, e: String(e).slice(0, 600) });
  console.log(`  FAIL  ${n}`);
  console.log(`        ${String(e).slice(0, 350)}`);
}
function note(sev, title, detail) {
  findings.push({ sev, title, detail });
  console.log(`  NOTE[${sev}] ${title}`);
  if (detail) console.log(`        ${String(detail).slice(0, 400)}`);
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
  if (r.status !== 0) throw new Error(`token fail ${user}`);
  return r.stdout.trim();
}

console.log("=== ADVERSARIAL LIVE PROBES (PRIMARY + SECONDARY) ===\n");

const base = fs.mkdtempSync(path.join(ROOT, ".tmp-adv-"));
const configDir = path.join(base, "config");
const gitconfig = path.join(base, "gitconfig");
const personalRoot = path.join(base, "trees", "personal");
const workRoot = path.join(base, "trees", "work");
const unboundRoot = path.join(base, "trees", "unbound");
const sibling = path.join(base, "trees", "sibling-not-bound");
for (const d of [personalRoot, workRoot, unboundRoot, sibling]) fs.mkdirSync(d, { recursive: true });
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

try {
  // Setup
  console.log("0) Setup live profiles");
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
  if (r.status !== 0) throw new Error("init personal failed: " + redact(r.stderr));
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
  if (r.status !== 0) throw new Error(`add ${SECONDARY.id} failed: ` + redact(r.stderr));
  acct(["bind", workRoot, SECONDARY.id], env);
  acct(["install"], env);
  const priTok = ghToken(PRIMARY.githubUser);
  const secTok = ghToken(SECONDARY.githubUser);
  ok("setup complete");

  // ---------- A: .acct outside git repo (no toplevel) ----------
  console.log("\nA) .acct without git repo under bound tree");
  {
    const dir = path.join(personalRoot, "not-a-repo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".acct"), `profile: ${SECONDARY.id}\n`);
    r = acct(["status"], env, dir);
    if (new RegExp(`profile: ${escapeRe(SECONDARY.id)}`).test(r.stdout) && /reason: local/.test(r.stdout)) {
      ok(".acct honored without git repo");
    } else if (/profile: personal/.test(r.stdout) && /reason: binding/.test(r.stdout)) {
      note(
        "error",
        "LOOPHOLE: .acct ignored when cwd is not a git repo",
        "resolveFromCwd only reads .acct via git toplevel — non-repo dirs under a bound tree inherit parent binding. Output: " +
          r.stdout.split("\n").slice(0, 8).join(" | "),
      );
      fail(".acct without git repo ignored (falls to parent)", r.stdout);
    } else {
      fail(".acct no-repo unexpected", r.stdout);
    }

    fs.writeFileSync(path.join(dir, ".acct"), "");
    r = acct(["status"], env, dir);
    if (/profile: \(unbound\)/.test(r.stdout) && /reason: local/.test(r.stdout)) {
      ok("empty .acct unbound without git repo");
    } else if (/profile: personal/.test(r.stdout)) {
      note(
        "error",
        "LOOPHOLE: empty .acct ignored outside git repo → parent binding leak",
        r.stdout.split("\n").slice(0, 6).join(" | "),
      );
      fail("empty .acct no-repo parent fallthrough", r.stdout);
    } else fail("empty .acct no-repo", r.stdout);
  }

  // ---------- B: symlink / path traversal binding tricks ----------
  console.log("\nB) Symlink / path tricks");
  {
    const realWork = path.join(base, "real-work-tree");
    fs.mkdirSync(realWork, { recursive: true });
    acct(["bind", realWork, SECONDARY.id], env);
    const link = path.join(personalRoot, "via-symlink");
    try {
      fs.symlinkSync(realWork, link);
      r = acct(["status"], env, link);
      // Depending on normalizePath: may resolve to work (good) or personal (bad)
      if (new RegExp(`${escapeRe(SECONDARY.githubUser)}`).test(r.stdout)) ok(`symlink into ${SECONDARY.id} tree resolves ${SECONDARY.id}`);
      else {
        note(
          "warn",
          "symlink cwd may resolve via personal prefix before realpath",
          r.stdout.split("\n").slice(0, 8).join(" | "),
        );
        fail("symlink resolution", r.stdout);
      }
    } catch (e) {
      note("warn", "symlink test skipped", String(e));
      ok("symlink skipped");
    }
  }

  // ---------- C: helper protocol / URL smuggling ----------
  console.log("\nC) Credential protocol smuggling");
  {
    const cases = [
      {
        name: "url= with userinfo",
        body: "url=https://evil:gho_FAKE@github.com/foo/bar\n\n",
      },
      {
        name: "url=http clears https",
        body: "protocol=https\nhost=github.com\nurl=http://github.com/x\n\n",
      },
      {
        name: "CRLF host injection",
        body: "protocol=https\nhost=github.com%0apassword=stolen\n\n",
      },
      {
        name: "host with path",
        body: "protocol=https\nhost=github.com/evil\n\n",
      },
      {
        name: "unicode lookalike host",
        body: "protocol=https\nhost=gіthub.com\n\n", // cyrillic і
      },
      {
        name: "github.com.evil.com",
        body: "protocol=https\nhost=github.com.evil.com\n\n",
      },
      {
        name: "whitespace host",
        body: "protocol=https\nhost= github.com\n\n",
      },
      {
        name: "uppercase host",
        body: "protocol=https\nhost=GitHub.COM\n\n",
      },
      {
        name: "protocol GIT",
        body: "protocol=GIT\nhost=github.com\n\n",
      },
      {
        name: "capability + get confusion",
        body: "protocol=https\nhost=github.com\ncapability[]=authtype\n\n",
      },
    ];
    for (const c of cases) {
      r = helper("get", c.body, personalRoot, env);
      const out = r.stdout;
      const leaked = out.includes(priTok) || out.includes(secTok);
      // url= alone (incl. userinfo) is a valid git-credential form of host=github.com
      // Cite: https://git-scm.com/docs/git-credential
      if (c.name === "url= with userinfo") {
        if (leaked && out.includes(priTok) && !out.includes(secTok)) {
          ok("url= userinfo → host github.com → primary token only (protocol OK)");
        } else if (!leaked) {
          ok("url= userinfo fail-closed");
        } else fail(`smuggle ${c.name}`, redact(out));
        continue;
      }
      if (leaked && !/host=github.com\n|host=GitHub.COM/i.test(c.body) && c.name !== "uppercase host") {
        note("error", `TOKEN LEAK via ${c.name}`, redact(out).slice(0, 200));
        fail(`smuggle ${c.name}`, redact(out));
      } else if (leaked && (c.name === "uppercase host" || /GitHub\.COM/.test(c.body))) {
        // Case folding — document if accepted
        if (out.includes(`password=${priTok}`)) {
          ok(`uppercase host accepted (case-insensitive) — token only primary`);
        } else fail(`uppercase host odd`, redact(out));
      } else if (leaked && c.name === "capability + get confusion") {
        if (out.includes(priTok) && !out.includes(secTok)) ok("capability attrs still return correct token");
        else fail("capability leak", redact(out));
      } else if (!leaked) {
        ok(`no leak: ${c.name}`);
      } else {
        fail(`unexpected leak ${c.name}`, redact(out));
      }
    }
  }

  // ---------- D: ACCT_DEBUG redaction with REAL tokens ----------
  console.log("\nD) ACCT_DEBUG must not print real tokens");
  {
    r = helper("get", "protocol=https\nhost=github.com\n\n", personalRoot, {
      ...env,
      ACCT_DEBUG: "1",
    });
    // Credential protocol stdout must include password= — that is not an I13 debug leak.
    // Cite: https://git-scm.com/docs/git-credential ; I13 applies to ACCT_DEBUG / logs.
    if (r.stderr.includes(priTok) || r.stderr.includes(secTok)) {
      note("error", "I13 VIOLATION: ACCT_DEBUG stderr leaked real token", redact(r.stderr).slice(0, 300));
      fail("ACCT_DEBUG redaction", "token present in stderr");
    } else if (
      /gho_[A-Za-z0-9]{8,}/.test(r.stderr) &&
      !/gho_\*\*\*|REDACTED|gho_TEST_ONLY/.test(r.stderr)
    ) {
      note("error", "ACCT_DEBUG stderr may leak token-shaped material", redact(r.stderr).slice(0, 300));
      fail("ACCT_DEBUG shape", redact(r.stderr));
    } else if (r.stdout.includes(priTok) && /REDACTED/.test(r.stderr)) {
      ok("ACCT_DEBUG stderr redacted; stdout password is credential protocol");
    } else if (!r.stderr.includes(priTok) && !r.stderr.includes(secTok)) {
      ok("ACCT_DEBUG does not emit real tokens on stderr");
    } else fail("ACCT_DEBUG unexpected", redact(r.stdout + r.stderr));
  }

  // ---------- E: shell-env / exec token exfil vectors ----------
  console.log("\nE) Token exfil / env leakage");
  {
    r = acct(["shell-env"], env, personalRoot);
    if (r.stdout.includes(priTok)) {
      note(
        "warn",
        "shell-env exports raw GH_TOKEN in stdout (by design for eval)",
        "Anyone who can read shell startup / process list of child may see it. Expected for hook model.",
      );
      ok("shell-env exports token (documented footgun noted)");
    } else fail("shell-env missing token", redact(r.stdout));

    // exec env dump should contain token — but acct shouldn't log it
    r = acct(["exec", "node", "-e", "process.stdout.write(process.env.GH_TOKEN||'')"], env, personalRoot);
    if (r.stdout === priTok) ok("exec injects correct token to child");
    else fail("exec inject", redact(r.stdout));

    r = acct(
      ["exec", "node", "-e", "process.stdout.write(process.env.GH_TOKEN||'')"],
      { ...env, GH_TOKEN: secTok },
      personalRoot,
    );
    if (r.stdout === priTok && r.stdout !== secTok) ok("exec overrides attacker GH_TOKEN");
    else fail("exec override fail", redact(r.stdout));

    // Can we trick exec deny-list?
    const bypasses = [
      ["exec", "gh", "auth", "token", "--hostname", "github.com"],
      ["exec", "gh", "auth", "token"],
      ["exec", "--", "gh", "auth", "token"],
      ["exec", "gh", "Auth", "token"], // case
      ["exec", "gh", "auth", "TOKEN"],
      ["exec", "/usr/bin/gh", "auth", "token"],
      ["exec", "env", "gh", "auth", "token"],
      ["exec", "bash", "-c", "gh auth token"],
      ["exec", "sh", "-c", `gh auth token --user ${PRIMARY.githubUser}`],
      ["exec", "bash", "-c", '"gh" "auth" "token"'],
      ["exec", "bash", "-c", "g=gh; $g auth token"],
      ["exec", "bash", "-c", `x=auth; gh $x switch --user ${SECONDARY.githubUser}`],
      ["exec", "bash", "-c", `unset GH_TOKEN GITHUB_TOKEN; x=auth; gh $x switch --user ${SECONDARY.githubUser}`],
      ["exec", "bash", "-c", "$(command -v gh) auth token"],
      ["exec", "bash", "-c", "echo auth token | xargs gh"],
      ["exec", "xargs", "gh"],
      ["exec", "xargs", "-n2", "gh"],
      ["exec", "xargs", "-I{}", "sh", "-c", "unset GH_TOKEN; gh auth {} --user other"],
      ["exec", "env", "xargs", "-n2", "gh"],
      ["exec", "zsh", "-c", "g=gh; $g auth token"],
    ];
    for (const args of bypasses) {
      r = acct(args, env, personalRoot);
      const out = r.stdout + r.stderr;
      const dumped = out.includes(priTok) || out.includes(secTok);
      const refused = /Refusing to run/.test(out);
      if (dumped) {
        note(
          "error",
          `I18 BYPASS: ${args.join(" ")} dumped token`,
          redact(out).slice(0, 120),
        );
        fail(`I18 bypass ${args.slice(1, 4).join(" ")}`, "token dumped");
      } else if (refused) {
        ok(`refused: ${args.slice(1, 4).join(" ")}`);
      } else if (r.status !== 0) {
        ok(`blocked/failed: ${args.slice(1, 4).join(" ")}`);
      } else {
        note("warn", `ran without refuse (no dump): ${args.slice(1, 4).join(" ")}`, redact(out).slice(0, 120));
        ok(`no dump: ${args.slice(1, 4).join(" ")}`);
      }
    }
  }

  // ---------- F: Hook bypass surfaces (I15 advisory) ----------
  console.log("\nF) Hook bypass surfaces (I15 advisory)");
  {
    const repo = path.join(workRoot, "bypass-repo");
    fs.mkdirSync(repo, { recursive: true });
    run("git", ["init"], { cwd: repo, env });
    run("git", ["config", "user.email", "wrong@example.com"], { cwd: repo, env });
    run("git", ["config", "user.name", "Wrong"], { cwd: repo, env });
    run("git", ["config", "core.hooksPath", path.join(configDir, "hooks")], { cwd: repo, env });
    fs.writeFileSync(path.join(repo, "x.txt"), "x\n");
    run("git", ["add", "x.txt"], { cwd: repo, env });
    const blocked = acct(["hook-run", "pre-commit"], env, repo);
    if (blocked.status !== 0) ok("hook-run blocks wrong identity");
    else fail("hook-run should block", blocked.stdout);

    const nv = run("git", ["commit", "--no-verify", "-m", "bypass"], { cwd: repo, env });
    if (nv.status === 0) {
      note(
        "warn",
        "I15 confirmed: git commit --no-verify bypasses identity enforcement",
        "Documented advisory; not a regression",
      );
      ok("--no-verify bypass works as documented");
    } else fail("--no-verify unexpected fail", nv.stderr);

    const alt = run(
      "git",
      ["-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "hooksPath bypass"],
      { cwd: repo, env },
    );
    if (alt.status === 0) {
      note("warn", "I15 confirmed: -c core.hooksPath bypasses hooks", "");
      ok("hooksPath bypass works as documented");
    } else {
      // /dev/null may not work on all platforms
      note("info", "hooksPath bypass attempt", redact(alt.stderr).slice(0, 120));
      ok("hooksPath attempt recorded");
    }
  }

  // ---------- G: Cross-account clone into wrong tree ----------
  console.log("\nG) Cross-account clone / credential confusion");
  {
    // Clone primary public repo into work tree — helper should still yield work token
    r = helper(
      "get",
      `protocol=https\nhost=github.com\npath=${PRIMARY.githubUser}/acct.git\n\n`,
      workRoot,
      env,
    );
    if (r.stdout.includes(secTok) && !r.stdout.includes(priTok)) {
      ok(`cloning primary path from ${SECONDARY.id} tree still uses ${SECONDARY.id} creds (cwd wins)`);
      note(
        "info",
        "By design: path= does not select profile — wrong-account clone of public repos works; private cross-account push should fail at GitHub ACL",
        "",
      );
    } else fail("path confusion", redact(r.stdout));
  }

  // ---------- H: Binding prefix attacks ----------
  console.log("\nH) Binding path prefix attacks");
  {
    // personalRoot + "X" should NOT match personal binding if prefix is path-component aware
    const decoy = personalRoot + "-evil";
    fs.mkdirSync(decoy, { recursive: true });
    r = acct(["status"], env, decoy);
    if (/unbound|profile: \(unbound\)/.test(r.stdout) || !new RegExp(`${escapeRe(PRIMARY.githubUser)}`).test(r.stdout)) {
      ok("path prefix does not match personalRoot-evil");
    } else {
      note("error", "PREFIX ATTACK: personalRoot-evil matched personal binding", r.stdout);
      fail("prefix attack", r.stdout);
    }

    // Case sensitivity on macOS
    const upper = personalRoot.toUpperCase();
    if (upper !== personalRoot && fs.existsSync(personalRoot)) {
      r = acct(["status"], env, upper);
      // On macOS default FS is case-insensitive — may still resolve
      note(
        "info",
        "case-variant cwd status",
        r.stdout.split("\n").slice(0, 6).join(" | "),
      );
      ok("case-variant probe recorded");
    } else ok("case probe N/A");
  }

  // ---------- I: Concurrent get + erase race (best-effort) ----------
  console.log("\nI) erase / get isolation");
  {
    // erase with other account token should not clear
    r = helper(
      "erase",
      `protocol=https\nhost=github.com\nusername=${PRIMARY.githubUser}\npassword=${secTok}\n\n`,
      personalRoot,
      env,
    );
    const g = helper("get", "protocol=https\nhost=github.com\n\n", personalRoot, env);
    if (g.stdout.includes(priTok)) ok("erase with foreign token did not clear primary");
    else fail("erase foreign cleared token", redact(g.stdout));
  }

  // ---------- J: doctor / status must not print tokens ----------
  console.log("\nJ) CLI output token hygiene");
  {
    for (const cmd of [["status"], ["whoami"], ["doctor"], ["profile", "list"]]) {
      r = acct(cmd, env, personalRoot);
      const all = r.stdout + r.stderr;
      if (all.includes(priTok) || all.includes(secTok)) {
        fail(`${cmd.join(" ")} leaked token`, "found");
      } else ok(`${cmd.join(" ")} no raw token`);
    }
  }

  // ---------- K: unbound after uninstall fallthrough to osxkeychain ----------
  console.log("\nK) Post-uninstall / competing helper residual");
  {
    acct(["uninstall"], env);
    const fill = run("git", ["credential", "fill"], {
      cwd: unboundRoot,
      env,
      input: "protocol=https\nhost=github.com\n\n",
    });
    const out = fill.stdout + fill.stderr;
    if (/password=/i.test(fill.stdout)) {
      note(
        "warn",
        "After uninstall, git credential fill may use osxkeychain (machine residual)",
        redact(out).slice(0, 200),
      );
      if (/username=reachrazamair/i.test(out)) {
        note(
          "error",
          "RESIDUAL: osxkeychain returns reachrazamair after uninstall",
          "Expected outside acct; dangerous if user thinks acct still protects",
        );
      }
      ok("post-uninstall fill residual noted");
    } else {
      ok("post-uninstall fill returned no password");
    }
    // Reinstall for remaining tests
    acct(["install"], env);
  }

  // ---------- L: profile token --stdin empty / garbage ----------
  console.log("\nL) Token store validation");
  {
    r = acct(["profile", "token", PRIMARY.id, "--stdin"], { ...env }, personalRoot);
    // empty stdin
    r = run(process.execPath, [ACCT, "profile", "token", PRIMARY.id, "--stdin"], {
      env,
      cwd: personalRoot,
      input: "",
    });
    if (r.status !== 0) ok("rejects empty token stdin");
    else {
      note("warn", "empty token stdin accepted?", "");
      fail("empty token", "accepted");
    }
    // restore real token
    run(process.execPath, [ACCT, "profile", "token", PRIMARY.id, "--stdin"], {
      env,
      input: priTok + "\n",
    });
  }

  // ---------- M: Live API: can work read primary private e2e repo if leftover? ----------
  console.log("\nM) Cross-account API ACL (live)");
  {
    for (const name of [`acct-e2e-msl0623l-a`, `acct-e2e-msl0623l-${SECONDARY.id}`]) {
      const owner = name.endsWith("-a") ? PRIMARY.githubUser : SECONDARY.githubUser;
      const ownerTok = name.endsWith("-a") ? priTok : secTok;
      const otherTok = name.endsWith("-a") ? secTok : priTok;
      const ownerSee = run("gh", ["api", `repos/${owner}/${name}`, "--jq", ".full_name"], {
        env: { ...env, GH_TOKEN: ownerTok, GITHUB_TOKEN: undefined },
      });
      const otherSee = run("gh", ["api", `repos/${owner}/${name}`, "--jq", ".full_name"], {
        env: { ...env, GH_TOKEN: otherTok, GITHUB_TOKEN: undefined },
      });
      if (ownerSee.status === 0) {
        note(
          "warn",
          `Leftover throwaway still exists: ${owner}/${name}`,
          "delete manually — token lacks delete_repo",
        );
      }
      if (otherSee.status !== 0) ok(`cross-account cannot see private ${owner}/${name}`);
      else fail(`cross-account saw private repo`, otherSee.stdout);
    }
  }

  // ---------- N: SSH agent pollution ----------
  console.log("\nN) SSH IdentitiesOnly vs agent pollution");
  {
    acct(["profile", "ssh-key", PRIMARY.id, "--path", PRIMARY.sshKey], env);
    const inc = fs.readFileSync(path.join(configDir, "git", "personal.inc"), "utf8");
    const primaryKeyHint = path.basename(PRIMARY.sshKey || "primary_github");
    if (/IdentitiesOnly=yes/.test(inc) && inc.includes(primaryKeyHint)) ok("sshCommand pins primary key");
    else fail("sshCommand", inc);
    // Without IdentitiesOnly, agent might offer wrong keys — we only verify config
    if (new RegExp(`IdentityFile=.*${escapeRe(SECONDARY.id)}`).test(inc)) fail(`personal.inc mentions ${SECONDARY.id} key`, inc);
    else ok(`personal.inc does not reference ${SECONDARY.id} key`);
  }

  // ---------- O: enforce off unbound helper fallthrough ----------
  console.log("\nO) enforce off / defaultEnforce edge");
  {
    // Write config defaultEnforce off
    const cfgPath = path.join(configDir, "config.yaml");
    let cfg = fs.readFileSync(cfgPath, "utf8");
    if (!/defaultEnforce:/.test(cfg)) cfg += "\ndefaultEnforce: off\n";
    else cfg = cfg.replace(/defaultEnforce:\s*\w+/, "defaultEnforce: off");
    fs.writeFileSync(cfgPath, cfg);
    r = helper("get", "protocol=https\nhost=github.com\n\n", unboundRoot, env);
    if (!r.stdout.includes("password=") && !/quit=1/.test(r.stdout)) {
      note(
        "warn",
        "unbound + defaultEnforce=off returns empty without quit — git may fall through to osxkeychain",
        redact(r.stdout).slice(0, 100),
      );
      ok("enforce off fallthrough behavior matches I6 docs");
    } else if (/quit=1/.test(r.stdout)) {
      note("info", "still quit with defaultEnforce off?", redact(r.stdout));
      ok("enforce off probe");
    } else fail("enforce off unexpected", redact(r.stdout));
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

console.log("\n=== ADVERSARIAL RESULTS ===");
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
  console.log("\nAdversarial probes finished.");
}
