#!/usr/bin/env node
/**
 * Delete leftover acct-e2e-* throwaway repos for the configured live pair ONLY.
 * Requires delete_repo scope: gh auth refresh -h github.com -u <user> -s delete_repo
 * Cite: https://cli.github.com/manual/gh_repo_delete
 */
import { spawnSync } from "node:child_process";
import { loadLivePair } from "./e2e-identities.mjs";

const { a: PRIMARY, b: SECONDARY } = loadLivePair();
const ALLOWED = new Set([PRIMARY.githubUser, SECONDARY.githubUser]);
const FORBIDDEN = /mair|reachrazamair|Work-Mair|mairahmed/i;

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    encoding: "utf8",
    ...opts,
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function tokenFor(user) {
  const r = run("gh", ["auth", "token", "--hostname", "github.com", "--user", user]);
  if (r.status !== 0) throw new Error(`token fail ${user}: ${r.stderr}`);
  return r.stdout.trim();
}

function listE2e(user) {
  const tok = tokenFor(user);
  const r = run(
    "gh",
    [
      "api",
      "--paginate",
      "user/repos?per_page=100&affiliation=owner",
      "--jq",
      '.[] | select(.name|startswith("acct-e2e-")) | .full_name',
    ],
    { env: { ...process.env, GH_TOKEN: tok, GITHUB_TOKEN: undefined } },
  );
  if (r.status !== 0) throw new Error(r.stderr || "list failed");
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function deleteRepo(fullName, user) {
  if (FORBIDDEN.test(fullName)) throw new Error(`SAFETY: refused ${fullName}`);
  const [owner, name] = fullName.split("/");
  if (!ALLOWED.has(owner) || owner !== user) {
    throw new Error(`SAFETY: owner ${owner} not allowed / mismatch`);
  }
  if (!name?.startsWith("acct-e2e-")) throw new Error(`SAFETY: not e2e repo ${fullName}`);
  const tok = tokenFor(user);
  const r = run("gh", ["repo", "delete", fullName, "--yes"], {
    env: { ...process.env, GH_TOKEN: tok, GITHUB_TOKEN: undefined },
  });
  return r;
}

console.log(`=== cleanup acct-e2e-* (${[...ALLOWED].join(" + ")} ONLY) ===\n`);

let failed = 0;
for (const user of ALLOWED) {
  let repos;
  try {
    repos = listE2e(user);
  } catch (e) {
    console.log(`FAIL list ${user}: ${e}`);
    failed++;
    continue;
  }
  if (!repos.length) {
    console.log(`OK  ${user}: no acct-e2e-* leftovers`);
    continue;
  }
  console.log(`${user}: ${repos.length} leftover(s)`);
  for (const full of repos) {
    const r = deleteRepo(full, user);
    if (r.status === 0) {
      console.log(`  PASS deleted ${full}`);
    } else {
      failed++;
      console.log(`  FAIL delete ${full}`);
      console.log(`        ${(r.stderr || r.stdout || "").slice(0, 200)}`);
      console.log(
        `        Fix: gh auth refresh -h github.com -u ${user} -s delete_repo`,
      );
    }
  }
}

process.exit(failed ? 1 : 0);
