/**
 * E2E identity helpers — never hardcode real people in the repo.
 *
 * Synthetic harnesses (unit-like / offline): use `syntheticPair()`.
 * Live harnesses (real gh/git): use `loadLivePair()` which reads ONLY from:
 *   1. ACCT_E2E_IDENTITIES_FILE (JSON path), or
 *   2. scripts/e2e-identities.local.json (gitignored), or
 *   3. Env vars ACCT_E2E_A_* / ACCT_E2E_B_* (see example file)
 *
 * Copy scripts/e2e-identities.example.json → e2e-identities.local.json and fill in.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCAL = path.join(SCRIPTS_DIR, "e2e-identities.local.json");

/** Offline / synthetic pair — no real people. */
export function syntheticPair() {
  return {
    a: {
      id: "personal",
      githubUser: "user-a",
      name: "User A",
      email: "user-a@example.com",
      sshKey: "",
    },
    b: {
      id: "work",
      githubUser: "user-b",
      name: "User B",
      email: "user-b@example.com",
      sshKey: "",
    },
  };
}

function fromEnv(prefix, defaults) {
  const githubUser = process.env[`${prefix}_USER`]?.trim();
  const name = process.env[`${prefix}_NAME`]?.trim();
  const email = process.env[`${prefix}_EMAIL`]?.trim();
  const id = process.env[`${prefix}_ID`]?.trim() || defaults.id;
  const sshKey = process.env[`${prefix}_SSH`]?.trim() || "";
  if (!githubUser || !name || !email) return null;
  return { id, githubUser, name, email, sshKey };
}

function normalizePerson(raw, fallbackId) {
  if (!raw || typeof raw !== "object") return null;
  const githubUser = String(raw.githubUser || raw.user || "").trim();
  const name = String(raw.name || "").trim();
  const email = String(raw.email || "").trim();
  const id = String(raw.id || fallbackId).trim();
  const sshKey = String(raw.sshKey || raw.sshKeyPath || "").trim();
  if (!githubUser || !name || !email || !id) return null;
  return { id, githubUser, name, email, sshKey };
}

function loadJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const a = normalizePerson(parsed.a || parsed.primary || parsed.personal, "personal");
  const b = normalizePerson(parsed.b || parsed.secondary || parsed.work, "work");
  if (!a || !b) {
    throw new Error(
      `Invalid e2e identities file ${filePath}: need a/b (or primary/secondary) with githubUser, name, email, id`,
    );
  }
  return { a, b };
}

/**
 * Live dual-account identities. Throws if not configured (no hardcoded fallbacks).
 */
export function loadLivePair() {
  const file =
    process.env.ACCT_E2E_IDENTITIES_FILE?.trim() ||
    (fs.existsSync(DEFAULT_LOCAL) ? DEFAULT_LOCAL : "");

  let pair = null;
  if (file) pair = loadJsonFile(file);

  if (!pair) {
    const a = fromEnv("ACCT_E2E_A", { id: "personal" });
    const b = fromEnv("ACCT_E2E_B", { id: "work" });
    if (a && b) pair = { a, b };
  }

  if (!pair) {
    throw new Error(
      [
        "Live E2E identities are not configured (refusing hardcoded personal accounts).",
        `Copy ${path.join(SCRIPTS_DIR, "e2e-identities.example.json")} → ${DEFAULT_LOCAL}`,
        "or set ACCT_E2E_IDENTITIES_FILE / ACCT_E2E_A_* + ACCT_E2E_B_* env vars.",
      ].join("\n"),
    );
  }

  // Expand ~ in ssh key paths
  for (const p of [pair.a, pair.b]) {
    if (p.sshKey.startsWith("~/")) {
      p.sshKey = path.join(os.homedir(), p.sshKey.slice(2));
    }
  }

  return pair;
}

/** Escape a string for use inside a RegExp. */
export function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
