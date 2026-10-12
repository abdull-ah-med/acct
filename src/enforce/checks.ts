import fs from "node:fs";
import type { EnforceMode, Profile } from "../types.js";
import { resolveFromCwd } from "../resolution/fromCwd.js";
import {parseSshLogin} from "../ssh/keys.js";
import {splitHostPort,hostAllowed} from "../credential/protocol.js";
import {resolveProfileToken} from "../gh/token.js";
import {acctConfigDir,posixShellSingleQuote} from "../util/paths.js";
import { envForProfile, ghApiLogin } from "../gh/env.js";
import { execFileSync, spawnSync } from "node:child_process";
import { pathIsPrefix } from "../util/paths.js";

export interface CheckResult {
  ok: boolean;
  mode: EnforceMode;
  messages: string[];
}

export type GitConfigReader = (key: string, cwd: string) => string;

export function defaultGitConfigReader(key: string, cwd: string): string {
  try {
    return execFileSync("git", ["config", "--get", key], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

/**
 * Working-tree toplevel, or null if cwd is not inside a work tree.
 * Cite: https://git-scm.com/docs/git-rev-parse (`--show-toplevel`)
 */
export function gitShowToplevel(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Whether includeIf `gitdir:binding/` can apply: cwd's work-tree toplevel
 * must be the binding directory or a repo inside it. A parent git repo
 * discovered by walking up does not match that glob.
 * Cite: https://git-scm.com/docs/git-config (Conditional includes gitdir)
 */
export function includeIfGitdirApplies(
  cwd: string,
  bindingPath?: string,
): boolean {
  const toplevel = gitShowToplevel(cwd);
  if (!toplevel) return false;
  if (!bindingPath) return true;
  return pathIsPrefix(bindingPath, toplevel);
}

/**
 * True when `$GIT_DIR/config` sets user.name or user.email (overrides includeIf).
 * Cite: https://git-scm.com/docs/git-config (`--local`; FILES last-wins)
 */
export function hasLocalIdentityOverride(cwd: string): boolean {
  for (const key of ["user.name", "user.email"] as const) {
    try {
      execFileSync("git", ["config", "--local", "--get", key], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return true;
    } catch {
      // unset, or not a git repo
    }
  }
  return false;
}

export async function checkCommitIdentity(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  _readConfig: GitConfigReader = defaultGitConfigReader,
): Promise<CheckResult> {
  const resolved = resolveFromCwd(cwd, env);
  const messages: string[] = [];
  if (!resolved.profile) {
    if(resolved.conflict) messages.push(resolved.conflict.detail);
    try {
      const origin=execFileSync("git",["config","--show-origin","--get","user.email"],{cwd,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).split("\t")[0] ?? "";
      if(origin.startsWith("file:") && pathIsPrefix(acctConfigDir(env)+"/git",origin.slice(5))) messages.push("Unbound repository inherited acct identity; set a repo-local user.email or run acct local set <id>.");
    } catch { /* no effective email */ }
    return {ok:resolved.enforce !== "strict" || messages.length === 0,mode:resolved.enforce,messages};
  }
  if (resolved.enforce === "off") {
    return { ok: true, mode: resolved.enforce, messages };
  }

  const profile = resolved.profile;
  // https://git-scm.com/docs/git-var: effective identities include environment overrides.
  const ident = (kind: string) => {
    try {
      const value = execFileSync("git", ["var", `GIT_${kind}_IDENT`], {cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
      const match = /^(.*) <([^>]*)> \d+ [+-]\d+/.exec(value);
      return match ? {name: match[1]!, email: match[2]!} : null;
    } catch { return null; }
  };
  const author = ident("AUTHOR"), committer = ident("COMMITTER");
  const matches = (id: ReturnType<typeof ident>) => id && id.name === profile.name && id.email.toLowerCase() === profile.email.toLowerCase();
  if (!matches(committer)) messages.push(`Commit committer must be ${profile.name} <${profile.email}> for profile ${profile.id}. Run: acct local set ${profile.id} or acct bind`);
  if (!matches(author) && !(matches(committer) && authorPreservingOperation(cwd, env))) messages.push(`Commit author must be ${profile.name} <${profile.email}> for profile ${profile.id}. Run: acct local set ${profile.id} or acct bind`);

  const ok = messages.length === 0;
  if (!ok && resolved.enforce === "warn") {
    for (const m of messages) console.error(`acct warn: ${m}`);
    return { ok: true, mode: resolved.enforce, messages };
  }
  return { ok, mode: resolved.enforce, messages };
}

/** Check the authentication transport Git will use, not an unrelated credential.
 * https://git-scm.com/docs/git#Documentation/git.txt-GITSSHCOMMAND
 * https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresshCommand
 */
export async function checkPushAuth(cwd=process.cwd(),env:NodeJS.ProcessEnv=process.env,readConfig:GitConfigReader=defaultGitConfigReader,url?:string):Promise<CheckResult> {
  const resolved=resolveFromCwd(cwd,env), identity=await checkCommitIdentity(cwd,env,readConfig);
  if(!resolved.profile || resolved.enforce === "off") return identity;
  const p=resolved.profile, messages=[...identity.messages];
  if(!url) { try {url=execFileSync("git",["remote","get-url","--push","origin"],{cwd,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();} catch {url="";} }
  let alias:string|null=null,httpsHost:string|null=null;
  try { const u=new URL(url); if(u.protocol === "https:") httpsHost=u.host; else if(u.protocol === "ssh:") alias=u.hostname; }
  catch { alias=/^(?:[^@/:]+@)?([^/:]+):.+/.exec(url)?.[1] ?? null; if(/^[A-Za-z]:[\\/]/.test(url)) alias=null; }
  if(httpsHost) {
    if(!hostAllowed(httpsHost,p.host)) console.error(`acct note: unmanaged HTTPS host ${httpsHost} — auth check skipped`);
    else {
      const token=await resolveProfileToken(p,env,{allowNetwork:true,persist:false});
      const login=token ? ghApiLogin(await envForProfile(p,env,resolved.enforce)) : null;
      if(!login) messages.push(`Could not verify GitHub auth for profile "${p.id}". Run: acct profile token ${p.id}`);
      else if(login.toLowerCase() !== p.githubUser.toLowerCase()) messages.push(`Authenticated as "${login}" but profile "${p.id}" expects "${p.githubUser}".`);
    }
  } else if(alias) {
    if(!/^[A-Za-z0-9.-]+$/.test(alias) || alias.startsWith("-")) messages.push("Unsafe SSH alias");
    else {
      const effective=env.GIT_SSH_COMMAND || readGitSsh(cwd,env) || (env.GIT_SSH ? posixShellSingleQuote(env.GIT_SSH) : "ssh");
      const run=(args:string[]) => spawnSync(process.platform === "win32" ? "cmd.exe" : "/bin/sh",process.platform === "win32" ? ["/c",effective+" "+args.map(posixShellSingleQuote).join(" ")] : ["-c",effective+' "$@"',"acct-ssh",...args],{cwd,env,encoding:"utf8",timeout:15000});
      const config=run(["-G",alias]);
      const hostname=/^hostname\s+(\S+)/im.exec(config.stdout??"")?.[1];
      if(!hostname) messages.push(`Could not resolve SSH alias ${alias}`);
      else if(hostname.toLowerCase() !== splitHostPort(p.host).hostname.toLowerCase()) console.error(`acct note: unmanaged SSH host ${hostname} — auth check skipped`);
      else {
        const result=run(["-T","-o","BatchMode=yes","-o","ConnectTimeout=10",`git@${alias}`]);
        const login=parseSshLogin((result.stdout??"")+(result.stderr??""));
        if(login?.toLowerCase() !== p.githubUser.toLowerCase()) messages.push(`SSH authenticated account: expected=${p.githubUser} actual=${login ?? "unknown"}`);
      }
    }
  }
  if(messages.length && resolved.enforce === "warn") for(const message of messages) console.error("acct warn: "+message);
  return {ok:resolved.enforce === "warn" || messages.length === 0,mode:resolved.enforce,messages};
}
function readGitSsh(cwd:string,env:NodeJS.ProcessEnv):string {try {return execFileSync("git",["config","--get","core.sshCommand"],{cwd,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();}catch{return "";}}

export function formatBlockMessage(
  kind: "commit" | "push",
  profile: Profile | null,
  messages: string[],
): string {
  const header =
    kind === "commit"
      ? "acct blocked commit (strict identity mismatch)"
      : "acct blocked push (strict auth/identity mismatch)";
  const lines = [header, ...messages.map((m) => `  - ${m}`)];
  if (profile) {
    lines.push(
      "  Note: git --no-verify / -c core.hooksPath=… bypass client hooks (githooks); use server-side rules for non-bypassable policy",
    );
  }
  return lines.join("\n");
}

/** https://git-scm.com/docs/git-rev-parse (--git-path resolves linked-worktree state). */
export function authorPreservingOperation(cwd: string, env: NodeJS.ProcessEnv): boolean {
  if (/^(cherry-pick|rebase|revert|am|merge)(?:[ :(-]|$)/i.test(env.GIT_REFLOG_ACTION ?? "")) return true;
  return ["CHERRY_PICK_HEAD", "REVERT_HEAD", "MERGE_HEAD", "rebase-merge", "rebase-apply"].some(state => {
    try {
      const file = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-path", state], {cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
      return fs.existsSync(file);
    } catch { return false; }
  });
}
/** Inspect the commit object, not the configuration used for a future commit.
 * https://git-scm.com/docs/git-log#_pretty_formats
 */
export async function checkRecordedCommit(cwd: string, env: NodeJS.ProcessEnv, sha = "HEAD"): Promise<CheckResult> {
  const resolved = resolveFromCwd(cwd, env);
  if (!resolved.profile || resolved.enforce === "off") return {ok: true, mode: resolved.enforce, messages: []};
  const p = resolved.profile;
  const messages: string[] = [];
  try {
    const fields = execFileSync("git", ["log", "-1", "--format=%an%x00%ae%x00%cn%x00%ce", sha], {cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trimEnd().split("\0");
    const matches = (name: string | undefined, email: string | undefined) => name === p.name && email?.toLowerCase() === p.email.toLowerCase();
    const committer = matches(fields[2], fields[3]);
    if (!committer) messages.push(`Commit ${sha} committer ${fields[2]} <${fields[3]}> differs from ${p.name} <${p.email}>.`);
    let preserved = authorPreservingOperation(cwd, env);
    if (!preserved && committer) {
      // Reflog records locally performed author-preserving operations.
      // https://git-scm.com/docs/git-reflog ; no provenance is stored in commit objects.
      const object = execFileSync("git", ["rev-parse", sha], {cwd, env, encoding: "utf8"}).trim();
      const reflog = execFileSync("git", ["reflog", "show", "--all", "--format=%H%x00%gs"], {cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
      preserved = reflog.split("\n").some(line => line.startsWith(object + "\0") && /^(cherry-pick|rebase|revert|am|merge)(?:[ :(-]|$)/i.test(line.split("\0")[1] ?? ""));
    }
    if (!matches(fields[0], fields[1]) && !(committer && preserved)) messages.push(`Commit ${sha} author ${fields[0]} <${fields[1]}> differs from ${p.name} <${p.email}>.`);
  } catch { messages.push(`Could not inspect commit ${sha}.`); }
  return {ok: resolved.enforce === "warn" || messages.length === 0, mode: resolved.enforce, messages};
}
export async function checkOutgoingCommits(cwd: string, env: NodeJS.ProcessEnv, remote: string, input: string): Promise<CheckResult> {
  const resolved = resolveFromCwd(cwd, env), messages: string[] = [];
  for (const line of input.trim().split("\n").filter(Boolean)) {
    const [, local, , old] = line.split(/\s+/);
    if (!local || !old || !/^[a-f0-9]{40,64}$/i.test(local) || !/^[a-f0-9]{40,64}$/i.test(old)) { messages.push("Invalid pre-push ref input"); continue; }
    if (/^0+$/.test(local)) continue;
    try {
      let known = false;
      if (!/^0+$/.test(old)) { try { execFileSync("git", ["cat-file", "-e", old + "^{commit}"], {cwd, env, stdio: "ignore"}); known = true; } catch { /* not fetched */ } }
      const range = known ? [old + ".." + local] : [local, "--not", "--remotes=" + remote];
      const commits = execFileSync("git", ["rev-list", ...range], {cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim().split("\n").filter(Boolean);
      for (const commit of commits) messages.push(...(await checkRecordedCommit(cwd, env, commit)).messages);
    } catch { messages.push("Could not list outgoing commits"); }
  }
  return {ok: resolved.enforce !== "strict" || messages.length === 0, mode: resolved.enforce, messages};
}
