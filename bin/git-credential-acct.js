#!/usr/bin/env node
// https://git-scm.com/docs/gitcredentials: an exception must stop later helpers.
import { sanitizeDebugMessage } from "../dist/util/paths.js";
import("../dist/credential/helper.js")
  .then(({ runCredentialHelper }) => runCredentialHelper(process.argv.slice(2)))
  .catch(() => {
    if (process.argv[2] === "get") process.stdout.write("quit=1\n\n");
    console.error(
      sanitizeDebugMessage(
        "git-credential-acct: credential operation failed; run acct doctor",
      ),
    );
    process.exitCode = 1;
  });
