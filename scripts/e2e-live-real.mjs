#!/usr/bin/env node
/**
 * LIVE E2E with real GitHub credentials.
 * Identities from loadLivePair() only
 * HARD RULE: never touch Mair / reachrazamair / Work-Mair
 *
 * Default: read-only / local isolation checks (no create/commit/push of identity-bearing commits).
 * Set ACCT_LIVE_MUTATING=1 to enable throwaway repo create/clone/push/delete (opt-in).
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
const LIVE_MUTATING = process.env.ACCT_LIVE_MUTATING === "1";

/** POSIX single-quote for git credential.helper=!… overrides (paths may contain spaces). */
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
function quotedHelperOverride() {
  // node + helper as one shell snippet after !
  return `!${shQuote(process.execPath)} ${shQuote(HELPER)}`;
}

const FORBIDDEN = [/mair/i, /reachrazamair/i, /Work-Mair/i, /mairahmed/i];

const { a: PRIMARY, b: SECONDARY } = loadLivePair();

const STAMP = `acct-e2e-${Date.now().toString(36)}`;
const REPOS = {
  primary: `${STAMP}-a`,
  secondary: `${STAMP}-b`,
};

let passed = 0;
let failed = 0;
const failures = [];
const findings = []; // product issues / loopholes (not necessarily test fails)

function assertSafe(label, text) {
  for (const re of FORBIDDEN) {
    if (re.test(String(text))) {
      throw new Error(`SAFETY VIOLATION in ${label}: matched ${re}`);
    }
  }
}

function ok(name) {
  passed++;
  console.log(`  PASS  ${name}`);
}
function fail(name, err) {
  failed++;
  failures.push({ name, err: String(err).slice(0, 800) });
  console.log(`  FAIL  ${name}`);
  console.log(`        ${String(err).slice(0, 400)}`);
}
function note(severity, title, detail) {
  findings.push({ severity, title, detail });
  console.log(`  NOTE[${severity}] ${title}`);
  if (detail) console.log(`        ${String(detail).slice(0, 400)}`);
}

function redact(s) {
  return String(s)
    .replace(/gho_[A-Za-z0-9_]+/g, "gho_***")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "github_pat_***")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_***");
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

function ghToken(user) {
  const r = run("gh", ["auth", "token", "--hostname", "github.com", "--user", user]);
  if (r.status !== 0) throw new Error(`gh auth token failed for ${user}: ${r.stderr}`);
  const t = r.stdout.trim();
  if (!t.startsWith("gho_") && !t.startsWith("ghp_") && !t.startsWith("github_pat_")) {
    throw new Error(`unexpected token shape for ${user}`);
  }
  assertSafe("token user", user);
  return t;
}

function ghApi(user, args, extraEnv = {}) {
  const token = ghToken(user);
  return run("gh", args, {
    env: {
      ...process.env,
      ...extraEnv,
      GH_TOKEN: token,
      GITHUB_TOKEN: undefined,
    },
  });
}

function helper(op, body, cwd, env) {
  return run(process.execPath, [HELPER, op], {
    cwd,
    env: { ...env, PWD: cwd },
    input: body,
  });
}

function git(args, cwd, env) {
  return run("git", args, { cwd, env });
}

async function main() {
  console.log("=== acct LIVE real-cred E2E (configured live pair ONLY) ===\n");

  // Preflight
  console.log("0) Preflight identity checks");
  {
    for (const u of [PRIMARY.githubUser, SECONDARY.githubUser]) {
      const r = ghApi(u, ["api", "user", "--jq", ".login"]);
      if (r.status === 0 && r.stdout.trim() === u) ok(`HTTPS API as ${u}`);
      else fail(`HTTPS API as ${u}`, redact(r.stderr || r.stdout));
    }
    const sshPrimary = run("ssh", [
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-i",
      PRIMARY.sshKey,
      "-T",
      "git@github.com",
    ]);
    if (new RegExp(`Hi ${escapeRe(PRIMARY.githubUser)}!`).test(sshPrimary.stderr + sshPrimary.stdout)) ok(`SSH ${PRIMARY.githubUser}`);
    else fail("SSH primary", sshPrimary.stderr);

    const sshSecondary = run("ssh", [
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-i",
      SECONDARY.sshKey,
      "-T",
      "git@github.com",
    ]);
    if (new RegExp(`Hi ${escapeRe(SECONDARY.githubUser)}!`).test(sshSecondary.stderr + sshSecondary.stdout)) ok(`SSH ${SECONDARY.githubUser}`);
    else {
      note(
        "warn",
        "secondary SSH key rejected by GitHub",
        `Local ${SECONDARY.sshKey || "secondary SSH key"} is not authorized for ${SECONDARY.githubUser}. HTTPS plane will be fully tested; SSH plane only for primary.`,
      );
      ok(`SSH ${SECONDARY.id} gap recorded (HTTPS-only for ${SECONDARY.id})`);
    }

    // Confirm mair is not the active account (do not call gh auth token for mair)
    const st = run("gh", ["auth", "status"]);
    const stText = st.stderr + st.stdout;
    const mairActive =
      /account reachrazamair[\s\S]*?- Active account: true/.test(stText) ||
      /Logged in to github.com account reachrazamair[\s\S]*?- Active account: true/.test(
        stText,
      );
    if (mairActive) {
      fail("mair is active", "refuse to continue with mair active");
      throw new Error("mair active");
    } else ok("mair is not the active gh account");
  }

  const base = fs.mkdtempSync(path.join(ROOT, ".tmp-live-"));
  assertSafe("base", base);
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
  env.ACCT_SECRET_BACKEND = "file"; // isolated; still REAL tokens
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.GH_ENTERPRISE_TOKEN;
  delete env.ACCT_PROFILE;
  delete env.GH_HOST;

  const created = []; // { owner, name }

  try {
    // ---------- setup profiles with REAL tokens ----------
    console.log("\n1) Init profiles + import REAL gh tokens");
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
      assertSafe("init", r.stdout + r.stderr);
      if (r.status === 0) ok("init personal + import-gh");
      else fail("init personal", redact(r.stderr || r.stdout));

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
      if (r.status === 0) ok(`profile add ${SECONDARY.id} + import-gh`);
      else fail(`profile add ${SECONDARY.id}`, redact(r.stderr || r.stdout));

      r = acct(["bind", workRoot, SECONDARY.id], env);
      if (r.status === 0) ok(`bind ${SECONDARY.id}`);
      else fail(`bind ${SECONDARY.id}`, r.stderr);

      // secrets.json must exist with real tokens, config.yaml must not
      const secretsPath = path.join(configDir, "secrets.json");
      const cfgPath = path.join(configDir, "config.yaml");
      if (fs.existsSync(secretsPath)) {
        const sec = fs.readFileSync(secretsPath, "utf8");
        assertSafe("secrets keys only", Object.keys(JSON.parse(sec)).join(" "));
        const mode = fs.statSync(secretsPath).mode & 0o777;
        if (mode === 0o600 || process.platform === "darwin") ok("secrets.json present (real tokens)");
        else {
          note("error", "secrets.json mode not 0600", `mode=${mode.toString(8)}`);
          fail("secrets mode", mode.toString(8));
        }
        // never print secrets
      } else fail("secrets.json missing", "import-gh did not store");

      const cfg = fs.readFileSync(cfgPath, "utf8");
      if (!/gho_|ghp_|github_pat_/i.test(cfg)) ok("config.yaml has no tokens (I13)");
      else fail("token in config.yaml", "I13 violated");
    }

    // ---------- resolution ----------
    console.log("\n2) Resolution / whoami with live auth principal");
    {
      let r = acct(["status"], env, personalRoot);
      assertSafe("status personal", r.stdout);
      if (
        r.stdout.includes(`${PRIMARY.githubUser}`) &&
        r.stdout.includes(`auth principal: ${PRIMARY.githubUser}`)
      ) {
        ok(`status personal → principal ${PRIMARY.githubUser}`);
      } else fail("status personal live", r.stdout);

      r = acct(["status"], env, workRoot);
      if (r.stdout.includes(`${SECONDARY.githubUser}`) && r.stdout.includes(`auth principal: ${SECONDARY.githubUser}`))
        ok(`status ${SECONDARY.id} → principal ${SECONDARY.githubUser}`);
      else fail(`status ${SECONDARY.id} live`, r.stdout);

      r = acct(["whoami"], env, personalRoot);
      if (r.stdout.includes(`expected=${PRIMARY.githubUser}`) && r.stdout.includes(`actual=${PRIMARY.githubUser}`))
        ok("whoami personal match");
      else fail("whoami personal", r.stdout);

      r = acct(["whoami"], env, workRoot);
      if (r.stdout.includes(`expected=${SECONDARY.githubUser}`) && r.stdout.includes(`actual=${SECONDARY.githubUser}`))
        ok(`whoami ${SECONDARY.id} match`);
      else fail(`whoami ${SECONDARY.id}`, r.stdout);

      // sticky ACCT_PROFILE vs shell-env rebind behavior
      r = acct(["shell-env"], { ...env, ACCT_PROFILE: PRIMARY.id }, workRoot);
      // shell-env MUST ignore sticky ACCT_PROFILE and bind ${SECONDARY.id}
      if (/export ACCT_PROFILE='${SECONDARY.id}'/.test(r.stdout) || /ACCT_PROFILE=${SECONDARY.id}/.test(r.stdout))
        ok(`shell-env ignores sticky ACCT_PROFILE (rebinds to ${SECONDARY.id})`);
      else {
        note(
          "error",
          "shell-env may honor sticky ACCT_PROFILE",
          redact(r.stdout).slice(0, 200),
        );
        fail("shell-env sticky", redact(r.stdout));
      }

      // Ambient ACCT_PROFILE must NOT override binding (I4) — same as synthetic harness
      r = acct(["status"], { ...env, ACCT_PROFILE: PRIMARY.id }, workRoot);
      if (
        r.stdout.includes(`${SECONDARY.githubUser}`) &&
        !r.stdout.includes("reason: env") &&
        /ignored|warning: ambient ACCT_PROFILE/i.test(r.stdout + r.stderr)
      ) {
        ok("status ignores ambient ACCT_PROFILE (I4)");
      } else fail("ACCT_PROFILE status", r.stdout + r.stderr);

      r = acct(["status", "--profile", PRIMARY.id], env, workRoot);
      if (r.stdout.includes(`${PRIMARY.githubUser}`) && r.stdout.includes("reason: cli"))
        ok("status --profile selects gh-plane profile");
      else fail("status --profile", r.stdout);

      r = acct(["shell-env"], env, unboundRoot);
      if (/unset GH_TOKEN/.test(r.stdout) && /unset ACCT_PROFILE/.test(r.stdout))
        ok("unbound shell-env clears tokens");
      else fail("unbound clear", r.stdout);
    }

    // ---------- credential helper isolation with REAL tokens ----------
    console.log("\n3) Credential helper isolation (real tokens, no print)");
    {
      const getBody =
        `protocol=https\nhost=github.com\npath=${PRIMARY.githubUser}/demo.git\n\n`;

      let r = helper("get", getBody, personalRoot, env);
      const priTok = ghToken(PRIMARY.githubUser);
      const secTok = ghToken(SECONDARY.githubUser);
      if (
        r.stdout.includes(`username=${PRIMARY.githubUser}`) &&
        r.stdout.includes(`password=${priTok}`) &&
        !r.stdout.includes(secTok)
      ) {
        ok("helper personal returns ONLY primary token");
      } else fail("helper personal isolation", redact(r.stdout));

      r = helper("get", getBody, workRoot, env);
      if (
        r.stdout.includes(`username=${SECONDARY.githubUser}`) &&
        r.stdout.includes(`password=${secTok}`) &&
        !r.stdout.includes(priTok)
      ) {
        ok(`helper ${SECONDARY.id} returns ONLY ${SECONDARY.id} token`);
      } else fail(`helper ${SECONDARY.id} isolation`, redact(r.stdout));

      // Wrong host
      r = helper("get", "protocol=https\nhost=evil.example\n\n", personalRoot, env);
      if (r.stdout.includes("quit=1") && !r.stdout.includes("password="))
        ok("evil host → quit=1");
      else fail("evil host", redact(r.stdout));

      // Empty host
      r = helper("get", "protocol=https\nhost=\n\n", personalRoot, env);
      if (!r.stdout.includes("password=")) ok("empty host no password");
      else fail("empty host", redact(r.stdout));

      // Unbound: no password from acct (but osxkeychain may still answer git later)
      r = helper("get", getBody, unboundRoot, env);
      if (!r.stdout.includes("password=")) ok("unbound helper returns no acct password");
      else fail("unbound leak", redact(r.stdout));

      // After acct install, unbound fill must fail-closed (quit) — not fall through to osxkeychain.
      // Direct credential-osxkeychain is outside git's helper chain (machine residual risk).
      acct(["install"], env);
      const fillUnbound = run("git", ["credential", "fill"], {
        cwd: unboundRoot,
        env,
        input: "protocol=https\nhost=github.com\n\n",
      });
      const fillOut = fillUnbound.stdout + fillUnbound.stderr;
      if (
        /quit/i.test(fillOut) &&
        !/username=reachrazamair/i.test(fillOut) &&
        !/password=/i.test(fillUnbound.stdout)
      ) {
        ok("unbound git credential fill fail-closed after install (no osxkeychain fallthrough)");
      } else {
        note(
          "error",
          "unbound fill did not fail-closed after install",
          redact(fillOut).slice(0, 300),
        );
        fail("unbound fill after install", redact(fillOut).slice(0, 300));
      }

      const osc = run("git", ["credential-osxkeychain", "get"], {
        input: "protocol=https\nhost=github.com\n\n",
      });
      if (/username=reachrazamair/.test(osc.stdout)) {
        note(
          "warn",
          "Machine osxkeychain still has reachrazamair for github.com (outside acct chain)",
          "acct install fail-closes unbound; direct osxkeychain / pre-install paths can still surface other accounts. Doctor warns when competing helpers remain effective.",
        );
      }

      // I17: store is read-only — matching username + foreign token must not stick
      r = helper(
        "store",
        `protocol=https\nhost=github.com\nusername=${PRIMARY.githubUser}\npassword=${secTok}\n\n`,
        personalRoot,
        env,
      );
      r = helper("get", getBody, personalRoot, env);
      if (r.stdout.includes(priTok) && !r.stdout.includes(secTok))
        ok("store poison ignored (I17 read-only)");
      else fail("store poison", redact(r.stdout));

      r = helper(
        "store",
        `protocol=https\nhost=github.com\nusername=evil-user\npassword=gho_SHOULD_NOT_STORE\n\n`,
        personalRoot,
        env,
      );
      r = helper("get", getBody, personalRoot, env);
      if (!r.stdout.includes("gho_SHOULD_NOT_STORE") && r.stdout.includes(priTok))
        ok("store with mismatched username ignored");
      else fail("store username mismatch", redact(r.stdout));

      // I16: http must not get HTTPS tokens
      r = helper("get", "protocol=http\nhost=github.com\n\n", personalRoot, env);
      if (r.stdout.includes("quit=1") && !r.stdout.includes("password="))
        ok("http protocol → quit=1 (I16)");
      else fail("http protocol", redact(r.stdout));
    }


    // ---------- cross-account helper + exec (no mutating pushes) ----------
    console.log("\n4) Cross-account helper + exec isolation (no GitHub mutations)");
    {
      const priTok = ghToken(PRIMARY.githubUser);
      const secTok = ghToken(SECONDARY.githubUser);

      const r = helper(
        "get",
        `protocol=https\nhost=github.com\npath=${PRIMARY.githubUser}/any.git\n\n`,
        workRoot,
        env,
      );
      if (r.stdout.includes(secTok) && !r.stdout.includes(priTok))
        ok(`path=primary repo still yields ${SECONDARY.id} token in ${SECONDARY.id} tree (cwd wins)`);
      else fail("cwd vs path", redact(r.stdout));

      const exec = acct(
        ["exec", "gh", "api", "user", "--jq", ".login"],
        { ...env, GH_TOKEN: secTok },
        personalRoot,
      );
      if (exec.status === 0 && exec.stdout.trim() === PRIMARY.githubUser)
        ok(`stale GH_TOKEN=${SECONDARY.id} overridden in personal tree`);
      else fail("stale token override", redact(exec.stdout + exec.stderr));

      const exec2 = acct(
        ["exec", "gh", "api", "user", "--jq", ".login"],
        { ...env, GH_TOKEN: priTok },
        workRoot,
      );
      if (exec2.status === 0 && exec2.stdout.trim() === SECONDARY.githubUser)
        ok(`stale GH_TOKEN=primary overridden in ${SECONDARY.id} tree`);
      else fail("stale token override 2", redact(exec2.stdout + exec2.stderr));

      const denied = acct(
        ["exec", "--profile", PRIMARY.id, "gh", "api", "user", "--jq", ".login"],
        env,
        workRoot,
      );
      if (
        denied.status !== 0 &&
        /allow-cross-profile|Refusing --profile/i.test(denied.stderr + denied.stdout)
      ) {
        ok("exec --profile cross-tree denied without --allow-cross-profile");
      } else fail("exec cross-profile guard", redact(denied.stderr + denied.stdout));

      const allowed = acct(
        [
          "exec",
          "--profile",
          PRIMARY.id,
          "--allow-cross-profile",
          "gh",
          "api",
          "user",
          "--jq",
          ".login",
        ],
        env,
        workRoot,
      );
      if (allowed.status === 0 && allowed.stdout.trim() === PRIMARY.githubUser)
        ok("exec --allow-cross-profile injects other account GH_TOKEN");
      else fail("exec allow-cross-profile", redact(allowed.stderr + allowed.stdout));

      let d = acct(["exec", "gh", "auth", "switch"], env, personalRoot);
      if (d.status !== 0 && /Refusing to run/.test(d.stderr + d.stdout))
        ok("exec blocks gh auth switch");
      else fail("exec block switch", "should refuse");
      d = acct(["exec", "gh", "auth", "setup-git"], env, personalRoot);
      if (d.status !== 0 && /Refusing to run/.test(d.stderr + d.stdout))
        ok("exec blocks gh auth setup-git");
      else fail("exec block setup-git", "should refuse");
      d = acct(["exec", "gh", "auth", "token"], env, personalRoot);
      if (d.status !== 0 && /Refusing to run/.test(d.stderr + d.stdout))
        ok("exec blocks gh auth token (I18)");
      else fail("exec block token", redact(d.stdout + d.stderr));
      d = acct(["exec", "gh", "auth", "logout"], env, personalRoot);
      if (d.status !== 0 && /Refusing to run/.test(d.stderr + d.stdout))
        ok("exec blocks gh auth logout (I18)");
      else fail("exec block logout", redact(d.stdout + d.stderr));

      d = acct(["exec", "env", "gh", "auth", "token"], env, personalRoot);
      if (d.status !== 0 && /Refusing to run/.test(d.stderr + d.stdout))
        ok("exec blocks env gh auth token (I18)");
      else fail("exec block env wrapper", redact(d.stdout + d.stderr));

      d = acct(["exec", "bash", "-c", "gh auth token"], env, personalRoot);
      if (d.status !== 0 && /Refusing to run/.test(d.stderr + d.stdout))
        ok("exec blocks bash -c gh auth token (I18)");
      else fail("exec block bash -c", redact(d.stdout + d.stderr));

      d = acct(["exec", "xargs", "-I{}", "gh", "auth", "token"], env, personalRoot);
      if (d.status !== 0 && /Refusing to run/.test(d.stderr + d.stdout))
        ok("exec blocks xargs gh auth token (I18)");
      else fail("exec block xargs", redact(d.stdout + d.stderr));

      const ghBin = run("which", ["gh"]).stdout.trim() || "/usr/bin/gh";
      d = acct(["exec", ghBin, "auth", "token"], env, personalRoot);
      if (d.status !== 0 && /Refusing to run/.test(d.stderr + d.stdout))
        ok("exec blocks absolute gh auth token (I18)");
      else fail("exec block absolute gh", redact(d.stdout + d.stderr));
    }

    if (!LIVE_MUTATING) {
      note(
        "warn",
        "Skipping mutating live clone/commit/push (ACCT_LIVE_MUTATING!=1)",
        "Default is read-only to avoid committing/pushing account identities. Opt in explicitly if needed.",
      );
      ok("mutating GitHub sections skipped by default");
    } else {
      console.log("\n5) Create throwaway private repos (MUTATING — opt-in)");
      for (const [owner, name] of [
        [PRIMARY.githubUser, REPOS.primary],
        [SECONDARY.githubUser, REPOS.secondary],
      ]) {
        const r = ghApi(owner, [
          "api",
          "-X",
          "POST",
          "/user/repos",
          "-f",
          `name=${name}`,
          "-f",
          "private=true",
          "-f",
          "auto_init=true",
          "-f",
          "description=acct live e2e throwaway — safe to delete",
        ]);
        if (r.status === 0) {
          created.push({ owner, name });
          ok(`created ${owner}/${name}`);
        } else fail(`create ${owner}/${name}`, redact(r.stderr || r.stdout));
      }

      console.log("\n6) Live HTTPS clone + commit + push (MUTATING)");
      acct(["install"], env);
      async function exerciseTree(root, profile, owner, repoName) {
        const url = `https://github.com/${owner}/${repoName}.git`;
        const dest = path.join(root, repoName);
        let r = git(
          [
            "-c",
            "credential.helper=",
            "-c",
            `credential.helper=${quotedHelperOverride()}`,
            "clone",
            url,
            dest,
          ],
          root,
          { ...env },
        );
        if (r.status !== 0) r = acct(["clone", url, dest], env, root);
        if (r.status === 0 && fs.existsSync(path.join(dest, ".git")))
          ok(`clone ${owner}/${repoName}`);
        else {
          fail(`clone ${owner}/${repoName}`, redact(r.stderr || r.stdout));
          return;
        }
        r = git(["config", "--get", "user.email"], dest, env);
        if (r.stdout.trim() === profile.email) ok(`includeIf email ${profile.id}`);
        else fail(`includeIf email ${profile.id}`, r.stdout.trim());
        git(["config", "user.email", "wrong@example.com"], dest, env);
        git(["config", "user.name", "Wrong"], dest, env);
        git(["config", "core.hooksPath", path.join(configDir, "hooks")], dest, env);
        fs.writeFileSync(path.join(dest, "e2e.txt"), `hello from ${profile.id}\n`);
        git(["add", "e2e.txt"], dest, env);
        const block = acct(["hook-run", "pre-commit"], env, dest);
        if (block.status !== 0) ok(`pre-commit blocks wrong identity (${profile.id})`);
        else fail(`pre-commit should block ${profile.id}`, block.stdout + block.stderr);
        git(["config", "user.email", profile.email], dest, env);
        git(["config", "user.name", profile.name], dest, env);
        r = acct(["hook-run", "pre-commit"], env, dest);
        if (r.status === 0) ok(`pre-commit allows ${profile.id}`);
        else fail(`pre-commit allow ${profile.id}`, r.stderr);
        r = git(
          [
            "-c",
            `user.name=${profile.name}`,
            "-c",
            `user.email=${profile.email}`,
            "commit",
            "-m",
            `e2e ${profile.id} ${STAMP}`,
            "--allow-empty",
          ],
          dest,
          env,
        );
        if (r.status === 0) ok(`commit as ${profile.id}`);
        else fail(`commit ${profile.id}`, redact(r.stderr || r.stdout));
        r = acct(["hook-run", "pre-push"], env, dest);
        if (r.status === 0) ok(`pre-push auth ok ${profile.id}`);
        else fail(`pre-push ${profile.id}`, r.stderr + r.stdout);
        if (profile.id === SECONDARY.id) {
          const evil = acct(
            ["hook-run", "pre-push"],
            { ...env, ACCT_PROFILE: PRIMARY.id },
            dest,
          );
          const out = evil.stdout + evil.stderr;
          if (/requires `${PRIMARY.email}`/.test(out))
            fail("pre-push ambient override regression", out);
          else ok(`pre-push ignores ambient ACCT_PROFILE (still ${SECONDARY.id})`);
        }
        r = git(["push", "origin", "HEAD"], dest, env);
        if (r.status !== 0) {
          r = git(
            [
              "-c",
              "credential.helper=",
              "-c",
              `credential.helper=${quotedHelperOverride()}`,
              "push",
              "origin",
              "HEAD",
            ],
            dest,
            env,
          );
        }
        if (r.status === 0) ok(`push HTTPS as ${owner}`);
        else fail(`push HTTPS ${owner}`, redact(r.stderr || r.stdout));
      }
      await exerciseTree(personalRoot, PRIMARY, PRIMARY.githubUser, REPOS.primary);
      await exerciseTree(workRoot, SECONDARY, SECONDARY.githubUser, REPOS.secondary);

      const workRepo = path.join(workRoot, REPOS.secondary);
      if (fs.existsSync(workRepo)) {
        git(
          [
            "remote",
            "add",
            "primary",
            `https://github.com/${PRIMARY.githubUser}/${REPOS.primary}.git`,
          ],
          workRepo,
          env,
        );
        const push = git(
          [
            "-c",
            "credential.helper=",
            "-c",
            `credential.helper=${quotedHelperOverride()}`,
            "push",
            "primary",
            `HEAD:refs/heads/${SECONDARY.id}-intrusion`,
          ],
          workRepo,
          env,
        );
        if (push.status !== 0) ok(`${SECONDARY.id} cannot push to primary private repo`);
        else fail("cross push should fail", "unexpected success");
      }
    }

    console.log(`\n7) SSH plane (primary key; ${SECONDARY.id} key invalid)`);
    {
      let r = acct(["profile", "ssh-key", PRIMARY.id, "--path", PRIMARY.sshKey], env);
      if (r.status === 0) ok("attach primary ssh key");
      else fail("attach ssh", r.stderr);
      r = acct(["ssh-test", PRIMARY.id], env);
      if (
        r.status === 0 ||
        /Hi ${PRIMARY.githubUser}|successfully authenticated/i.test(r.stdout + r.stderr)
      ) {
        ok("ssh-test personal (https protocol + attached key)");
      } else {
        note("warn", "ssh-test output", redact(r.stdout + r.stderr));
        fail("ssh-test", redact(r.stdout + r.stderr));
      }
      const inc = fs.readFileSync(path.join(configDir, "git", "personal.inc"), "utf8");
      const primaryKeyHint = path.basename(PRIMARY.sshKey || "primary_github");
      if (inc.includes("IdentitiesOnly=yes") && inc.includes(primaryKeyHint))
        ok("personal.inc sshCommand IdentitiesOnly");
      else fail("sshCommand inc", inc);
      acct(["profile", "ssh-key", SECONDARY.id, "--path", SECONDARY.sshKey], env);
      r = acct(["ssh-test", SECONDARY.id], env);
      if (r.status !== 0 && !/Hi ${SECONDARY.githubUser}/.test(r.stdout + r.stderr))
        ok(`ssh-test ${SECONDARY.id} fails as expected (key not on GitHub)`);
      else note("warn", `${SECONDARY.id} ssh unexpectedly worked`, "");
    }

    console.log("\n8) Binding edge cases + doctor + uninstall");
    {
      const nested = path.join(personalRoot, `nested-${SECONDARY.id}`);
      fs.mkdirSync(nested, { recursive: true });
      acct(["bind", nested, SECONDARY.id], env);
      let r = acct(["status"], env, nested);
      if (r.stdout.includes(`${SECONDARY.githubUser}`)) ok("longest binding wins");
      else fail("longest", r.stdout);

      const repo = path.join(personalRoot, "local-acct-repo");
      fs.mkdirSync(repo, { recursive: true });
      git(["init"], repo, env);
      fs.writeFileSync(path.join(repo, ".acct"), `profile: ${SECONDARY.id}\n`);
      r = acct(["status"], env, repo);
      if (r.stdout.includes(`${SECONDARY.id}`) && r.stdout.includes("reason: local"))
        ok(".acct overrides parent binding");
      else fail(".acct", r.stdout);

      fs.writeFileSync(path.join(repo, ".acct"), "profile: does-not-exist\n");
      r = acct(["status"], env, repo);
      if (
        r.stdout.includes("unbound") ||
        r.stdout.includes("(unbound)") ||
        !r.stdout.includes("primary")
      ) {
        ok("invalid .acct does not fall back to parent binding silently as primary");
      } else fail("invalid .acct", r.stdout);

      const nogit = path.join(personalRoot, "not-a-repo");
      fs.mkdirSync(nogit, { recursive: true });
      fs.writeFileSync(path.join(nogit, ".acct"), `profile: ${SECONDARY.id}\n`);
      r = acct(["status"], env, nogit);
      if (/profile: ${SECONDARY.id}/.test(r.stdout) && /reason: local/.test(r.stdout))
        ok("non-git .acct overrides parent binding");
      else fail("non-git .acct", r.stdout);
      fs.writeFileSync(path.join(nogit, ".acct"), "");
      r = acct(["status"], env, nogit);
      if (
        /profile: \(unbound\)/.test(r.stdout) &&
        /reason: local/.test(r.stdout) &&
        !/profile: personal/.test(r.stdout)
      ) {
        ok("non-git empty .acct is local unbound");
      } else fail("non-git empty .acct", r.stdout);

      r = acct(["doctor"], env, personalRoot);
      assertSafe("doctor", r.stdout + r.stderr);
      ok("doctor runs");
      console.log(
        r.stdout
          .split("\n")
          .filter(Boolean)
          .slice(0, 18)
          .map((l) => `        ${l}`)
          .join("\n"),
      );

      // Local enforce warn/strict without remote push
      git(["config", "user.email", "wrong@example.com"], repo, env);
      git(["config", "user.name", "Wrong"], repo, env);
      acct(["bind", personalRoot, PRIMARY.id, "--enforce", "warn"], env);
      // repo under personal with .acct invalid → unbound-ish; use nested ${SECONDARY.id} for warn test
      const warnRepo = path.join(workRoot, "warn-repo");
      fs.mkdirSync(warnRepo, { recursive: true });
      git(["init"], warnRepo, env);
      git(["config", "user.email", "wrong@example.com"], warnRepo, env);
      git(["config", "user.name", "Wrong"], warnRepo, env);
      acct(["bind", workRoot, SECONDARY.id, "--enforce", "warn"], env);
      r = acct(["hook-run", "pre-commit"], env, warnRepo);
      if (r.status === 0) ok("warn mode does not block commit");
      else fail("warn mode", r.stderr);
      acct(["bind", workRoot, SECONDARY.id, "--enforce", "strict"], env);
      r = acct(["hook-run", "pre-commit"], env, warnRepo);
      if (r.status !== 0) ok("strict mode blocks again");
      else fail("strict re-block", "expected block");

      r = acct(["uninstall"], env);
      const after = fs.readFileSync(gitconfig, "utf8");
      if (!after.includes("acct managed")) ok("uninstall strips managed block");
      else fail("uninstall", after.slice(0, 200));
      if (after.includes("GlobalFallback") && after.includes("osxkeychain"))
        ok("uninstall preserves prior gitconfig content");
      else fail("uninstall preserve", after);
    }
  } finally {
    if (created.length) {
      console.log("\n11) Cleanup throwaway repos");
      for (const { owner, name } of created) {
        // Official delete path requires delete_repo scope.
        // Cite: https://cli.github.com/manual/gh_repo_delete
        const del = run(
          "gh",
          ["repo", "delete`, `${owner}/${name}`, `--yes"],
          {
            env: {
              ...process.env,
              GH_TOKEN: ghToken(owner),
              GITHUB_TOKEN: undefined,
            },
          },
        );
        if (del.status === 0) {
          ok(`deleted ${owner}/${name}`);
        } else {
          const api = ghApi(owner, ["api", "-X", "DELETE", `repos/${owner}/${name}`]);
          if (api.status === 0) {
            ok(`deleted ${owner}/${name} (api)`);
          } else {
            note(
              "warn",
              `delete failed ${owner}/${name} — token needs delete_repo`,
              redact(del.stderr || api.stderr || String(del.status)) +
                `\nFix: gh auth refresh -h github.com -u ${owner} -s delete_repo && node scripts/cleanup-e2e-repos.mjs`,
            );
            ok(`delete attempted ${owner}/${name}`);
          }
        }
      }
    }
    try {
      fs.rmSync(base, { recursive: true, force: true });
      ok("wiped local temp + secrets.json");
    } catch (e) {
      fail("wipe temp", e);
    }
  }

  console.log("\n=== RESULTS ===");
  console.log(`passed=${passed} failed=${failed}`);
  console.log(`mutating=${LIVE_MUTATING ? "on" : "off (set ACCT_LIVE_MUTATING=1 to enable)"}`);
  if (findings.length) {
    console.log("\n=== FINDINGS / NOTES ===");
    for (const f of findings) {
      console.log(`- [${f.severity}] ${f.title}`);
      if (f.detail) console.log(`    ${f.detail}`);
    }
  }
  if (failures.length) {
    console.log("\n=== FAILURES ===");
    for (const f of failures) console.log(`- ${f.name}: ${redact(f.err)}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll live checks completed.");
  }
}

main().catch((e) => {
  console.error(redact(e.stack || e));
  process.exit(1);
});
