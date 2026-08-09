import { describe, expect, it } from "vitest";
import {
  assertValidProfileId,
  assertNoProfileIdCaseCollision,
  findProfileIdCaseCollision,
  isValidProfileId,
  listProfileIdCaseCollisions,
  profileIdCaseKey,
} from "../../src/util/profile-id.js";

describe("profile id allowlist", () => {
  it("accepts safe ids used as include/ssh filenames", () => {
    for (const id of ["personal", "work", "Work_1", "a", "A1-b_c", "client"]) {
      expect(isValidProfileId(id), id).toBe(true);
      expect(() => assertValidProfileId(id)).not.toThrow();
    }
  });

  it("rejects Windows reserved device names", () => {
    for (const id of ["CON", "aux", "com1", "LPT9", "NUL", "Prn"]) {
      expect(isValidProfileId(id), id).toBe(false);
      expect(() => assertValidProfileId(id)).toThrow(/reserved|Invalid profile id/i);
    }
    expect(() => assertValidProfileId("work")).not.toThrow();
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

  it("rejects case-fold collisions with existing profiles (macOS/Windows inc overwrite)", () => {
    const profiles = [{ id: "work" }, { id: "personal" }];
    expect(findProfileIdCaseCollision(profiles, "WORK")?.id).toBe("work");
    expect(findProfileIdCaseCollision(profiles, "work")).toBeUndefined();
    expect(findProfileIdCaseCollision(profiles, "Personal")?.id).toBe(
      "personal",
    );
    expect(() => assertNoProfileIdCaseCollision(profiles, "WORK")).toThrow(
      /collides with existing "work"/,
    );
    expect(() =>
      assertNoProfileIdCaseCollision(profiles, "work"),
    ).not.toThrow();
    expect(profileIdCaseKey("WORK")).toBe("work");
    expect(listProfileIdCaseCollisions([{ id: "work" }, { id: "WORK" }])).toEqual(
      [["work", "WORK"]],
    );
    expect(listProfileIdCaseCollisions(profiles)).toEqual([]);
  });
});
