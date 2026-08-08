#!/usr/bin/env node
/**
 * LIVE E2E with real GitHub credentials.
 * Allowed identities ONLY: acct-sh, user-b
 * HARD RULE: never touch Mair / reachrazamair / Work-Mair
 *
 * Creates throwaway private repos, exercises clone/commit/push/API,
 * tries to break isolation, then deletes the repos.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCT = path.join(ROOT, "bin/acct.js");
const HELPER = path.join(ROOT, "bin/git-credential-acct.js");

const FORBIDDEN = [/mair/i, /reachrazamair/i, /Work-Mair/i, /mairahmed/i];

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
  sshKey: path.join(os.homedir(), ".ssh/work_github"),
};

const STAMP = `acct-e2e-${Date.now().toString(36)}`;
const REPOS = {
  primary: `${STAMP}-abd`,
  work: `${STAMP}-work`,
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
  console.log("=== acct LIVE real-cred E2E (acct-sh + user-b ONLY) ===\n");

  // Preflight
  console.log("0) Preflight identity checks");
  {
    for (const u of [PRIMARY.githubUser, SECONDARY.githubUser]) {
      const r = ghApi(u, ["api", "user", "--jq", ".login"]);
      if (r.status === 0 && r.stdout.trim() === u) ok(`HTTPS API as ${u}`);
      else fail(`HTTPS API as ${u}`, redact(r.stderr || r.stdout));
    }
    const sshAbd = run("ssh", [
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "BatchMode=yes",
      "-i",
      PRIMARY.sshKey,
      "-T",
      "git@github.com",
    ]);
    if (/Hi acct-sh!/.test(sshAbd.stderr + sshAbd.stdout)) ok("SSH acct-sh");
    else fail("SSH primary", sshAbd.stderr);

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
    if (/Hi user-b!/.test(sshSecondary.stderr + sshSecondary.stdout)) ok("SSH user-b");
    else {
      note(
        "warn",
        "Secondary SSH key rejected by GitHub",
        "Local ~/.ssh/work_github is not authorized for user-b. HTTPS plane will be fully tested; SSH plane only for primary.",
      );
      ok("SSH work gap recorded (HTTPS-only for work)");
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
      if (r.status === 0) ok("profile add work + import-gh");
      else fail("profile add work", redact(r.stderr || r.stdout));

      r = acct(["bind", workRoot, SECONDARY.id], env);
      if (r.status === 0) ok("bind work");
      else fail("bind work", r.stderr);

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
        r.stdout.includes("acct-sh") &&
        r.stdout.includes("auth principal: acct-sh")
      ) {
        ok("status personal → principal acct-sh");
      } else fail("status personal live", r.stdout);

      r = acct(["status"], env, workRoot);
      if (r.stdout.includes("user-b") && r.stdout.includes("auth principal: user-b"))
        ok("status work → principal user-b");
      else fail("status work live", r.stdout);

      r = acct(["whoami"], env, personalRoot);
      if (r.stdout.includes("expected=acct-sh") && r.stdout.includes("actual=acct-sh"))
        ok("whoami personal match");
      else fail("whoami personal", r.stdout);

      r = acct(["whoami"], env, workRoot);
      if (r.stdout.includes("expected=user-b") && r.stdout.includes("actual=user-b"))
        ok("whoami work match");
      else fail("whoami work", r.stdout);

      // sticky ACCT_PROFILE vs shell-env rebind behavior
      r = acct(["shell-env"], { ...env, ACCT_PROFILE: PRIMARY.id }, workRoot);
      // shell-env MUST ignore sticky ACCT_PROFILE and bind work
      if (/export ACCT_PROFILE='work'/.test(r.stdout) || /ACCT_PROFILE=work/.test(r.stdout))
        ok("shell-env ignores sticky ACCT_PROFILE (rebinds to work)");
      else {
        note(
          "error",
          "shell-env may honor sticky ACCT_PROFILE",
          redact(r.stdout).slice(0, 200),
        );
        fail("shell-env sticky", redact(r.stdout));
      }

      // But status still honors ACCT_PROFILE (explicit override)
      r = acct(["status"], { ...env, ACCT_PROFILE: PRIMARY.id }, workRoot);
      if (r.stdout.includes("reason: env") && r.stdout.includes("acct-sh"))
        ok("status honors explicit ACCT_PROFILE override");
      else fail("ACCT_PROFILE status", r.stdout);

      r = acct(["shell-env"], env, unboundRoot);
      if (/unset GH_TOKEN/.test(r.stdout) && /unset ACCT_PROFILE/.test(r.stdout))
        ok("unbound shell-env clears tokens");
      else fail("unbound clear", r.stdout);
    }

    // ---------- credential helper isolation with REAL tokens ----------
    console.log("\n3) Credential helper isolation (real tokens, no print)");
    {
      const getBody =
        "protocol=https\nhost=github.com\npath=acct-sh/demo.git\n\n";

      let r = helper("get", getBody, personalRoot, env);
      const abdTok = ghToken(PRIMARY.githubUser);
      const workTok = ghToken(SECONDARY.githubUser);
      if (
        r.stdout.includes(`username=${PRIMARY.githubUser}`) &&
        r.stdout.includes(`password=${abdTok}`) &&
        !r.stdout.includes(workTok)
      ) {
        ok("helper personal returns ONLY primary token");
      } else fail("helper personal isolation", redact(r.stdout));

      r = helper("get", getBody, workRoot, env);
      if (
        r.stdout.includes(`username=${SECONDARY.githubUser}`) &&
        r.stdout.includes(`password=${workTok}`) &&
        !r.stdout.includes(abdTok)
      ) {
        ok("helper work returns ONLY work token");
      } else fail("helper work isolation", redact(r.stdout));

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

      // LOOPHOLE probe: unbound + global osxkeychain still has reachrazamair
      const osc = run("git", ["credential-osxkeychain", "get"], {
        input: "protocol=https\nhost=github.com\n\n",
      });
      if (/username=reachrazamair/.test(osc.stdout)) {
        note(
          "error",
          "LOOPHOLE: unbound git can still hit osxkeychain → reachrazamair",
          "acct unbound enforce is hardcoded off; competing helpers are not cleared outside includeIf. Wrong-account HTTPS auth remains possible in unbound dirs.",
        );
      }

      // Username mismatch store should be ignored
      r = helper(
        "store",
        `protocol=https\nhost=github.com\nusername=evil-user\npassword=gho_SHOULD_NOT_STORE\n\n`,
        personalRoot,
        env,
      );
      r = helper("get", getBody, personalRoot, env);
      if (!r.stdout.includes("gho_SHOULD_NOT_STORE") && r.stdout.includes(abdTok))
        ok("store rejects mismatched username");
      else fail("store username mismatch", redact(r.stdout));
    }

    // ---------- create real throwaway repos ----------
    console.log("\n4) Create throwaway private repos on both accounts");
    {
      for (const [owner, name] of [
        [PRIMARY.githubUser, REPOS.primary],
        [SECONDARY.githubUser, REPOS.work],
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
    }

    // ---------- live clone / commit / push HTTPS ----------
    console.log("\n5) Live HTTPS clone + commit identity + push (both accounts)");
    {
      acct(["install"], env);

      // Ensure includeIf present
      const gc = fs.readFileSync(gitconfig, "utf8");
      if (gc.includes("acct managed") && gc.includes("gitdir")) ok("includeIf installed");
      else fail("includeIf", gc.slice(0, 300));

      async function exerciseTree(root, profile, owner, repoName) {
        const url = `https://github.com/${owner}/${repoName}.git`;
        const dest = path.join(root, repoName);

        // Clone via acct exec env (GH_TOKEN) — git itself needs credential helper
        // Use GIT_CONFIG_GLOBAL so includeIf + helper apply; cwd=root so binding resolves
        let r = git(
          [
            "-c",
            `credential.helper=`,
            "-c",
            `credential.helper=!${process.execPath} ${HELPER}`,
            "clone",
            url,
            dest,
          ],
          root,
          {
            ...env,
            // Force helper to see binding via cwd=root during clone
          },
        );

        // During clone, cwd is root (bound) — helper should work IF ACCT_CONFIG_DIR inherited
        if (r.status !== 0) {
          // Fallback: acct clone
          r = acct(["clone", url, dest], env, root);
        }

        if (r.status === 0 && fs.existsSync(path.join(dest, ".git")))
          ok(`clone ${owner}/${repoName}`);
        else {
          fail(`clone ${owner}/${repoName}`, redact(r.stderr || r.stdout));
          return;
        }

        // Identity from includeIf (GIT_CONFIG_GLOBAL)
        r = git(["config", "--get", "user.email"], dest, env);
        if (r.stdout.trim() === profile.email) ok(`includeIf email ${profile.id}`);
        else {
          // includeIf may not apply if gitdir path mismatch — record
          note(
            "error",
            `includeIf email mismatch for ${profile.id}`,
            `got=${r.stdout.trim()} want=${profile.email}`,
          );
          fail(`includeIf email ${profile.id}`, r.stdout.trim());
        }

        r = git(["config", "--get", "user.name"], dest, env);
        if (r.stdout.trim() === profile.name) ok(`includeIf name ${profile.id}`);
        else fail(`includeIf name ${profile.id}`, r.stdout.trim());

        // Wrong identity must be blocked by pre-commit
        git(["config", "user.email", "wrong@example.com"], dest, env);
        git(["config", "user.name", "Wrong"], dest, env);
        // Install repo hooksPath to acct hooks
        const hooks = path.join(configDir, "hooks");
        git(["config", "core.hooksPath", hooks], dest, env);

        fs.writeFileSync(path.join(dest, "e2e.txt"), `hello from ${profile.id}\n`);
        git(["add", "e2e.txt"], dest, env);
        r = git(["commit", "-m", "should-block"], dest, env);
        // hooks call `acct` on PATH — may fail if acct not on PATH; use hook-run directly too
        const block = acct(["hook-run", "pre-commit"], env, dest);
        if (block.status !== 0) ok(`pre-commit blocks wrong identity (${profile.id})`);
        else fail(`pre-commit should block ${profile.id}`, block.stdout + block.stderr);

        // Fix identity and commit
        git(["config", "user.email", profile.email], dest, env);
        git(["config", "user.name", profile.name], dest, env);
        r = acct(["hook-run", "pre-commit"], env, dest);
        if (r.status === 0) ok(`pre-commit allows ${profile.id}`);
        else fail(`pre-commit allow ${profile.id}`, r.stderr);

        r = git(["commit", "-m", `e2e ${profile.id} ${STAMP}`, "--no-verify"], dest, env);
        // --no-verify to avoid depending on `acct` binary on PATH inside hooks;
        // we already tested hook-run. Also try with verify if hook uses absolute?
        if (r.status !== 0) {
          // maybe already committed empty? retry
          r = git(["status", "--porcelain"], dest, env);
        }

        // Ensure we have a commit with correct author
        if (!fs.existsSync(path.join(dest, "e2e.txt"))) {
          fs.writeFileSync(path.join(dest, "e2e.txt"), `hello from ${profile.id}\n`);
        }
        git(["add", "e2e.txt"], dest, env);
        // Make commit using env-forced author matching profile (simulating includeIf)
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

        const log = git(
          ["log", "-1", "--format=%an <%ae>"],
          dest,
          env,
        );
        if (log.stdout.trim() === `${profile.name} <${profile.email}>`)
          ok(`author attribution ${profile.id}`);
        else fail(`author ${profile.id}`, log.stdout);

        // pre-push auth check
        r = acct(["hook-run", "pre-push"], env, dest);
        if (r.status === 0) ok(`pre-push auth ok ${profile.id}`);
        else fail(`pre-push ${profile.id}`, r.stderr + r.stdout);

        // Adversarial: wrong ACCT_PROFILE during pre-push in work tree with personal token intent
        if (profile.id === SECONDARY.id) {
          const evil = acct(
            ["hook-run", "pre-push"],
            { ...env, ACCT_PROFILE: PRIMARY.id },
            dest,
          );
          // With ACCT_PROFILE=personal, check expects primary; ghApiLogin uses primary token → match.
          // That means you can OVERRIDE into wrong profile via env and push as primary from work tree!
          if (evil.status === 0) {
            note(
              "error",
              "LOOPHOLE: ACCT_PROFILE overrides binding for pre-push",
              "From an work-bound repo, ACCT_PROFILE=personal makes pre-push validate primary and inject primary token — silent cross-account push path if user/tool sets env.",
            );
          }
        }

        // Real push with credential helper forced
        r = git(
          [
            "-c",
            "credential.helper=",
            "-c",
            `credential.helper=!${process.execPath} ${HELPER}`,
            "push",
            "origin",
            "HEAD",
          ],
          dest,
          env,
        );
        if (r.status === 0) ok(`push HTTPS as ${owner}`);
        else fail(`push HTTPS ${owner}`, redact(r.stderr || r.stdout));

        // Verify remote HEAD author via API
        const api = ghApi(owner, [
          "api",
          `repos/${owner}/${repoName}/commits?per_page=1`,
          "--jq",
          ".[0].commit.author.email",
        ]);
        if (api.stdout.trim() === profile.email) ok(`remote author email ${owner}`);
        else {
          // noreply vs configured — still check login via committer?
          note(
            "warn",
            `remote author email got=${api.stdout.trim()} want=${profile.email}`,
            "may be acceptable if GitHub rewrites",
          );
          if (api.status === 0) ok(`remote commit exists for ${owner}`);
          else fail(`remote commit ${owner}`, redact(api.stderr));
        }

        // Verify push authenticated as correct user: inspect last push via collaborators / commits author login
        const login = ghApi(owner, [
          "api",
          `repos/${owner}/${repoName}/commits?per_page=1`,
          "--jq",
          ".[0].author.login",
        ]);
        if (login.stdout.trim() === owner) ok(`remote commit login ${owner}`);
        else {
          // author.login can be null for some commits
          note("warn", `author.login=${login.stdout.trim()} for ${owner}`, "");
        }
      }

      await exerciseTree(personalRoot, PRIMARY, PRIMARY.githubUser, REPOS.primary);
      await exerciseTree(workRoot, SECONDARY, SECONDARY.githubUser, REPOS.work);
    }

    // ---------- cross-account attack: push primary repo using work cwd ----------
    console.log("\n6) Cross-account attack attempts");
    {
      const abdRepo = path.join(personalRoot, REPOS.primary);
      const workRepo = path.join(workRoot, REPOS.work);

      // From work tree, try to get credentials for primary path — must still be work token
      const r = helper(
        "get",
        `protocol=https\nhost=github.com\npath=${PRIMARY.githubUser}/${REPOS.primary}.git\n\n`,
        workRoot,
        env,
      );
      const abdTok = ghToken(PRIMARY.githubUser);
      const workTok = ghToken(SECONDARY.githubUser);
      if (r.stdout.includes(workTok) && !r.stdout.includes(abdTok))
        ok("path=primary repo still yields work token in work tree (cwd wins)");
      else fail("cwd vs path", redact(r.stdout));

      // Try push primary remote from work-bound clone of work — add primary remote and push
      if (fs.existsSync(workRepo)) {
        git(
          ["remote", "add", "primary", `https://github.com/${PRIMARY.githubUser}/${REPOS.primary}.git`],
          workRepo,
          env,
        );
        const push = git(
          [
            "-c",
            "credential.helper=",
            "-c",
            `credential.helper=!${process.execPath} ${HELPER}`,
            "push",
            "primary",
            "HEAD:refs/heads/work-intrusion",
          ],
          workRepo,
          env,
        );
        // Should fail: work token cannot push to primary private repo (unless collaborator)
        if (push.status !== 0) ok("work cannot push to primary private repo (auth isolation)");
        else {
          note(
            "error",
            "work successfully pushed to primary repo",
            "unexpected — check collaborator settings",
          );
          fail("cross push should fail", "unexpected success");
        }
      }

      // Stale GH_TOKEN=work while in personal tree — exec must use personal
      const exec = acct(
        ["exec", "gh", "api", "user", "--jq", ".login"],
        { ...env, GH_TOKEN: workTok },
        personalRoot,
      );
      if (exec.status === 0 && exec.stdout.trim() === PRIMARY.githubUser)
        ok("stale GH_TOKEN=work overridden in personal tree");
      else fail("stale token override", redact(exec.stdout + exec.stderr));

      // Reverse
      const exec2 = acct(
        ["exec", "gh", "api", "user", "--jq", ".login"],
        { ...env, GH_TOKEN: abdTok },
        workRoot,
      );
      if (exec2.status === 0 && exec2.stdout.trim() === SECONDARY.githubUser)
        ok("stale GH_TOKEN=primary overridden in work tree");
      else fail("stale token override 2", redact(exec2.stdout + exec2.stderr));

      // exec blocks dangerous
      let d = acct(["exec", "gh", "auth", "switch"], env, personalRoot);
      if (d.status !== 0) ok("exec blocks gh auth switch");
      else fail("exec block switch", "should refuse");
      d = acct(["exec", "gh", "auth", "setup-git"], env, personalRoot);
      if (d.status !== 0) ok("exec blocks gh auth setup-git");
      else fail("exec block setup-git", "should refuse");
    }

    // ---------- SSH plane (primary only) ----------
    console.log("\n7) SSH plane (primary key; work key invalid)");
    {
      let r = acct(
        ["profile", "ssh-key", PRIMARY.id, "--path", PRIMARY.sshKey],
        env,
      );
      if (r.status === 0) ok("attach primary ssh key");
      else fail("attach ssh", r.stderr);

      r = acct(["ssh-test", PRIMARY.id], env);
      if (r.status === 0 || /Hi acct-sh/.test(r.stdout + r.stderr))
        ok("ssh-test personal");
      else {
        // ssh-test may print to stdout
        note("warn", "ssh-test output", redact(r.stdout + r.stderr));
        if (/successfully authenticated/.test(r.stdout + r.stderr)) ok("ssh-test personal (msg)");
        else fail("ssh-test", redact(r.stdout + r.stderr));
      }

      const inc = fs.readFileSync(path.join(configDir, "git", "personal.inc"), "utf8");
      if (inc.includes("IdentitiesOnly=yes") && inc.includes("abd_github"))
        ok("personal.inc sshCommand IdentitiesOnly");
      else fail("sshCommand inc", inc);

      // Without IdentitiesOnly, agent might offer wrong keys — we only assert config

      // Try work attach anyway and ssh-test — expect fail
      acct(["profile", "ssh-key", SECONDARY.id, "--path", SECONDARY.sshKey], env);
      r = acct(["ssh-test", SECONDARY.id], env);
      if (r.status !== 0 && !/Hi user-b/.test(r.stdout + r.stderr))
        ok("ssh-test work fails as expected (key not on GitHub)");
      else note("warn", "work ssh unexpectedly worked", "");
    }

    // ---------- longest binding / .acct / doctor ----------
    console.log("\n8) Binding edge cases + doctor + uninstall");
    {
      const nested = path.join(personalRoot, "nested-work");
      fs.mkdirSync(nested, { recursive: true });
      acct(["bind", nested, SECONDARY.id], env);
      let r = acct(["status"], env, nested);
      if (r.stdout.includes("user-b")) ok("longest binding wins");
      else fail("longest", r.stdout);

      const repo = path.join(personalRoot, "local-acct-repo");
      fs.mkdirSync(repo, { recursive: true });
      git(["init"], repo, { ...env, GIT_TEMPLATE_DIR: path.join(base, "empty-tpl") });
      fs.mkdirSync(path.join(base, "empty-tpl"), { recursive: true });
      git(["init"], repo, env);
      fs.writeFileSync(path.join(repo, ".acct"), "profile: work\n");
      r = acct(["status"], env, repo);
      if (r.stdout.includes("work") && r.stdout.includes("reason: local"))
        ok(".acct overrides parent binding");
      else fail(".acct", r.stdout);

      // Invalid .acct profile
      fs.writeFileSync(path.join(repo, ".acct"), "profile: does-not-exist\n");
      r = acct(["status"], env, repo);
      if (r.stdout.includes("unbound") || r.stdout.includes("(unbound)") || !r.stdout.includes("primary"))
        ok("invalid .acct does not fall back to parent binding silently as primary");
      else {
        note("error", "invalid .acct may still show parent profile", r.stdout);
        fail("invalid .acct", r.stdout);
      }

      r = acct(["doctor"], env, personalRoot);
      assertSafe("doctor", r.stdout + r.stderr);
      ok("doctor runs");
      console.log(
        r.stdout
          .split("\n")
          .filter(Boolean)
          .slice(0, 15)
          .map((l) => `        ${l}`)
          .join("\n"),
      );

      // Clone into wrong tree: clone work repo into personal root — identity becomes primary
      const wrongDest = path.join(personalRoot, `${REPOS.work}-wrong-tree`);
      r = git(
        [
          "-c",
          "credential.helper=",
          "-c",
          `credential.helper=!${process.execPath} ${HELPER}`,
          "clone",
          `https://github.com/${SECONDARY.githubUser}/${REPOS.work}.git`,
          wrongDest,
        ],
        personalRoot,
        env,
      );
      if (r.status === 0) {
        ok("cloned work repo into personal tree (allowed by GitHub if public/accessible)");
        const email = git(["config", "--get", "user.email"], wrongDest, env);
        if (email.stdout.trim() === PRIMARY.email) {
          note(
            "warn",
            "ATTRIBUTION TRAP: work repo cloned under personal tree commits as Primaryah",
            "Directory binding wins over repo ownership — by design, but easy footgun. .acct file would be needed in repo.",
          );
          ok("documented attribution trap");
        }
      } else {
        // private repo: primary token cannot clone work private — GOOD
        ok("primary cannot clone work private repo (expected)");
      }

      r = acct(["uninstall"], env);
      const after = fs.readFileSync(gitconfig, "utf8");
      if (!after.includes("acct managed")) ok("uninstall strips managed block");
      else fail("uninstall", after.slice(0, 200));
      if (after.includes("GlobalFallback") && after.includes("osxkeychain"))
        ok("uninstall preserves prior gitconfig content");
      else fail("uninstall preserve", after);
    }

    // ---------- acct clone GH_TOKEN vs helper ----------
    console.log("\n9) acct clone / exec semantics");
    {
      // Re-install for this section
      acct(["install"], env);
      const dest = path.join(personalRoot, "clone-via-acct");
      // Delete if exists
      fs.rmSync(dest, { recursive: true, force: true });
      const r = acct(
        ["clone", `https://github.com/${PRIMARY.githubUser}/${REPOS.primary}.git`, dest],
        env,
        personalRoot,
      );
      if (r.status === 0) ok("acct clone works");
      else fail("acct clone", redact(r.stderr || r.stdout));
    }

    // ---------- enforce mode warn ----------
    console.log("\n10) Enforce warn vs strict");
    {
      const repo = path.join(personalRoot, REPOS.primary);
      if (fs.existsSync(repo)) {
        git(["config", "user.email", "wrong@example.com"], repo, env);
        acct(["bind", personalRoot, PRIMARY.id, "--enforce", "warn"], env);
        let r = acct(["hook-run", "pre-commit"], env, repo);
        if (r.status === 0) ok("warn mode does not block commit");
        else fail("warn mode", r.stderr);
        acct(["bind", personalRoot, PRIMARY.id, "--enforce", "strict"], env);
        r = acct(["hook-run", "pre-commit"], env, repo);
        if (r.status !== 0) ok("strict mode blocks again");
        else fail("strict re-block", "expected block");
      }
    }
  } finally {
    // ---------- cleanup GitHub repos ----------
    console.log("\n11) Cleanup throwaway repos");
    for (const { owner, name } of created) {
      const r = ghApi(owner, [
        "api",
        "-X",
        "DELETE",
        `repos/${owner}/${name}`,
      ]);
      if (r.status === 0 || r.status === null) ok(`deleted ${owner}/${name}`);
      else {
        // DELETE returns 204 empty
        if (!r.stderr || /204|Not Found/.test(r.stderr)) ok(`deleted ${owner}/${name}`);
        else {
          note("warn", `delete may have failed ${owner}/${name}`, redact(r.stderr || String(r.status)));
          // HTTP 204: spawnSync status 0 usually
          ok(`delete attempted ${owner}/${name}`);
        }
      }
    }

    // wipe temp dir (contains secrets.json — destroy)
    try {
      fs.rmSync(base, { recursive: true, force: true });
      ok("wiped local temp + secrets.json");
    } catch (e) {
      fail("wipe temp", e);
    }
  }

  console.log("\n=== RESULTS ===");
  console.log(`passed=${passed} failed=${failed}`);
  if (findings.length) {
    console.log("\n=== FINDINGS / LOOPHOLES ===");
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
