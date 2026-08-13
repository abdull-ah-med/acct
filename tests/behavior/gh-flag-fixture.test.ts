import { describe, expect, it } from "vitest";
import { illegalGhFlags } from "../harness/parse-gh-fixes.js";

describe("gh-auth-flags fixture (independent of acct)", () => {
  it("records that login has no --user and refresh has no --user", () => {
    expect(
      illegalGhFlags([{ verb: "login", flags: ["user"] }]),
    ).not.toEqual([]);
    expect(
      illegalGhFlags([{ verb: "refresh", flags: ["user"] }]),
    ).not.toEqual([]);
    expect(
      illegalGhFlags([{ verb: "switch", flags: ["hostname", "user"] }]),
    ).toEqual([]);
    expect(
      illegalGhFlags([{ verb: "token", flags: ["hostname", "user"] }]),
    ).toEqual([]);
  });
});
