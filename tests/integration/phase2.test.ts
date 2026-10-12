import fs from "node:fs";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {isolated} from "../harness/isolation.js";
let h: ReturnType<typeof isolated>;
beforeEach(() => { h = isolated(); for (const [id, name] of [["a", "Alice # Team"], ["b", "Bob"]]) { const r=h.run(["profile","add","--id",id!,"--user",id!,"--name",name!,"--email",id+"@example.com"]); expect(r.status,r.stderr).toBe(0); } });
afterEach(() => h.close());
function repo(dir: string) { fs.mkdirSync(dir,{recursive:true}); expect(h.git(["init","-q",dir]).status).toBe(0); return dir; }
function bind(dir: string, id="a") { const r=h.run(["bind",dir,id]); expect(r.status,r.stderr).toBe(0); }
function token() { expect(h.run(["profile","token","a","--stdin"],h.root,{},"fake-a").status).toBe(0); }
describe("phase 2 real Git configuration and transport contracts", () => {
  it.each([false,true])("nested bindings agree with real commit (reverse=%s)", reverse => {
    const outer=path.join(h.root,"trees"), inner=repo(path.join(outer,"inner"));
    for(const [dir,id] of reverse?[[inner,"b"],[outer,"a"]]:[[outer,"a"],[inner,"b"]]) bind(dir!,id!);
    expect(h.git(["config","--get","user.name"],inner).stdout.trim()).toBe("Bob");
    expect(h.git(["commit","--allow-empty","-qm","identity"],inner).status).toBe(0);
    expect(h.git(["log","-1","--format=%an <%ae>"],inner).stdout.trim()).toBe("Bob <b@example.com>");
  });
  it("roundtrips quoted profile names and paths through Git", () => {
    const name='  Alice # ; "é" \\ Team  ';
    expect(h.run(["profile","add","--id","quoted","--user","q","--name",name,"--email","a;b@example.com"]).status).toBe(0);
    const dir=repo(path.join(h.root,'trees "quoted"')); bind(dir,"quoted");
    expect(h.git(["config","--get","user.name"],dir).stdout.replace(/\n$/,"")).toBe(name);
    expect(h.git(["config","--get","user.email"],dir).stdout.trim()).toBe("a;b@example.com");
  });
  it("stores one canonical binding for a symlink alias", () => {
    const real=repo(path.join(h.root,"real")), alias=path.join(h.root,"alias"); fs.symlinkSync(real,alias); bind(real); bind(alias,"b");
    const config=fs.readFileSync(path.join(h.root,"acct/config.yaml"),"utf8"); expect(config.match(/profileId:/g)).toHaveLength(1);
    expect(h.run(["status"],real).stdout).toContain("profile: b");
  });
  it("ignores a marker below the repository root and refuses a subdirectory binding", () => {
    const dir=repo(path.join(h.root,"repo")); bind(dir); const sub=path.join(dir,"sub"); fs.mkdirSync(sub); fs.writeFileSync(path.join(sub,".acct"),"profile: b\n");
    const status=h.run(["status"],sub); expect(status.stdout).toContain("profile: a"); expect(status.stdout).toContain("ignored");
    const r=h.run(["bind",sub,"b"]); expect(r.status).toBe(1); expect(r.stderr).toContain("bind the repository root");
  });
  it("local set overrides native Git and clear preserves unrelated includes", () => {
    const dir=repo(path.join(h.root,"repo")); bind(dir); const inc=path.join(h.root,"user.inc"); fs.writeFileSync(inc,"[alias]\n  mine = status\n"); h.git(["config","--local","--add","include.path",inc],dir);
    const set=h.run(["local","set","b"],dir); expect(set.status,set.stderr).toBe(0);
    expect(h.git(["config","--get","user.name"],dir).stdout.trim()).toBe("Bob"); expect(h.run(["status"],dir).stdout).toContain("profile: b");
    expect(h.run(["local","clear"],dir).status).toBe(0); expect(h.git(["config","--get","alias.mine"],dir).stdout.trim()).toBe("status"); expect(h.git(["config","--get","user.name"],dir).stdout.trim()).toBe("Alice # Team");
  });
  it("local unbound blocks inherited acct identity", () => {
    const dir=repo(path.join(h.root,"repo")); bind(dir); expect(h.run(["local","set","--unbound"],dir).status).toBe(0);
    const r=h.run(["hook-run","pre-commit"],dir); expect(r.status).toBe(1); expect(r.stderr).toContain("inherited");
  });
  it("linked worktree conflicts refuse helper, shell, exec and hooks", () => {
    const common=repo(path.join(h.root,"main")); bind(common,"a"); const linked=path.join(h.root,"linked"); fs.mkdirSync(linked); bind(linked,"b");
    const gitdir=path.join(common,".git/worktrees/linked"); fs.mkdirSync(gitdir,{recursive:true}); fs.writeFileSync(path.join(linked,".git"),"gitdir: "+gitdir+"\n"); fs.writeFileSync(path.join(gitdir,"commondir"),"../..\n"); fs.writeFileSync(path.join(gitdir,"gitdir"),path.join(linked,".git")+"\n"); fs.writeFileSync(path.join(gitdir,"HEAD"),"ref: refs/heads/linked\n");
    expect(h.run(["status"],linked).stdout).toContain("cross-profile worktrees");
    expect(h.run(["exec","gh","api","user"],linked).status).toBe(1);
    expect(h.run(["shell-env"],linked).stdout).toContain("acct-blocked-no-token");
    expect(h.run(["hook-run","pre-commit"],linked).status).toBe(1);
    expect(h.git(["credential","fill"],linked,{},"protocol=https\nhost=github.com\n\n").status).not.toBe(0);
  });
  it("unrelated HTTPS helper keeps working inside and outside bindings", () => {
    fs.writeFileSync(h.env.GIT_CONFIG_GLOBAL!,`[credential]\n helper = "!f() { echo username=gitlab; echo password=fake-gitlab; }; f"\n`);
    const dir=repo(path.join(h.root,"repo")); bind(dir); token();
    for(const cwd of [dir,h.root]) { const r=h.git(["credential","fill"],cwd,{},"protocol=https\nhost=gitlab.com\n\n"); expect(r.status,r.stderr).toBe(0); expect(r.stdout).toContain("password=fake-gitlab"); }
  });
  it("gist maps to github.com and generated includes have no unscoped helper", () => {
    const dir=repo(path.join(h.root,"repo")); bind(dir); token();
    const r=h.git(["credential","fill"],dir,{},"protocol=https\nhost=gist.github.com\n\n"); expect(r.status,r.stderr).toBe(0); expect(r.stdout).toContain("password=fake-a");
    expect(h.git(["config","--get-all","credential.helper"],dir).stdout).toBe("");
  });
  it("setup-git cannot rewrite managed include and later helpers are diagnosed", () => {
    fs.writeFileSync(h.env.GIT_CONFIG_GLOBAL!, '[credential "https://github.com"]\n helper = !old\n');
    const dir=repo(path.join(h.root,"repo")); bind(dir); token();
    h.git(["config","--global","--replace-all","credential.https://github.com.helper","!gh auth git-credential"],dir);
    expect(h.git(["credential","fill"],dir,{},"protocol=https\nhost=github.com\n\n").stdout).toContain("password=fake-a");
    expect(h.run(["doctor"],dir).stdout).not.toContain("helper-chain-mismatch");
    fs.appendFileSync(h.env.GIT_CONFIG_GLOBAL!, '[credential "https://github.com"]\n helper = !later\n');
    expect(h.run(["doctor"],dir).stdout).toContain("helper-chain-mismatch");
  });
  it("SSH key does not rewrite remote host", () => {
    const dir=repo(path.join(h.root,"repo")); bind(dir); const key=path.join(h.root,"key"); fs.writeFileSync(key,"fake key"); expect(h.run(["profile","ssh-key","a","--path",key]).status).toBe(0);
    expect(h.git(["config","--get","core.sshCommand"],dir).stdout).not.toContain("HostName");
  });
  it.each([["a",0],["other",1]])("SSH push verifies greeting %s without PAT", (login,code) => {
    const dir=repo(path.join(h.root,"repo")); bind(dir);
    const ssh=path.join(h.fake.binDir,"ssh"); fs.writeFileSync(ssh,`#!/bin/sh\ncase " $* " in *" -G "*) echo hostname github.com;; *) echo "Hi ${login}! You've successfully authenticated" >&2; exit 1;; esac\n`,{mode:0o755});
    const r=h.run(["hook-run","pre-push","origin","git@work-alias:owner/repo.git"],dir,{},""); expect(r.status,r.stderr).toBe(code);
  });
  it("local pushes need no token", () => {
    const dir=repo(path.join(h.root,"repo")); bind(dir); expect(h.run(["hook-run","pre-push","origin",path.join(h.root,"remote.git")],dir,{},"").status).toBe(0);
  });
});
