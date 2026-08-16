import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  renderProfileInclude,
  stripManagedBlock,
  buildIncludeIfBlock,
  ensureCredentialShim,
} from "../../src/identity/includeIf.js";
import { posixShellSingleQuote } from "../../src/util/paths.js";
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

  it("renders IdentitiesOnly sshCommand and keeps HTTPS helper (I8b)", () => {
    const ssh: Profile = {
      ...profile,
      protocol: "ssh",
      sshKeyPath: "/tmp/id_work",
    };
    const inc = renderProfileInclude(ssh, "acct");
    expect(inc).toContain('helper = ""');
    expect(inc).toContain("helper = !'acct'");
    expect(inc).toContain("IdentitiesOnly=yes");
    expect(inc).toContain("-i '/tmp/id_work'");
    expect(inc).toContain("HostName=github.com");
  });

  it("https profile with sshKeyPath gets both planes", () => {
    const dual: Profile = {
      ...profile,
      protocol: "https",
      sshKeyPath: "/tmp/id_work",
    };
    const inc = renderProfileInclude(dual, "acct");
    expect(inc).toContain('helper = ""');
    expect(inc).toContain("IdentitiesOnly=yes");
  });

  it("quotes ssh key paths with spaces", () => {
    const ssh: Profile = {
      ...profile,
      protocol: "ssh",
      sshKeyPath: "/tmp/my keys/id_work",
    };
    const inc = renderProfileInclude(ssh, "acct");
    expect(inc).toContain("-i '/tmp/my keys/id_work'");
  });

  it("rejects ssh hosts that could inject options", () => {
    const ssh: Profile = {
      ...profile,
      protocol: "ssh",
      host: "github.com -o ProxyCommand=evil",
      sshKeyPath: "/tmp/id_work",
    };
    expect(() => renderProfileInclude(ssh, "acct")).toThrow(/Invalid host/);
  });

  it("strips managed block cleanly", () => {
    const text = `[user]\n\tname = Global\n\n# >>> acct managed begin >>>\nfoo\n# <<< acct managed end <<<\n\n[alias]\n\tst = status\n`;
    const next = stripManagedBlock(text);
    expect(next).not.toContain("acct managed");
    expect(next).toContain("name = Global");
    expect(next).toContain("st = status");
  });

  it("builds includeIf for bindings with global helper reset", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-inc-"));
    try {
      const config: AcctConfig = {
        version: 1,
        defaultEnforce: "strict",
        profiles: [profile],
        bindings: [{ path: "/Users/x/Work", profileId: "work" }],
      };
      const block = buildIncludeIfBlock(config, {
        HOME: "/Users/x",
        ACCT_CONFIG_DIR: tmp,
      });
      expect(block).toContain('helper = ""');
      expect(block).toMatch(/helper = !'/);
      const resetIdx = block.indexOf('helper = ""');
      const includeIdx = block.indexOf("includeIf");
      expect(resetIdx).toBeGreaterThanOrEqual(0);
      expect(includeIdx).toBeGreaterThan(resetIdx);
      expect(block).toContain("/Users/x/Work/");
      expect(block).toContain("work.inc");
      expect(block).not.toContain("osxkeychain");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("credential shim execs process.execPath, not PATH node (I11b)", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-shim-"));
    try {
      const shim = ensureCredentialShim({ ACCT_CONFIG_DIR: tmp });
      const body = fs.readFileSync(shim, "utf8");
      expect(body).toContain(process.execPath);
      expect(body).not.toMatch(/\bexec node\b/);
      expect(body).not.toMatch(/^node /m);
      if (process.platform !== "win32") {
        expect(body).toContain(
          `exec ${posixShellSingleQuote(process.execPath)}`,
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects a bind path whose only illegal character is a double-quote", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-inc-"));
    try {
      const config: AcctConfig = {
        version: 1,
        defaultEnforce: "strict",
        profiles: [profile],
        bindings: [{ path: '/tmp/work"', profileId: "work" }],
      };
      expect(() =>
        buildIncludeIfBlock(config, { HOME: "/tmp", ACCT_CONFIG_DIR: tmp }),
      ).toThrow(/Invalid bind path/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects bind paths that would break out of includeIf quotes", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-inc-"));
    try {
      const config: AcctConfig = {
        version: 1,
        defaultEnforce: "strict",
        profiles: [profile],
        bindings: [
          {
            path: '/tmp/x"]\n[credential]\n\thelper = osxkeychain\n#',
            profileId: "work",
          },
        ],
      };
      expect(() =>
        buildIncludeIfBlock(config, { HOME: "/tmp", ACCT_CONFIG_DIR: tmp }),
      ).toThrow(/Invalid bind path/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("rejects bind paths with gitdir glob metacharacters", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-inc-"));
    try {
      const config: AcctConfig = {
        version: 1,
        defaultEnforce: "strict",
        profiles: [profile],
        bindings: [{ path: "/tmp/work*", profileId: "work" }],
      };
      expect(() =>
        buildIncludeIfBlock(config, { HOME: "/tmp", ACCT_CONFIG_DIR: tmp }),
      ).toThrow(/Invalid bind path/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
