import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../fixtures/gh-auth-flags.json",
    ),
    "utf8",
  ),
) as { commands: Record<string, string[]> };

export interface GhInvocation {
  verb: string;
  flags: string[];
}

/** Pull `gh auth …` command lines (not prose that mentions gh). */
export function parseGhAuthInvocations(lines: string[]): GhInvocation[] {
  const out: GhInvocation[] = [];
  for (const raw of lines) {
    const command = raw.trim().replace(/^#(?:[^:]+:)?\s*/, "");
    if (!command.startsWith("gh auth ")) continue;
    const m = command.match(/^gh\s+auth\s+(\S+)(.*)$/);
    if (!m) continue;
    const verb = m[1]!;
    const rest = m[2] ?? "";
    const found: string[] = [];
    for (const token of rest.split(/\s+/).filter(Boolean)) {
      if (token.startsWith("--")) {
        found.push(token.replace(/^--/, "").split("=")[0]!.replace(/[^a-z0-9-].*$/i, ""));
      }
    }
    out.push({ verb, flags: found });
  }
  return out;
}

export function illegalGhFlags(invocations: GhInvocation[]): string[] {
  const errors: string[] = [];
  for (const inv of invocations) {
    const allowed = fixture.commands[inv.verb];
    if (!allowed) {
      errors.push(`unknown gh auth verb "${inv.verb}"`);
      continue;
    }
    for (const f of inv.flags) {
      if (!allowed.includes(f)) {
        errors.push(`gh auth ${inv.verb} does not support --${f}`);
      }
    }
  }
  return errors;
}
