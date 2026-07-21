#!/usr/bin/env node
import { runCredentialHelper } from "../dist/credential/helper.js";

runCredentialHelper(process.argv.slice(2)).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`git-credential-acct: ${message}`);
  process.exit(1);
});
