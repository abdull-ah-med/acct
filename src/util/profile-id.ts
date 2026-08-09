/**
 * Profile ids become include filenames (`git/<id>.inc`) and SSH key suffixes.
 * Restrict to a filesystem- and shell-safe allowlist.
 *
 * Cite: docs/research/i18-shell-bypass-round2-cites-2026-08-08.md
 * Cite: src/identity/includeIf.ts ; src/ssh/keys.ts
 */
const PROFILE_ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function isValidProfileId(id: string): boolean {
  return PROFILE_ID_RE.test(id);
}

export function assertValidProfileId(id: string): void {
  if (!isValidProfileId(id)) {
    throw new Error(
      `Invalid profile id ${JSON.stringify(id)}: use 1–64 chars, start with a letter, then letters/digits/_/- only (no paths, spaces, or shell metacharacters)`,
    );
  }
}
