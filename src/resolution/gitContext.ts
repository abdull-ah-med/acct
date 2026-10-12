import { execFileSync } from "node:child_process";
import { canonicalPath } from "../util/paths.js";
export interface GitContext {
  workTree: string | null;
  gitDir: string;
  commonDir: string;
  isLinkedWorktree: boolean;
}
/** https://git-scm.com/docs/git-rev-parse: --show-toplevel fails for bare repos. Preserve Git's environment. */
export function resolveGitContext(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): GitContext | null {
  const run = (args: string[]) =>
    execFileSync("git", ["rev-parse", "--path-format=absolute", ...args], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trimEnd()
      .split("\n");
  let workTree: string | null, gitDir: string, commonDir: string;
  try {
    [workTree, gitDir, commonDir] = run([
      "--show-toplevel",
      "--absolute-git-dir",
      "--git-common-dir",
    ]) as [string, string, string];
  } catch {
    try {
      const [bare, dir, common] = run([
        "--is-bare-repository",
        "--absolute-git-dir",
        "--git-common-dir",
      ]);
      if (bare !== "true" || !dir || !common) return null;
      workTree = null;
      gitDir = dir;
      commonDir = common;
    } catch {
      return null;
    }
  }
  if (!gitDir || !commonDir) return null;
  gitDir = canonicalPath(gitDir);
  commonDir = canonicalPath(commonDir);
  return {
    workTree: workTree ? canonicalPath(workTree) : null,
    gitDir,
    commonDir,
    isLinkedWorktree: gitDir !== commonDir,
  };
}
