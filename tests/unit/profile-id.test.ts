import { describe, expect, it } from "vitest";
import {
  assertValidProfileId,
  isValidProfileId,
} from "../../src/util/profile-id.js";

describe("profile id allowlist", () => {
  it("accepts safe ids used as include/ssh filenames", () => {
    for (const id of ["personal", "work", "work", "Work_1", "a", "A1-b_c"]) {
      expect(isValidProfileId(id), id).toBe(true);
      expect(() => assertValidProfileId(id)).not.toThrow();
    }
  });

  it("rejects shell metacharacters, paths, and newlines", () => {
    const bad = [
      "evil$(whoami)",
      "evil`id`",
      "evil;rm",
      "evil\nprofile",
      "../personal",
      "work/../../personal",
      "has space",
      "",
      "1leadingdigit",
      "-dash",
      "_under",
      "a".repeat(65),
    ];
    for (const id of bad) {
      expect(isValidProfileId(id), JSON.stringify(id)).toBe(false);
      expect(() => assertValidProfileId(id)).toThrow(/Invalid profile id/);
    }
  });
});
