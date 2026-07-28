import fs from "node:fs";
import path from "node:path";
import { hooksDir } from "../config/store.js";

const PRE_COMMIT = `#!/bin/sh
# acct managed pre-commit
acct hook-run pre-commit || exit $?
`;

const PRE_PUSH = `#!/bin/sh
# acct managed pre-push
acct hook-run pre-push || exit $?
`;

export function installHooks(env: NodeJS.ProcessEnv = process.env): string {
  const dir = hooksDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const preCommit = path.join(dir, "pre-commit");
  const prePush = path.join(dir, "pre-push");
  fs.writeFileSync(preCommit, PRE_COMMIT, { mode: 0o755 });
  fs.writeFileSync(prePush, PRE_PUSH, { mode: 0o755 });
  return dir;
}
