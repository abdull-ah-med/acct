import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  installIncludeIf,
  uninstallIncludeIf,
  removeProfileArtifacts,
  profileIncPath,
  globalGitconfigPath,
} from "../../src/identity/includeIf.js";
import { cmdEscapePath, renderCmdNodeInvoke } from "../../src/util/cmd-escape.js";
import { assertSafeProfileFields } from "../../src/util/profile-fields.js";
import { renderGitCmd } from "../../src/shell/wrap.js";
import { configureHooksPath } from "../../src/cli/index.js";
import type { AcctConfig, Profile } from "../../src/types.js";

const profile: Profile = {
  id: "work",
  githubUser: "work-user",
  host: "github.com",
  name: "Work",
  email: "work@corp.com",
  protocol: "https",
};

describe("installIncludeIf locking / cleanup", () => {
  let tmp: string;
  let prevConfig: string | undefined;
  let prevGit: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-incif-"));
    prevConfig = process.env.ACCT_CONFIG_DIR;
    prevGit = process.env.GIT_CONFIG_GLOBAL;
    process.env.ACCT_CONFIG_DIR = path.join(tmp, "acct");
    process.env.GIT_CONFIG_GLOBAL = path.join(tmp, "gitconfig");
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, "[user]\n\tname = Global\n");
  });

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.ACCT_CONFIG_DIR;
    else process.env.ACCT_CONFIG_DIR = prevConfig;
    if (prevGit === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = prevGit;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("idempotent re-install produces identical managed block", () => {
    const config: AcctConfig = {
      version: 1,
      defaultEnforce: "strict",
      profiles: [profile],
      bindings: [{ path: path.join(tmp, "repo"), profileId: "work" }],
      installed: false,
    };
    installIncludeIf(config);
    const first = fs.readFileSync(globalGitconfigPath(), "utf8");
    installIncludeIf(config);
    const second = fs.readFileSync(globalGitconfigPath(), "utf8");
    expect(second).toBe(first);
    expect(first).toContain("name = Global");
    expect(first).toContain("acct managed");
  });

  it("parallel installIncludeIf calls do not drop user content", async () => {
    const config: AcctConfig = {
      version: 1,
      defaultEnforce: "strict",
      profiles: [profile],
      bindings: [{ path: path.join(tmp, "repo"), profileId: "work" }],
      installed: false,
    };
    await Promise.all([
      Promise.resolve().then(() => installIncludeIf(config)),
      Promise.resolve().then(() => installIncludeIf(config)),
      Promise.resolve().then(() => installIncludeIf(config)),
    ]);
    const text = fs.readFileSync(globalGitconfigPath(), "utf8");
    expect(text).toContain("name = Global");
    const begins = text.split("# >>> acct managed begin >>>").length - 1;
    expect(begins).toBe(1);
  });

  it("uninstallIncludeIf removes orphan .inc files", () => {
    const config: AcctConfig = {
      version: 1,
      defaultEnforce: "strict",
      profiles: [profile],
      bindings: [{ path: path.join(tmp, "repo"), profileId: "work" }],
      installed: false,
    };
    installIncludeIf(config);
    const inc = profileIncPath(profile);
    expect(fs.existsSync(inc)).toBe(true);
    // orphan
    const orphan = path.join(path.dirname(inc), "orphan.inc");
    fs.writeFileSync(orphan, "# orphan\n");
    uninstallIncludeIf();
    expect(fs.existsSync(inc)).toBe(false);
    expect(fs.existsSync(orphan)).toBe(false);
    const gc = fs.readFileSync(globalGitconfigPath(), "utf8");
    expect(gc).not.toContain("acct managed");
    expect(gc).toContain("name = Global");
  });

  it("removeProfileArtifacts deletes inc and ssh keys", () => {
    const configDir = process.env.ACCT_CONFIG_DIR!;
    const gitDir = path.join(configDir, "git");
    const sshDir = path.join(configDir, "ssh");
    fs.mkdirSync(gitDir, { recursive: true });
    fs.mkdirSync(sshDir, { recursive: true });
    const p: Profile = {
      ...profile,
      sshKeyPath: path.join(sshDir, "work"),
    };
    fs.writeFileSync(profileIncPath(p), "inc\n");
    fs.writeFileSync(p.sshKeyPath, "key\n");
    fs.writeFileSync(p.sshKeyPath + ".pub", "pub\n");
    removeProfileArtifacts(p);
    expect(fs.existsSync(profileIncPath(p))).toBe(false);
    expect(fs.existsSync(p.sshKeyPath)).toBe(false);
    expect(fs.existsSync(p.sshKeyPath + ".pub")).toBe(false);
  });
});

describe("cmdEscapePath / Windows .cmd", () => {
  it("escapes % and quotes", () => {
    expect(cmdEscapePath("C:\\Users\\bob&carol\\node.exe")).toBe(
      "C:\\Users\\bob&carol\\node.exe",
    );
    expect(cmdEscapePath("C:\\a%PATH%\\x")).toBe("C:\\a%%PATH%%\\x");
    expect(cmdEscapePath('C:\\a"b\\x')).toBe('C:\\a""b\\x');
  });

  it("renderCmdNodeInvoke quotes paths", () => {
    const body = renderCmdNodeInvoke(
      "C:\\Users\\bob&carol\\node.exe",
      "C:\\prog%files%\\acct.js",
    );
    expect(body).toContain('"C:\\Users\\bob&carol\\node.exe"');
    expect(body).toContain('"C:\\prog%%files%%\\acct.js"');
    expect(body).not.toMatch(/(?<!%)%files%/);
  });
});

describe("profile field validation", () => {
  it("rejects newline / backslash injections", () => {
    expect(() =>
      assertSafeProfileFields({
        name: "Evil\n[credential]",
        email: "a@b.com",
        host: "github.com",
        user: "alice",
      }),
    ).toThrow(/name/);
    expect(() =>
      assertSafeProfileFields({
        name: "Ok",
        email: "a@b.com",
        host: "github.com\nhelper",
        user: "alice",
      }),
    ).toThrow(/host/);
    expect(() =>
      assertSafeProfileFields({
        name: "Ok",
        email: "a\\@b.com",
        host: "github.com",
        user: "alice",
      }),
    ).toThrow(/email/);
  });

  it("accepts valid values", () => {
    expect(() =>
      assertSafeProfileFields({
        name: "Alice Smith",
        email: "alice@example.com",
        host: "github.com",
        user: "alice-smith",
      }),
    ).not.toThrow();
  });
});

describe("renderGitCmd", () => {
  it("skips self directory when resolving real git", () => {
    const body = renderGitCmd();
    expect(body).toContain('set "SELF=%~dp0"');
    expect(body).toContain("findstr");
    expect(body).toContain("where git");
    expect(body).not.toMatch(/set REALGIT=%%i &/);
  });
});

describe("configureHooksPath", () => {
  let repo: string;
  let hooks: string;

  beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), ".tmp-hooks-cfg-"));
    repo = path.join(tmp, "repo");
    hooks = path.join(tmp, "acct-hooks");
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(hooks, { recursive: true });
    execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  });

  afterEach(() => {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  });

  it("refuses existing non-acct core.hooksPath without --force", () => {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      cwd: repo,
      stdio: "ignore",
    });
    expect(() =>
      configureHooksPath(hooks, { bindDir: repo }),
    ).toThrow(/Refusing to overwrite/);
  });

  it("overwrites with --force", () => {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      cwd: repo,
      stdio: "ignore",
    });
    configureHooksPath(hooks, { bindDir: repo, force: true });
    const v = execFileSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    expect(path.resolve(v)).toBe(path.resolve(hooks));
  });

  it("sets hooksPath when unset", () => {
    configureHooksPath(hooks, { bindDir: repo });
    const v = execFileSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    expect(path.resolve(v)).toBe(path.resolve(hooks));
  });

  it("no-ops when already pointing at acct hooks", () => {
    execFileSync("git", ["config", "core.hooksPath", hooks], {
      cwd: repo,
      stdio: "ignore",
    });
    expect(() => configureHooksPath(hooks, { bindDir: repo })).not.toThrow();
  });
});
