import { describe, expect, it } from "vitest";
import { assertSafeSshHost, sshCommandFor } from "../../src/ssh/keys.js";
import type { Profile } from "../../src/types.js";

describe("ssh host + command", () => {
  it("accepts normal hosts", () => {
    expect(assertSafeSshHost("github.com")).toBe("github.com");
    expect(assertSafeSshHost("github.example.com")).toBe("github.example.com");
  });

  it("rejects option-injection hosts", () => {
    expect(() => assertSafeSshHost("github.com -o ProxyCommand=x")).toThrow(
      /Invalid SSH host/,
    );
    expect(() => assertSafeSshHost("")).toThrow(/Invalid SSH host/);
  });

  it("quotes key paths with spaces in sshCommandFor", () => {
    const profile: Profile = {
      id: "work",
      githubUser: "u",
      host: "github.com",
      name: "N",
      email: "e@x.com",
      protocol: "ssh",
      sshKeyPath: "/tmp/my keys/id",
    };
    expect(sshCommandFor(profile)).toBe(
      "ssh -i '/tmp/my keys/id' -o IdentitiesOnly=yes -o HostName=github.com",
    );
  });

  it("builds sshCommand for https profiles with attached keys (I8b)", () => {
    const profile: Profile = {
      id: "personal",
      githubUser: "u",
      host: "github.com",
      name: "N",
      email: "e@x.com",
      protocol: "https",
      sshKeyPath: "/tmp/id",
    };
    expect(sshCommandFor(profile)).toContain("IdentitiesOnly=yes");
    expect(sshCommandFor(profile)).toContain("-i '/tmp/id'");
  });
});
