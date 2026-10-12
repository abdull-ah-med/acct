import {failAt} from "../util/transaction.js";
import fs from "node:fs";
import path from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {resolveGitContext} from "../resolution/gitContext.js";
import {loadConfig,readLocalAcct} from "../config/store.js";
import {profileIncPath,writeProfileInclude} from "./includeIf.js";
function context(cwd:string,env:NodeJS.ProcessEnv) { const ctx=resolveGitContext(cwd,env); if(!ctx?.workTree) throw new Error("acct local requires a Git work tree"); return ctx; }
function git(cwd:string,env:NodeJS.ProcessEnv,args:string[]) {return execFileSync("git",["config","--local",...args],{cwd,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});}
function removeOwned(cwd:string,env:NodeJS.ProcessEnv) {
  let id="";
  try {id=git(cwd,env,["--get","acct.localProfile"]).trim();} catch {return;}
  if(id) {
    const include=profileIncPath({id} as import("../types.js").Profile,env);
    spawnSync("git",["config","--local","--fixed-value","--unset-all","include.path",include],{cwd,env,stdio:"ignore"});
  }
  spawnSync("git",["config","--local","--unset-all","acct.localProfile"],{cwd,env,stdio:"ignore"});
}
export function localSet(cwd:string,id:string|undefined,unbound:boolean,env:NodeJS.ProcessEnv) {
  const ctx=context(cwd,env), config=loadConfig(env), p=config.profiles.find(p=>p.id===id);
  if(!unbound && !p) throw new Error("Unknown or missing profile; use acct local set <id> or --unbound");
  removeOwned(cwd,env);
  if(p && !unbound) {
    const include=writeProfileInclude(p,env);
    // https://git-scm.com/docs/git-config: preserve unrelated includes while replacing the owned value.
    git(cwd,env,["--fixed-value","--replace-all","include.path",include,include]);
  }
  git(cwd,env,["--replace-all","acct.localProfile",unbound?"":p!.id]);
  fs.writeFileSync(path.join(ctx.workTree!,".acct"),unbound ? "" : `# acct managed marker\nprofile: ${p!.id}\n`);
  failAt("local",env);
}
export function localClear(cwd:string,env:NodeJS.ProcessEnv) {
  const ctx=context(cwd,env); removeOwned(cwd,env);
  if(readLocalAcct(ctx.workTree!) != null) fs.rmSync(path.join(ctx.workTree!,".acct"));
}
