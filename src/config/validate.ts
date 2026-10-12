import type {AcctConfig} from "../types.js";
import {assertValidProfileId} from "../util/profile-id.js";
import {assertSafeProfileFields,assertSafeBindPath} from "../util/profile-fields.js";
import {canonicalPath} from "../util/paths.js";
const modes=["strict","warn","off"];
/** Field paths are safe diagnostics; never echo values from untrusted config. */
export function validateConfig(value:unknown):asserts value is AcctConfig {
  const fail=(field:string,fix="")=>{throw new Error(`Invalid acct config: ${field}${fix ? "; "+fix:""}`);};
  const object=(v:unknown):v is Record<string,unknown>=>!!v && typeof v === "object" && !Array.isArray(v);
  if(!object(value)) return fail("root");
  if(value.version !== 1) fail("version");
  if(!Array.isArray(value.profiles)) fail("profiles");
  if(!Array.isArray(value.bindings)) fail("bindings");
  if(!modes.includes(value.defaultEnforce as string)) fail("defaultEnforce");
  if(typeof value.installed !== "boolean") fail("installed");
  const ids=new Set<string>(),folded=new Set<string>();
  (value.profiles as unknown[]).forEach((p,i)=>{
    const at=`profiles[${i}]`; if(!object(p)) return fail(at);
    for(const key of ["id","githubUser","host","name","email","protocol"]) if(typeof p[key] !== "string") fail(at+"."+key);
    try {assertValidProfileId(p.id as string);}catch{fail(at+".id");}
    const id=p.id as string; if(folded.has(id.toLowerCase())) fail(at+".id (case-fold duplicate)"); folded.add(id.toLowerCase());ids.add(id);
    for(const [key,label] of [["name","name"],["email","email"],["host","host"],["githubUser","user"]]) {
      try {assertSafeProfileFields({name:"Valid",email:"valid@example.com",host:"github.com",user:"valid",[label!]:p[key!] as string});}catch{fail(at+"."+key);}
    }
    if(!["https","ssh"].includes(p.protocol as string)) fail(at+".protocol");
    if(p.enforce !== undefined && !modes.includes(p.enforce as string)) fail(at+".enforce");
    if(p.followGh !== undefined && typeof p.followGh !== "boolean") fail(at+".followGh");
    if(p.sshKeyPath !== undefined && (typeof p.sshKeyPath !== "string" || /[\r\n\0]/.test(p.sshKeyPath))) fail(at+".sshKeyPath");
  });
  const paths=new Set<string>();
  (value.bindings as unknown[]).forEach((b,i)=>{
    const at=`bindings[${i}]`;if(!object(b)) return fail(at);
    if(typeof b.path !== "string") return fail(at+".path");
    try {assertSafeBindPath(b.path);}catch{fail(at+".path");}
    let path=canonicalPath(b.path);if(process.platform === "darwin" || process.platform === "win32") path=path.toLowerCase();
    if(paths.has(path)) fail(at+".path (duplicate)");paths.add(path);
    if(typeof b.profileId !== "string" || !ids.has(b.profileId)) fail(at+".profileId","run acct unbind <path> for this binding or recreate its profile");
    if(b.enforce !== undefined && !modes.includes(b.enforce as string)) fail(at+".enforce");
  });
}
