import fs from "node:fs";
import path from "node:path";
import {CLIENT_HOOKS} from "../enforce/hooks.js";
import {acctConfigDir,hooksDir,loadConfig} from "../config/store.js";
import type {DoctorFinding} from "./run.js";
function words(line:string):string[] {
  const result:string[]=[];let current="",quote="";
  for(let i=0;i<line.length;i++) {const ch=line[i]!;
    if(quote) {if(ch === quote)quote="";else if(ch === "\\" && quote === '"')current+=line[++i] ?? "";else current+=ch;}
    else if(ch === "'" || ch === '"')quote=ch;
    else if(ch === "\\")current+=line[++i] ?? "";
    else if(/\s/.test(ch)){if(current){result.push(current);current="";}}
    else current+=ch;
  }
  if(current)result.push(current);return result;
}
export function checkShims(env:NodeJS.ProcessEnv):DoctorFinding[] {
  if(!loadConfig(env).installed)return [];
  const findings:DoctorFinding[]=[];
  const files=[path.join(acctConfigDir(env),"bin",process.platform === "win32" ? "git-credential-acct.cmd":"git-credential-acct"),...CLIENT_HOOKS.map(h=>path.join(hooksDir(env),h))];
  for(const file of files){
    let body:string;
    try{body=fs.readFileSync(file,"utf8");fs.accessSync(file,fs.constants.X_OK);}catch{findings.push({severity:"error",code:"shim-missing",message:`Missing or non-executable shim: ${file}`,fix:"acct install"});continue;}
    const hook=path.dirname(file) === hooksDir(env);
    if(hook && !body.includes("# acct managed hook v2"))findings.push({severity:"error",code:"hook-version-stale",message:`Stale hook header: ${file}`,fix:"acct install"});
    const line=body.split(/\r?\n/).find(l=>hook ? l.includes(" hook-run ") : /^(exec |")/.test(l));
    if(!line){if(!hook || ["pre-commit","pre-merge-commit","post-commit","pre-push"].includes(path.basename(file)))findings.push({severity:"error",code:"shim-target-missing",message:`Cannot parse executable targets in ${file}`,fix:"acct install"});continue;}
    const argv=words(line.replace(/^exec\s+/,""));
    for(const target of argv.slice(0,2))if(!path.isAbsolute(target) || !fs.existsSync(target) || !fs.statSync(target).isFile())findings.push({severity:"error",code:"shim-target-missing",message:`Shim ${file} references missing target ${target}`,fix:"acct install"});
  }
  return findings;
}
