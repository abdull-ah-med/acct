import { describe, expect, it } from "vitest";
import {
  parseCredentialInput,
  formatCredentialOutput,
  isSafeHost,
  hostAllowed,
  splitHostPort,
} from "../../src/credential/protocol.js";

describe("credential protocol (git-scm.com/docs/git-credential)", () => {
  it("parses key=value lines terminated by blank line", () => {
    const attrs = parseCredentialInput(
      "protocol=https\nhost=github.com\npath=org/repo.git\n\nignored=after\n",
    );
    expect(attrs.protocol).toBe("https");
    expect(attrs.host).toBe("github.com");
    expect(attrs.path).toBe("org/repo.git");
    expect(attrs.ignored).toBeUndefined();
  });

  it("formats output with trailing blank line", () => {
    const out = formatCredentialOutput({
      username: "alice",
      password: "gho_TEST_ONLY_secret",
    });
    expect(out).toBe(
      "username=alice\npassword=gho_TEST_ONLY_secret\n\n",
    );
  });

  it("formats quit=true fail-closed response", () => {
    expect(formatCredentialOutput({ quit: "1" })).toBe("quit=1\n\n");
  });

  it("rejects empty or malicious hosts", () => {
    expect(isSafeHost(undefined)).toBe(false);
    expect(isSafeHost("")).toBe(false);
    expect(isSafeHost("github.com")).toBe(true);
    expect(isSafeHost("github.com\nhost=evil")).toBe(false);
    expect(isSafeHost("github.com%0Ahost=evil")).toBe(false);
  });

  it("I7 hostname-only profile: bare host or :443 only", () => {
    expect(hostAllowed("github.com", "github.com")).toBe(true);
    expect(hostAllowed("github.com:443", "github.com")).toBe(true);
    expect(hostAllowed("GITHUB.COM", "github.com")).toBe(true);
    expect(hostAllowed("github.com:8443", "github.com")).toBe(false);
    expect(hostAllowed("github.com:9", "github.com")).toBe(false);
    expect(hostAllowed("github.com:80", "github.com")).toBe(false);
    expect(hostAllowed("evil.com", "github.com")).toBe(false);
  });

  it("I7 pinned :443 is treated as hostname-only (git omits default port)", () => {
    expect(hostAllowed("github.com", "github.com:443")).toBe(true);
    expect(hostAllowed("github.com:443", "github.com:443")).toBe(true);
    expect(hostAllowed("github.com:8443", "github.com:443")).toBe(false);
  });

  it("I7 non-default pinned port still exact-matches", () => {
    expect(hostAllowed("ghe.example.com:8443", "ghe.example.com:8443")).toBe(
      true,
    );
    expect(hostAllowed("ghe.example.com", "ghe.example.com:8443")).toBe(false);
    expect(hostAllowed("ghe.example.com:443", "ghe.example.com:8443")).toBe(
      false,
    );
  });

  it("splitHostPort handles host:port and bracket IPv6", () => {
    expect(splitHostPort("github.com:443")).toEqual({
      hostname: "github.com",
      port: "443",
    });
    expect(splitHostPort("[::1]:8443")).toEqual({
      hostname: "[::1]",
      port: "8443",
    });
  });

  it("parses url attribute into parts", () => {
    const attrs = parseCredentialInput(
      "url=https://alice@github.com/org/repo.git\n\n",
    );
    expect(attrs.protocol).toBe("https");
    expect(attrs.host).toBe("github.com");
    expect(attrs.username).toBe("alice");
  });

  it("rejects duplicate disagreeing host lines (no last-wins)", () => {
    const attrs = parseCredentialInput(
      "protocol=https\nhost=evil.com\nhost=github.com\n\n",
    );
    expect(attrs.host).toBe("");
    expect(isSafeHost(attrs.host)).toBe(false);
  });

  it("rejects url= that disagrees with explicit host", () => {
    const attrs = parseCredentialInput(
      "protocol=https\nhost=github.com\nurl=https://evil.com/x\n\n",
    );
    expect(attrs.host).toBe("");
  });

  it("allows agreeing url= and host=", () => {
    const attrs = parseCredentialInput(
      "host=github.com\nurl=https://github.com/org/repo.git\n\n",
    );
    expect(attrs.host).toBe("github.com");
    expect(attrs.protocol).toBe("https");
  });

  it("host=github.com:443 + url=https://github.com does not conflict", () => {
    const attrs = parseCredentialInput(
      "protocol=https\nhost=github.com:443\nurl=https://github.com/foo\n\n",
    );
    expect(attrs.host).not.toBe("");
    expect(attrs.host.toLowerCase()).toMatch(/github\.com/);
  });

  it("host=github.com:8443 + matching url port does not conflict", () => {
    const attrs = parseCredentialInput(
      "protocol=https\nhost=github.com:8443\nurl=https://github.com:8443/foo\n\n",
    );
    expect(attrs.host).toBe("github.com:8443");
  });

  it("host=github.com:443 + different url host conflicts", () => {
    const attrs = parseCredentialInput(
      "protocol=https\nhost=github.com:443\nurl=https://example.com/foo\n\n",
    );
    expect(attrs.host).toBe("");
  });
});
