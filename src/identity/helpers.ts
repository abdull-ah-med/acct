import { execFileSync } from "node:child_process";
import { acctHelperValue, profileHosts } from "./includeIf.js";
import { loadConfig } from "../config/store.js";
export interface HelperChain {
  host: string;
  helpers: string[];
  ok: boolean;
}
/** Config order and empty resets matter. URL contexts match the credential protocol.
 * https://git-scm.com/docs/gitcredentials#_credential_contexts
 */
export function effectiveHelperChains(
  cwd: string,
  env: NodeJS.ProcessEnv,
): HelperChain[] {
  let output = "";
  try {
    output = execFileSync(
      "git",
      [
        "config",
        "--null",
        "--show-origin",
        "--get-regexp",
        "^credential\\..*helper$",
      ],
      { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    /* no helpers */
  }
  const fields = output.split("\0"),
    entries: { key: string; value: string }[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const entry = fields[i + 1]!,
      n = entry.indexOf("\n");
    if (n >= 0)
      entries.push({ key: entry.slice(0, n), value: entry.slice(n + 1) });
  }
  return [...new Set(loadConfig(env).profiles.flatMap(profileHosts))].map(
    (host) => {
      let helpers: string[] = [];
      for (const { key, value } of entries) {
        let applies = key === "credential.helper";
        if (!applies) {
          try {
            const u = new URL(
              key.slice("credential.".length, -".helper".length),
            );
            applies =
              u.protocol === "https:" &&
              u.host.toLowerCase() === host &&
              (u.pathname === "/" || u.pathname === "") &&
              !u.username;
          } catch {
            /* unrelated */
          }
        }
        if (applies) {
          if (value === "") helpers = [];
          else helpers.push(value);
        }
      }
      return {
        host,
        helpers,
        ok: helpers.length === 1 && helpers[0] === acctHelperValue(env),
      };
    },
  );
}
