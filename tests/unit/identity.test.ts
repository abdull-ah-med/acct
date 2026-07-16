import { describe, expect, it } from "vitest";
import {
  renderProfileInclude,
  stripManagedBlock,
  buildIncludeIfBlock,
} from "../../src/identity/includeIf.js";
import type { AcctConfig, Profile } from "../../src/types.js";

const profile: Profile = {
  id: "work",
  githubUser: "work-user",
  host: "github.com",
  name: "Work",
  email: "work@corp.com",
  protocol: "https",
};

describe("identity includeIf", () => {
  it("uses !'…' helper form so paths with spaces work", () => {
    const inc = renderProfileInclude(
      profile,
      "/Volumes/Work/untitled folder 3/bin/git-credential-acct.js",
    );
    expect(inc).toContain(
      "helper = !'/Volumes/Work/untitled folder 3/bin/git-credential-acct.js'",
    );
  });

  it("renders user identity and resets credential helpers for https", () => {
    const inc = renderProfileInclude(profile, "acct");
    expect(inc).toContain("name = Work");
    expect(inc).toContain("email = work@corp.com");
    expect(inc).toContain('helper = ""');
    expect(inc).toContain("helper = !'acct'");
    expect(inc).toContain("username = work-user");
  });

  it("renders IdentitiesOnly sshCommand for ssh profiles", () => {
    const ssh: Profile = {
      ...profile,
      protocol: "ssh",
      sshKeyPath: "/tmp/id_work",
    };
    const inc = renderProfileInclude(ssh, "acct");
    expect(inc).toContain("IdentitiesOnly=yes");
    expect(inc).toContain("-i /tmp/id_work");
    expect(inc).toContain("HostName=github.com");
  });

  it("quotes ssh key paths with spaces", () => {
    const ssh: Profile = {
      ...profile,
      protocol: "ssh",
      sshKeyPath: "/tmp/my keys/id_work",
    };
    const inc = renderProfileInclude(ssh, "acct");
    expect(inc).toContain('-i "/tmp/my keys/id_work"');
  });

  it("rejects ssh hosts that could inject options", () => {
    const ssh: Profile = {
      ...profile,
      protocol: "ssh",
      host: "github.com -o ProxyCommand=evil",
      sshKeyPath: "/tmp/id_work",
    };
    expect(() => renderProfileInclude(ssh, "acct")).toThrow(/Invalid SSH host/);
  });

  it("strips managed block cleanly", () => {
    const text = `[user]\n\tname = Global\n\n# >>> acct managed begin >>>\nfoo\n# <<< acct managed end <<<\n\n[alias]\n\tst = status\n`;
    const next = stripManagedBlock(text);
    expect(next).not.toContain("acct managed");
    expect(next).toContain("name = Global");
    expect(next).toContain("st = status");
  });

  it("builds includeIf for bindings", () => {
    const config: AcctConfig = {
      version: 1,
      defaultEnforce: "strict",
      profiles: [profile],
      bindings: [{ path: "/Users/x/Work", profileId: "work" }],
    };
    const block = buildIncludeIfBlock(config, {
      HOME: "/Users/x",
      ACCT_CONFIG_DIR: "/Users/x/.config/acct",
    });
    expect(block).toContain("includeIf");
    expect(block).toContain("/Users/x/Work/");
    expect(block).toContain("work.inc");
  });
});
