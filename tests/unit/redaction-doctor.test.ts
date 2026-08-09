import { describe, expect, it } from "vitest";
import {
  redactSecret,
  sanitizeDebugMessage,
  posixShellSingleQuote,
} from "../../src/util/paths.js";
import { effectiveCredentialHelpers } from "../../src/doctor/run.js";

describe("debug redaction (I13)", () => {
  it("never returns token prefixes from redactSecret", () => {
    expect(redactSecret("gho_TEST_ONLY_abcdefghijklmnopqrst")).toBe(
      "[REDACTED]",
    );
    expect(redactSecret("github_pat_11AAAA")).toBe("[REDACTED]");
    expect(redactSecret("short")).toBe("[REDACTED]");
  });

  it("sanitizes debug lines containing token shapes", () => {
    const line = sanitizeDebugMessage(
      "loaded token for github.com::u=gho_TEST_ONLY_abcdefghijklmnop",
    );
    expect(line).not.toMatch(/gho_[A-Za-z0-9]/);
    expect(line).toContain("[REDACTED]");
  });

  it("sanitizes password= fields", () => {
    expect(sanitizeDebugMessage("password=gho_SECRET_VALUE_HERE")).toBe(
      "password=[REDACTED]",
    );
  });
});

describe("posixShellSingleQuote", () => {
  it("quotes spaces and embeds single quotes safely", () => {
    expect(posixShellSingleQuote("/a b/c")).toBe("'/a b/c'");
    expect(posixShellSingleQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

describe("effectiveCredentialHelpers", () => {
  it("honors empty helper reset (gitcredentials / 24321375)", () => {
    expect(
      effectiveCredentialHelpers(["osxkeychain", "", "!'/path/acct'"]),
    ).toEqual(["!'/path/acct'"]);
  });

  it("keeps competing helpers when reset is missing", () => {
    expect(effectiveCredentialHelpers(["osxkeychain", "gh"])).toEqual([
      "osxkeychain",
      "gh",
    ]);
  });
});
