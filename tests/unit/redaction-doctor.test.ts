import { describe, expect, it } from "vitest";
import {
  redactSecret,
  sanitizeDebugMessage,
  posixShellSingleQuote,
} from "../../src/util/paths.js";
import { effectiveCredentialHelpers, keyringBackendLabel } from "../../src/doctor/run.js";

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

  it("redacts ghc_ and github_pat_ tokens", () => {
    expect(sanitizeDebugMessage("tok=ghc_ABCDEFGHIJKLMNOPQRST")).toContain(
      "[REDACTED]",
    );
    expect(
      sanitizeDebugMessage("tok=github_pat_11AAAA_BBBBBBBBBBBBBBBB"),
    ).toContain("[REDACTED]");
  });

  it("redacts Authorization Bearer headers", () => {
    const line = sanitizeDebugMessage(
      "Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRST",
    );
    expect(line).toContain("Bearer [REDACTED]");
    expect(line).not.toMatch(/ghp_/);
  });

  it("redacts x-access-token URL embeds", () => {
    const line = sanitizeDebugMessage(
      "https://x-access-token:ghp_ABCDEFGHIJKLMNOPQRST@github.com/org/repo",
    );
    expect(line).toContain("x-access-token:[REDACTED]@");
    expect(line).not.toMatch(/ghp_/);
  });

  it("redacts 40-char hex strings", () => {
    const hex = "a".repeat(40);
    expect(sanitizeDebugMessage(`sha=${hex}`)).toContain("[REDACTED]");
  });

  it("redacts token = with spaces", () => {
    expect(
      sanitizeDebugMessage("token = ghp_ABCDEFGHIJKLMNOPQRST"),
    ).toMatch(/token\s*=\s*\[REDACTED\]/i);
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

describe("keyringBackendLabel", () => {
  it("names the OS secret store for each platform", () => {
    expect(keyringBackendLabel("darwin")).toContain("macOS Keychain");
    expect(keyringBackendLabel("win32")).toContain("Windows Credential Manager");
    expect(keyringBackendLabel("linux")).toMatch(/libsecret|KWallet/i);
  });
});
