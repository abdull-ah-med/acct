/**
 * Profile ids become include filenames (`git/<id>.inc`) and SSH key suffixes.
 * Restrict to a filesystem- and shell-safe allowlist.
 *
 * Case-fold uniqueness: macOS APFS/HFS+ and Windows NTFS are case-insensitive,
 * so `work` and `WORK` would write the same `work.inc` and silently overwrite
 * identity (live probe 2026-08-08). Git documents this class of FS via
 * `gitdir/i` and `core.ignoreCase` (https://git-scm.com/docs/git-config).
 *
 * Cite: docs/research/i18-shell-bypass-round2-cites-2026-08-08.md
 * Cite: docs/research/i18-profile-case-round3-cites-2026-08-08.md
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

/** ASCII case-fold key for include/SSH filename collision checks. */
export function profileIdCaseKey(id: string): string {
  return id.toLowerCase();
}

export interface ProfileIdLike {
  id: string;
}

/**
 * Return an existing profile whose id case-folds to the same key as `id`
 * but is not an exact string match (would collide on case-insensitive FS).
 */
export function findProfileIdCaseCollision(
  profiles: readonly ProfileIdLike[],
  id: string,
): ProfileIdLike | undefined {
  const key = profileIdCaseKey(id);
  return profiles.find(
    (p) => profileIdCaseKey(p.id) === key && p.id !== id,
  );
}

/**
 * Reject ids that would overwrite another profile's `git/<id>.inc` on
 * case-insensitive filesystems (macOS/Windows). Exact-id updates are OK.
 */
export function assertNoProfileIdCaseCollision(
  profiles: readonly ProfileIdLike[],
  id: string,
): void {
  const hit = findProfileIdCaseCollision(profiles, id);
  if (hit) {
    throw new Error(
      `Profile id ${JSON.stringify(id)} collides with existing ${JSON.stringify(hit.id)} under case-insensitive filesystems (macOS/Windows): both map to git/${profileIdCaseKey(id)}.inc and would overwrite identity. Choose a distinct id.`,
    );
  }
}

/** Pairs of profile ids that case-fold to the same key (corrupt configs). */
export function listProfileIdCaseCollisions(
  profiles: readonly ProfileIdLike[],
): Array<[string, string]> {
  const byKey = new Map<string, string[]>();
  for (const p of profiles) {
    const key = profileIdCaseKey(p.id);
    const list = byKey.get(key) ?? [];
    list.push(p.id);
    byKey.set(key, list);
  }
  const pairs: Array<[string, string]> = [];
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        pairs.push([unique[i]!, unique[j]!]);
      }
    }
  }
  return pairs;
}
