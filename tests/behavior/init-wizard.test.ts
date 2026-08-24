import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ensureDistBuild, installFakeGh, tmpRoot } from "../harness/fake-gh.js";
import { acct } from "../harness/workspace.js";

describe("acct init wizard at the CLI seam", () => {
  beforeAll(() => {
    ensureDistBuild();
  });

  it("scripted answers create the profile and bind cwd", () => {
    const root = tmpRoot("acct-init-");
    const configDir = path.join(root, "config");
    const workDir = path.join(root, "work");
    fs.mkdirSync(workDir, { recursive: true });
    const gitconfig = path.join(root, "empty.gitconfig");
    fs.writeFileSync(gitconfig, "");
    const gh = installFakeGh(root, {
      tokens: { "github.com::user-a": "gho_TEST_ONLY_init" },
      apiUser: "user-a",
      activeUser: "user-a",
    });
    const env = gh.env({
      ACCT_CONFIG_DIR: configDir,
      ACCT_SECRET_BACKEND: "file",
      ACCT_FOLLOW_GH: "1",
      GIT_CONFIG_GLOBAL: gitconfig,
      GIT_CONFIG_NOSYSTEM: "1",
    });
    try {
      const r = acct(["init"], env, workDir, {
        input: ["n", "work", "user-a", "user-a@example.com", "User A", "y"].join(
          "\n",
        ) + "\n",
      });
      const out = `${r.stdout}\n${r.stderr}`;
      expect(r.status, out).toBe(0);
      expect(out).toContain("id: work");
      expect(out).toContain("GitHub username: user-a");
      expect(out).toContain("email: user-a@example.com");
      expect(out).toContain("name: User A");
      expect(out).toContain('Initialized profile "work"');

      const cfg = YAML.parse(
        fs.readFileSync(path.join(configDir, "config.yaml"), "utf8"),
      ) as {
        profiles: Array<{
          id: string;
          githubUser: string;
          email: string;
          name: string;
        }>;
        bindings: Array<{ path: string; profileId: string }>;
      };
      expect(cfg.profiles).toEqual([
        expect.objectContaining({
          id: "work",
          githubUser: "user-a",
          email: "user-a@example.com",
          name: "User A",
        }),
      ]);
      expect(cfg.bindings).toEqual([
        expect.objectContaining({
          profileId: "work",
        }),
      ]);
      expect(cfg.bindings[0]?.path.replace(/\\/g, "/")).toContain("work");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
