import fs from "node:fs";
import path from "node:path";
import {canonicalPath} from "./paths.js";
import {lockTimeout,sleepSync} from "./fs-safe.js";
/** Git's own .lock protocol protects the resolved dotfile target.
 * https://git-scm.com/docs/git-config (FILES; write locking)
 */
export function writeGlobalGitconfig(file:string,content:string,env:NodeJS.ProcessEnv):void {
  const target=canonicalPath(file);let stat:fs.Stats|undefined;
  try {stat=fs.statSync(target);if(!stat.isFile())throw new Error("Global gitconfig target is not a regular file");}catch(error){if((error as NodeJS.ErrnoException).code !== "ENOENT")throw error;}
  fs.mkdirSync(path.dirname(target),{recursive:true});const lock=target+".lock",deadline=Date.now()+lockTimeout(env);let delay=10,fd:number;
  for(;;){try{fd=fs.openSync(lock,"wx",stat ? stat.mode&0o777:0o600);break;}catch(error){if((error as NodeJS.ErrnoException).code !== "EEXIST")throw error;if(Date.now()>=deadline)throw new Error("Timed out waiting for Git config lock "+lock);sleepSync(Math.min(delay,Math.max(1,deadline-Date.now())));delay=Math.min(200,delay*2);}}
  let committed=false;
  try {
    fs.writeFileSync(fd,content);if(stat){fs.fchmodSync(fd,stat.mode&0o777);try{fs.fchownSync(fd,stat.uid,stat.gid);}catch{/* owner changes may be forbidden */}}
    fs.fsyncSync(fd);fs.closeSync(fd);fd=-1;fs.renameSync(lock,target);committed=true;
  }finally{if(fd! >= 0)fs.closeSync(fd!);if(!committed)fs.rmSync(lock,{force:true});}
}
