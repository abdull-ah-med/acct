#!/usr/bin/env node
import { runCli } from "../dist/cli/index.js";

runCli(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`acct: ${message}`);
  process.exit(1);
});
