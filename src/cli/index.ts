import {shellHookWarning} from "../status/runtime.js";
import {beginConfigMutation,updateConfig} from "../config/mutation.js";
import {failAt} from "../util/transaction.js";
import {readGhAuthToken} from "../gh/token.js";
import {effectiveHelperChains} from "../identity/helpers.js";
import { Command } from "commander";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  upsertProfile,
  removeProfile,
  upsertBinding,
  removeBinding,
  assertNoSecretsInConfig,
  findProfileById,
} from "../config/store.js";
import type { EnforceMode, Profile, Protocol } from "../types.js";
import { resolveFromCwd } from "../resolution/fromCwd.js";
import {resolveGitContext} from "../resolution/gitContext.js";
import {localSet, localClear} from "../identity/local.js";
import { normalizePath,pathIsPrefix } from "../util/paths.js";
import {
  assertValidProfileId,
  assertNoProfileIdCaseCollision,
} from "../util/profile-id.js";
import { assertSafeProfileFields, assertSafeBindPath } from "../util/profile-fields.js";
import {
  uninstallIncludeIf,
  restoreGitconfigBackup,
  removeProfileArtifacts,
} from "../identity/includeIf.js";
import { setProfileToken, deleteProfileToken, assertValidToken, accountKey } from "../secrets/store.js";
import { envForProfile, isDangerousGhArgv, ghApiLogin, ghActiveLogin, stripGitConfigEnvOverrides } from "../gh/env.js";
import { generateSshKey, readPublicKey, testSshAuth } from "../ssh/keys.js";
import {
  checkCommitIdentity,
  checkRecordedCommit,
  checkOutgoingCommits,
  checkPushAuth,
  formatBlockMessage,
  defaultGitConfigReader,
} from "../enforce/checks.js";
import { installHooks } from "../enforce/hooks.js";
import { hookScript, shellEnvExports, type ShellKind } from "../shell/hooks.js";
import { formatWelcomeBanner } from "./banner.js";
import {
  collectInitPlan,
  createStdioWizardIO,
  type InitPlan,
} from "./wizard.js";
import { buildShellEnvExports } from "../shell/env.js";
import { installWrapShims, wrapPathExport } from "../shell/wrap.js";
import { resolveRealGh, withoutWrapPath } from "../gh/real.js";
import { commandBasename, stripWrapperArgv } from "../gh/env.js";
import { runDoctor } from "../doctor/run.js";
import {
  diagnose,
  diagnoseHasErrors,
  formatDiagnoseReport,
} from "../status/explain.js";
import { diagnoseCwd, collectDiagnoseInput } from "../status/collect.js";

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require("../../package.json") as {
  version: string;
};

/** Preserve an existing hooks directory as the chain target.
 * https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath
 */
export function configureHooksPath(hooks:string,opts:{global?:boolean;repo?:boolean;force?:boolean;bindDir?:string}={}):void {
  const global=opts.global === true || (!opts.repo && opts.global !== false && !opts.bindDir);
  const cwd=opts.bindDir ?? process.cwd(),scope=global ? "--global":"--local";
  const git=(args:string[])=>execFileSync("git",["config",scope,...args],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  let existing="";try{existing=git(["--get","core.hooksPath"]).trimEnd();}catch{/* unset */}
  if(existing && normalizePath(path.resolve(cwd,existing)) !== normalizePath(hooks)) git(["--replace-all","acct.chainHooksPath",existing]);
  git(["--replace-all","core.hooksPath",hooks]);failAt("hook-config");
  console.log(`core.hooksPath=${hooks} (${global ? "global":"local repo"})`);
}
export function unsetAcctHooksPath(opts:{global?:boolean;bindDir?:string}={}):void {
  const cwd=opts.bindDir ?? process.cwd();if(!fs.existsSync(cwd))return;
  const scope=opts.global ? "--global":"--local";
  const git=(args:string[])=>execFileSync("git",["config",scope,...args],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  let existing="",chain="";try{existing=git(["--get","core.hooksPath"]).trimEnd();}catch{return;}
  const target=path.resolve(cwd,existing);
  let owned=false;try{owned=fs.readFileSync(path.join(target,"pre-commit"),"utf8").includes("# acct managed hook v2");}catch{/* not owned */}
  if(!owned)return;
  try{chain=git(["--get","acct.chainHooksPath"]).trimEnd();}catch{/* default repo hooks */}
  if(chain)git(["--replace-all","core.hooksPath",chain]);else git(["--unset-all","core.hooksPath"]);
  try{git(["--unset-all","acct.chainHooksPath"]);}catch{/* no record */}
}
function preflightToken(profile:Profile):string {
  const token=readGhAuthToken(profile);if(!token)throw new Error(`No gh token for ${profile.id}; run gh auth login or use acct profile token --stdin`);assertValidToken(token);return token;
}

async function performInit(plan: InitPlan): Promise<void> {
  assertValidProfileId(plan.id);
  assertSafeProfileFields({
    name: plan.name,
    email: plan.email,
    host: plan.host,
    user: plan.githubUser,
  });
  const bindPath = path.resolve(plan.bind);
  assertSafeBindPath(bindPath);
  const ctx=fs.existsSync(bindPath) ? resolveGitContext(bindPath,process.env) : null;
  if(ctx?.workTree && normalizePath(bindPath) !== ctx.workTree) throw new Error("bind the repository root or a directory containing repositories; includeIf cannot apply to a subdirectory of a repository");

  let config = loadConfig();
  assertNoProfileIdCaseCollision(config.profiles, plan.id);
  const profile: Profile = {
    id: plan.id,
    githubUser: plan.githubUser,
    host: plan.host,
    name: plan.name,
    email: plan.email,
    protocol: plan.protocol,
    enforce: "strict",
  };
  config = upsertProfile(config, profile);
  config = upsertBinding(config, {
    path: bindPath,
    profileId: profile.id,
  });
  assertNoSecretsInConfig(config);
  const token=plan.importGh ? preflightToken(profile):null;
  config.installed=true;
  updateConfig(process.env, () => config);
  const hooks = installHooks();
  try {
    configureHooksPath(hooks, {
      bindDir: bindPath,
      global: true,
      force: !!plan.force,
    });
  } catch (e) {
    console.warn(`Could not set core.hooksPath: ${e}`);
    throw e;
  }
  if(token)await setProfileToken(profile,token);
  console.log(
    `Initialized profile "${profile.id}" bound to ${normalizePath(plan.bind)}`,
  );
  console.log(
    'Add shell hook: eval "$(acct hook zsh)"  # or bash/fish/powershell',
  );
}

async function runWizardAndInit(cwd: string,seed?:Partial<InitPlan>): Promise<void> {
  const io = createStdioWizardIO();
  try {
    const plan = await collectInitPlan(io, {
      cwd,
      seed,
      current: {
        name: defaultGitConfigReader("user.name", cwd),
        email: defaultGitConfigReader("user.email", cwd),
        githubUser: ghActiveLogin("github.com"),
      },
    });
    if (!plan) {
      process.exitCode = 1;
      return;
    }
    await performInit(plan);
  } finally {
    io.close();
  }
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program.enablePositionalOptions();
  let mutation:ReturnType<typeof beginConfigMutation>|undefined;
  program.hook("preAction",(_root,action)=>{
    const mutating=["init","bind","unbind","rebind","install","uninstall","enforce"].includes(action.name()) || action.parent?.name() === "local" || (action.parent?.name() === "profile" && ["add","remove","token","ssh-key"].includes(action.name())) || (action === program && process.stdin.isTTY);
    if(mutating)mutation=beginConfigMutation(process.cwd(),process.env,action.args.filter((a):a is string=>typeof a === "string").map(a=>path.resolve(a)), action.name() === "unbind" ? path.resolve(String(action.args[0])) : undefined);
  });
  program.hook("postAction", (_root, action) => {
    if (["bind", "unbind", "rebind"].includes(action.name()) || (action.parent?.name() === "profile" && ["add", "remove", "token", "ssh-key"].includes(action.name())) || action.parent?.name() === "local") console.error("note: open shells keep their current acct env until you cd or run acct_refresh");
  });
  program
    .name("acct")
    .description(
      "Directory-scoped GitHub identity and auth — one account, one identity, one directory",
    )
    .version(CLI_VERSION);

  // Bare `acct` in a TTY starts the setup wizard. Non-TTY keeps the tip sheet
  // so scripts/CI do not hang on prompts.
  program.action(async () => {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await runWizardAndInit(process.cwd());
      return;
    }
    console.log(formatWelcomeBanner());
    console.log("  Run acct --help for all commands.\n");
  });

  program
    .command("init")
    .description("Create a profile and bind a directory (interactive if flags omitted)")
    .option("--id <id>", "Profile id (e.g. work)")
    .option("--user <githubUser>", "GitHub username")
    .option("--email <email>", "Commit email")
    .option("--name <name>", "Commit name")
    .option("--host <host>", "GitHub host", "github.com")
    .option("--protocol <protocol>", "https|ssh", "https")
    .option("--bind <dir>", "Directory to bind", process.cwd())
    .option("--import-gh", "Import token via gh auth token --user")
    .option(
      "--global-hooks",
      "Accepted alias for the default global chaining hooks",
    )
    .option(
      "--force",
      "Overwrite an existing non-acct core.hooksPath in the bind/target repo",
    )
    .action(async (opts) => {
      if (!(opts.id && opts.user && opts.email && opts.name)) {
        await runWizardAndInit(path.resolve(String(opts.bind || process.cwd())),{id:opts.id,githubUser:opts.user,email:opts.email,name:opts.name,host:opts.host,protocol:opts.protocol,bind:opts.bind,force:opts.force,...(opts.importGh ? {importGh:true}:{})});
        return;
      }
      await performInit({
        id: opts.id,
        githubUser: opts.user,
        email: opts.email,
        name: opts.name,
        host: opts.host,
        protocol: opts.protocol as Protocol,
        bind: opts.bind,
        importGh: !!opts.importGh,
        globalHooks: !!opts.globalHooks,
        force: !!opts.force,
      });
    });

  const profileCmd = program.command("profile").description("Manage profiles");

  profileCmd
    .command("add")
    .description("Create a profile")
    .requiredOption("--id <id>")
    .requiredOption("--user <githubUser>")
    .requiredOption("--email <email>")
    .requiredOption("--name <name>")
    .option("--host <host>", "github.com")
    .option("--protocol <protocol>", "https")
    .option("--import-gh", "Import token via gh auth token --user")
    .action(async (opts) => {
      assertValidProfileId(opts.id);
      assertSafeProfileFields({
        name: opts.name,
        email: opts.email,
        host: opts.host || "github.com",
        user: opts.user,
      });
      let config = loadConfig();
      // Case-fold uniqueness: work vs WORK share git/work.inc on macOS/Windows.
      // Cite: https://git-scm.com/docs/git-config (gitdir/i, core.ignoreCase)
      // Cite: docs/research/i18-profile-case-round3-cites-2026-08-08.md
      assertNoProfileIdCaseCollision(config.profiles, opts.id);
      const profile: Profile = {
        id: opts.id,
        githubUser: opts.user,
        host: opts.host || "github.com",
        name: opts.name,
        email: opts.email,
        protocol: (opts.protocol || "https") as Protocol,
        enforce: "strict",
      };
      const token=opts.importGh ? preflightToken(profile):null;
      config = upsertProfile(config, profile);
      assertNoSecretsInConfig(config);
      updateConfig(process.env, () => config);
      if(token) await setProfileToken(profile,token);
      console.log(`Added profile ${profile.id}`);
    });

  profileCmd
    .command("list")
    .description("List profiles")
    .action(() => {
      const config = loadConfig();
      for (const p of config.profiles) {
        console.log(
          `${p.id}\t${p.githubUser}@${p.host}\t${p.email}\t${p.protocol}`,
        );
      }
    });

  profileCmd
    .command("show")
    .description("Show one profile as JSON")
    .argument("<id>")
    .action((id) => {
      const config = loadConfig();
      const p = findProfileById(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      console.log(JSON.stringify(p, null, 2));
    });

  profileCmd
    .command("remove")
    .description("Remove a profile and its stored token")
    .argument("<id>")
    .action(async (id) => {
      let config = loadConfig();
      const p = findProfileById(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      const remaining = config.profiles.filter(other => other.id !== p.id);
      removeProfileArtifacts(p, process.env, remaining);
      config = removeProfile(config, id);
      updateConfig(process.env, () => config);
      if (!remaining.some(other => accountKey(other) === accountKey(p))) await deleteProfileToken(p);
      console.log(`Removed profile ${id}`);
    });

  profileCmd
    .command("token")
    .description("Store a token in the OS keychain")
    .argument("<id>")
    .option("--import-gh", "Import from gh auth token --user (and keep following gh)")
    .option("--stdin", "Read token from stdin")
    .action(async (id, opts) => {
      let config = loadConfig();
      const p = findProfileById(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      if (opts.importGh) {
        const token=preflightToken(p);
        p.followGh = true;
        config = upsertProfile(config, p);
        updateConfig(process.env, () => config);
        await setProfileToken(p,token);
        console.log("Token imported into OS keychain (follows gh auth token --user)");
        return;
      }
      if (opts.stdin) {
        const chunks: Buffer[] = [];
        for await (const c of process.stdin) {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        }
        const token=Buffer.concat(chunks).toString("utf8").replace(/\n$/, "");
        assertValidToken(token);
        p.followGh = false;
        config = upsertProfile(config, p);
        updateConfig(process.env, () => config);
        await setProfileToken(p,token);
        console.log("Token stored in OS keychain (follow-gh off — will not overwrite from gh)");
        return;
      }
      throw new Error("Specify --import-gh or --stdin");
    });

  profileCmd
    .command("ssh-key")
    .description("Generate or attach an SSH key for a profile")
    .argument("<id>")
    .option("--generate", "Generate ed25519 key")
    .option("--path <path>", "Attach existing private key")
    .option(
      "--protocol <protocol>",
      "Set preferred protocol https|ssh (default: leave unchanged; generate defaults to ssh)",
    )
    .action((id, opts) => {
      let config = loadConfig();
      const p = findProfileById(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      if (opts.generate) {
        const { privateKey, publicKey } = generateSshKey(p);
        p.sshKeyPath = privateKey;
        // Dual plane: keep HTTPS helper unless user forces --protocol ssh
        if (opts.protocol === "https" || opts.protocol === "ssh") {
          p.protocol = opts.protocol as Protocol;
        } else {
          p.protocol = "ssh";
        }
        config = upsertProfile(config, p);
        updateConfig(process.env, () => config);
        console.log(`Generated ${privateKey}`);
        console.log(`Public key:\n${readPublicKey(privateKey)}`);
        console.log(`(also at ${publicKey})`);
        console.log(
          "Note: HTTPS credential helper remains installed (I8b). Use --protocol to prefer clone style.",
        );
        return;
      }
      if (opts.path) {
        p.sshKeyPath = path.resolve(opts.path);
        // Do not drop HTTPS isolation — only change protocol if explicitly requested
        if (opts.protocol === "https" || opts.protocol === "ssh") {
          p.protocol = opts.protocol as Protocol;
        }
        config = upsertProfile(config, p);
        updateConfig(process.env, () => config);
        console.log(`Attached ${p.sshKeyPath}`);
        return;
      }
      throw new Error("Specify --generate or --path");
    });

  program
    .command("bind")
    .description("Bind a directory tree to a profile")
    .argument("<dir>", "Directory to bind (absolute or relative)")
    .argument("<profileId>", "Existing profile id")
    .option("--enforce <mode>", "strict|warn|off")
    .action((dir, profileId, opts) => {
      let config = loadConfig();
      if (!findProfileById(config, profileId)) {
        throw new Error(`Unknown profile: ${profileId}`);
      }
      const bindPath = path.resolve(dir);
      assertSafeBindPath(bindPath);
      const ctx=fs.existsSync(bindPath) ? resolveGitContext(bindPath,process.env) : null;
      if(ctx?.workTree && normalizePath(bindPath) !== ctx.workTree) throw new Error("bind the repository root or a directory containing repositories; includeIf cannot apply to a subdirectory of a repository");
      config = upsertBinding(config, {
        path: bindPath,
        profileId,
        enforce: opts.enforce as EnforceMode | undefined,
      });
      updateConfig(process.env, () => config);
      console.log(`Bound ${normalizePath(dir)} → ${profileId}`);
    });

  program
    .command("unbind")
    .description("Remove a directory → profile binding")
    .argument("<dir>", "Directory previously passed to bind")
    .action((dir) => {
      let config = loadConfig(process.env, path.resolve(dir));
      config = removeBinding(config, path.resolve(dir));
      updateConfig(process.env, () => config);
      console.log(`Unbound ${normalizePath(dir)}`);
    });

  program
    .command("status")
    .description("Show profile resolution for cwd")
    .option(
      "--profile <id>",
      "Explicit profile for display / gh principal (does not rebind git helper)",
    )
    .action(async (opts) => {
      const resolved = resolveFromCwd(process.cwd(), process.env, {
        forcedProfileId: opts.profile,
        allowEnvProfile: false,
      });
      const ambient = process.env.ACCT_PROFILE?.trim();
      if (ambient && !opts.profile) {
        const cwdOnly = resolveFromCwd(process.cwd(), process.env, {
          allowEnvProfile: false,
        });
        if (cwdOnly.profile && ambient !== cwdOnly.profile.id) {
          console.log(
            `warning: ambient ACCT_PROFILE=${ambient} is ignored for git auth (cwd resolves to ${cwdOnly.profile.id}). Use --profile or .acct / cd.`,
          );
        }
      }
      console.log(`cwd: ${process.cwd()}`);
      console.log(`reason: ${resolved.reason}`);
      console.log(`enforce: ${resolved.enforce}`);
      if (resolved.bindingPath) console.log(`binding: ${resolved.bindingPath}`);
      if(resolved.ignoredLocalAcct) console.log(`ignored .acct below repository root: ${resolved.ignoredLocalAcct}`);
      if(resolved.conflict) console.log(resolved.conflict.detail);
      if (!resolved.profile) {
        console.log("profile: (unbound)");
        if(loadConfig().bindings.some(b=>!fs.existsSync(b.path)))console.log("hint: binding path missing (moved or deleted?) — run acct doctor, acct rebind <old> <new>, or acct unbind <old>");
        return;
      }
      for(const chain of effectiveHelperChains(process.cwd(),process.env)) if(!chain.ok) console.log(`helper-chain-mismatch: ${chain.host}; run acct install`);
      const p = resolved.profile;
      const shellWarning=shellHookWarning(p.host,process.env);if(shellWarning)console.log("warning: "+shellWarning);
      console.log(`profile: ${p.id}`);
      console.log(`github: ${p.githubUser}@${p.host}`);
      console.log(`identity: ${p.name} <${p.email}>`);
      console.log(`protocol: ${p.protocol}`);
      const input = await collectDiagnoseInput(
        p,
        resolved.enforce,
        process.cwd(),
        process.env,
        { queryPrincipal: true, persistToken: true, bindingPath: resolved.bindingPath },
      );
      console.log(`token: ${input.hasToken ? "present (keychain)" : "missing"}`);
      console.log(`auth state: ${input.authState}`);
      if(input.inGitRepo && !input.hooksActive)console.log(`not enforced here (${input.hooksInactiveReason})`);
      console.log(
        `auth principal: ${input.authPrincipal ?? "(could not query)"}`,
      );
      if (input.ghActiveChecked) {
        console.log(
          `gh active: ${input.ghActiveUser ?? "(could not query)"}`,
        );
      }
      if (input.inGitRepo === false) {
        console.log(
          "note: not a git repository under this binding — includeIf identity applies inside repos here",
        );
      }
      if (
        input.authPrincipal &&
        input.authPrincipal.toLowerCase() !== p.githubUser.toLowerCase()
      ) {
        console.log("LEAK RISK: auth principal ≠ profile github user");
      }
      const report = diagnose(input);
      if (report.issues.length > 0) {
        console.log("---");
        console.log(formatDiagnoseReport(report));
        if (diagnoseHasErrors(report)) process.exitCode = 1;
      }
    });

  program
    .command("whoami")
    .description("Short expected vs actual")
    .option("--profile <id>", "Explicit profile (gh plane)")
    .action(async (opts) => {
      const resolved = resolveFromCwd(process.cwd(), process.env, {
        forcedProfileId: opts.profile,
        allowEnvProfile: false,
      });
      if (!resolved.profile) {
        console.log(`actual=unknown (${resolved.conflict?.detail ?? "unbound directory"})`);
        process.exitCode=2;
        return;
      }
      const env = await envForProfile(resolved.profile);
      const login = ghApiLogin(env);
      console.log(
        `expected=${resolved.profile.githubUser} actual=${login ?? "unknown (could not verify principal)"} email=${resolved.profile.email}`,
      );
      if(!login)process.exitCode=2;
      if (login && login.toLowerCase() !== resolved.profile.githubUser.toLowerCase()) {
        console.log(
          "mismatch — run `acct status` for what's wrong, the fix commands, and whether commit/push will go through",
        );
        process.exitCode = 1;
      }
    });

  program
    .command("doctor")
    .description(
      "Scan for auth conflicts, helper leaks, and keychain issues (trust check)",
    )
    .option("--online", "Allow network checks (gh api user)")
    .action(async (opts) => {
      const { findings, explain } = await runDoctor(process.cwd(), process.env, {
        online: !!opts.online,
      });
      for (const f of findings) {
        const tag = f.severity.toUpperCase();
        console.log(`[${tag}] ${f.code}: ${f.message}`);
        if (f.fix) console.log(`  fix: ${f.fix}`);
      }
      const errors = findings.filter((f) => f.severity === "error").length;
      const warns = findings.filter((f) => f.severity === "warn").length;
      const oks = findings.filter((f) => f.severity === "ok").length;
      console.log("---");
      console.log(`${oks} ok · ${warns} warn · ${errors} error`);
      if (!opts.online && !explain) {
        console.log(
          "Tip: pass --online to verify ambient GH_TOKEN against the cwd profile principal.",
        );
      }
      if (explain) {
        console.log("");
        console.log(explain);
      }
      if (errors > 0) process.exitCode = 1;
    });

  program
    .command("exec")
    .passThroughOptions()
    .description(
      "Run a command with profile GH_TOKEN (no gh auth switch/login/token). Git HTTPS still follows cwd/.acct.",
    )
    .allowUnknownOption(true)
    .option(
      "--profile <id>",
      "Inject this profile's token for gh (does not rebind git credential helper)",
    )
    .option(
      "--allow-cross-profile",
      "Required when --profile differs from the cwd binding (gh plane only)",
    )
    .argument("<command...>")
    .action(async (command: string[], opts) => {
      if (isDangerousGhArgv(command)) {
        throw new Error(
          `Refusing to run "${command.join(" ")}" under acct exec — it mutates global gh/git state. Use acct profile flows instead.`,
        );
      }
      // GH plane: optional --profile. Git helper ignores ambient ACCT_PROFILE (I4).
      // Cite: https://cli.github.com/manual/gh_help_environment (GH_TOKEN);
      //       https://github.com/cli/cli/issues/2771 (GH_TOKEN ≠ git HTTPS).
      const cwdResolved = resolveFromCwd(process.cwd(), process.env, {
        allowEnvProfile: false,
      });
      const resolved = resolveFromCwd(process.cwd(), process.env, {
        forcedProfileId: opts.profile,
        allowEnvProfile: false,
      });
      if (
        opts.profile &&
        cwdResolved.profile &&
        resolved.profile &&
        cwdResolved.profile.id !== resolved.profile.id &&
        !opts.allowCrossProfile
      ) {
        throw new Error(
          `Refusing --profile ${opts.profile}: cwd resolves to "${cwdResolved.profile.id}". ` +
            `Git HTTPS still follows the directory/.acct. Pass --allow-cross-profile to inject the other account's GH_TOKEN for gh only.`,
        );
      }
      if(resolved.reason === "conflict" && resolved.enforce === "strict") throw new Error(resolved.conflict!.detail);
      if (opts.profile && !resolved.profile) throw new Error(`Unknown profile: ${opts.profile}`);
      const depth = Number(process.env.ACCT_EXEC_DEPTH ?? 0) + 1;
      if (!Number.isFinite(depth) || depth > 2) throw new Error("acct exec recursion depth exceeded");
      const effective = stripWrapperArgv(command);
      const isGh = !!effective[0] && commandBasename(effective[0]) === "gh";
      const env = resolved.profile
        ? stripGitConfigEnvOverrides(await envForProfile(resolved.profile, process.env, resolved.enforce))
        : { ...process.env };
      if (!resolved.profile) console.error("acct note: unbound directory — acct is not managing gh here");
      if (resolved.profile && resolved.enforce === "strict" && isGh && (!env.GH_TOKEN && !env.GH_ENTERPRISE_TOKEN || env.GH_TOKEN === "acct-blocked-no-token" || env.GH_ENTERPRISE_TOKEN === "acct-blocked-no-token")) throw new Error(`No token for profile ${resolved.profile.id}; refusing to spawn gh`);
      env.PATH = withoutWrapPath(env);
      env.ACCT_EXEC_DEPTH = String(depth);
      const spawnCommand = [...command];
      if (isGh) spawnCommand[command.length - effective.length] = resolveRealGh(env);
      if (
        opts.profile &&
        cwdResolved.profile &&
        resolved.profile &&
        cwdResolved.profile.id !== resolved.profile.id
      ) {
        console.error(
          `acct warning: --profile ${resolved.profile.id} differs from cwd profile ${cwdResolved.profile.id}. ` +
            `GH_TOKEN injected for gh only; git HTTPS credentials still follow cwd/.acct.`,
        );
      } else if (command[0] === "git" && opts.profile) {
        console.error(
          "acct note: --profile affects GH_TOKEN only; git HTTPS credentials follow directory/.acct (https://github.com/cli/cli/issues/2771).",
        );
      }
      const code = await new Promise<number>((resolve) => {
        const child = spawn(spawnCommand[0]!, spawnCommand.slice(1), {
          stdio: "inherit",
          env,
          shell: false,
        });
        child.on("exit", (c) => resolve(c ?? 1));
        child.on("error", () => resolve(1));
      });
      process.exitCode = code;
    });

  program
    .command("clone")
    .passThroughOptions()
    .description("git clone with the cwd profile's GH_TOKEN injected")
    .argument("<url>")
    .argument("[args...]", "git clone arguments after the URL")
    .option(
      "--profile <id>",
      "Inject profile GH_TOKEN for helpers that honor it; git still uses cwd binding",
    )
    .action(async (url, cloneArgs: string[], opts) => {
      const resolved = resolveFromCwd(process.cwd(), process.env, {
        forcedProfileId: opts.profile,
        allowEnvProfile: false,
      });
      if (opts.profile && !resolved.profile) throw new Error(`Unknown profile: ${opts.profile}`);
      if (resolved.reason === "conflict" && resolved.enforce === "strict") throw new Error(resolved.conflict!.detail);
      const env = stripGitConfigEnvOverrides(
        resolved.profile
          ? await envForProfile(resolved.profile, process.env, resolved.enforce)
          : { ...process.env },
      );
      const args = ["clone", url, ...cloneArgs];
      const result = spawnSync("git", args, { stdio: "inherit", env });
      if (result.error) {
        console.error(`acct clone failed: ${result.error.message}`);
        process.exitCode = 1;
        return;
      }
      if (result.status !== 0) process.exit(result.status ?? 1);
    });

  program
    .command("enforce")
    .description("Set default enforcement mode (strict|warn|off)")
    .argument("<mode>", "strict|warn|off|on")
    .action((mode) => {
      let m = mode as string;
      if (m === "on") m = "strict";
      if (!["strict", "warn", "off"].includes(m)) {
        throw new Error("mode must be strict|warn|off|on");
      }
      const config = loadConfig();
      config.defaultEnforce = m as EnforceMode;
      updateConfig(process.env, () => config);
      console.log(`defaultEnforce=${m}`);
    });

  program
    .command("hook")
    .description("Print shell hook to rebind env on cd")
    .argument("<shell>", "bash|zsh|fish|powershell")
    .action((shell: string) => {
      if (!["bash", "zsh", "fish", "powershell"].includes(shell)) {
        throw new Error("shell must be bash|zsh|fish|powershell");
      }
      process.stdout.write(hookScript(shell as ShellKind));
    });

  program
    .command("wrap-install")
    .description("Install optional PATH shims (gh → acct exec gh)")
    .action(() => {
      const dir = installWrapShims();
      console.log(`Wrap shims installed in ${dir}`);
      console.log("Add to shell:");
      console.log(`  eval "$(acct wrap-path)"`);
    });

  program
    .command("wrap-path")
    .description("Print PATH export for wrap shims")
    .option("--powershell", "Emit PowerShell syntax")
    .option("--fish", "Emit native Fish syntax")
    .action((opts) => {
      const dir = installWrapShims();
      process.stdout.write(wrapPathExport(dir, !!opts.powershell));
    });

  program
    .command("shell-env")
    .description("Print env exports for the cwd profile (used by shell hooks)")
    .option("--powershell", "Emit PowerShell syntax")
    .option("--fish", "Emit native Fish syntax")
    .action(async (opts) => {
      const exports = await buildShellEnvExports();
      process.stdout.write(shellEnvExports(exports, !!opts.powershell,!!opts.fish));
    });

  program
    .command("install")
    .description("Wire includes and global chaining hooks; --repo handles a local override")
    .option("--repo", "Install chaining hooks for this repository")
    .option(
      "--global",
      "Accepted alias for the default global chaining hooks",
    )
    .option(
      "--force",
      "Accepted compatibility flag; existing hooks are chained",
    )
    .action((opts) => {
      const config = loadConfig();
      config.installed = true;
      updateConfig(process.env, () => config);
      const hooks = installHooks();
      configureHooksPath(hooks, { global: !opts.repo, repo: !!opts.repo, force: !!opts.force });
      console.log("Installed acct git includes and hooks");
    });

  program
    .command("uninstall")
    .description("Remove acct managed gitconfig block")
    .option("--restore-backup", "Restore pre-acct gitconfig backup")
    .action((opts) => {
      uninstallIncludeIf();
      unsetAcctHooksPath({ global: true });
      const configForHooks = loadConfig();
      for (const binding of configForHooks.bindings) {
        unsetAcctHooksPath({ bindDir: binding.path });
      }
      unsetAcctHooksPath({ global: false });
      if (opts.restoreBackup) {
        if (restoreGitconfigBackup()) console.log("Restored gitconfig backup");
        else console.log("No backup found");
      }
      const config = loadConfig();
      config.installed = false;
      updateConfig(process.env, () => config);
      console.log("Uninstalled acct managed gitconfig block");
      // I14 strips only the managed block — prior OS helpers often remain.
      // Cite: https://git-scm.com/docs/gitcredentials
      // Cite: docs/research/xargs-sticky-uninstall-delete-cites-2026-08-08.md
      console.error(
        "warning: OS credential helpers (osxkeychain/wincred/libsecret/manager) may still answer for github.com with whatever account is cached.",
      );
      console.error(
        "warning: Clear a cached github.com credential with:\n  printf 'protocol=https\\nhost=github.com\\n\\n' | git credential reject",
      );
      console.error(
        "warning: Re-run `acct install` to restore fail-closed unbound HTTPS, or `acct doctor` to inspect helpers.",
      );
      console.error(
        "warning: Local core.hooksPath was unset in bound git toplevels that pointed at acct hooks. Other clones: git config --unset core.hooksPath",
      );
    });

  program
    .command("hook-run")
    .description("Internal: run enforce hook (pre-commit|pre-push)")
    .argument("<hook>", "pre-commit|pre-merge-commit|post-commit|pre-push")
    .argument("[remote]")
    .argument("[url]")
    .action(async (hook, remote, url) => {
      if (["pre-commit", "pre-merge-commit", "post-commit"].includes(hook)) {
        const result = hook === "post-commit" ? await checkRecordedCommit(process.cwd(), process.env) : await checkCommitIdentity();
        if (!result.ok) {
          const resolved = resolveFromCwd();
          console.error(
            formatBlockMessage("commit", resolved.profile, result.messages),
          );
          if (resolved.profile) {
            const report = await diagnoseCwd(
              resolved.profile,
              resolved.enforce,
              process.cwd(),
              process.env,
              { bindingPath: resolved.bindingPath, queryPrincipal: false },
            );
            if (report.issues.length > 0) {
              console.error("");
              console.error(formatDiagnoseReport(report));
            }
          }
          process.exitCode = 1;
        }
        return;
      }
      if (hook === "pre-push") {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        const outgoing = await checkOutgoingCommits(process.cwd(), process.env, remote ?? "origin", Buffer.concat(chunks).toString("utf8"));
        const result = await checkPushAuth(process.cwd(), process.env, defaultGitConfigReader, url);
        result.messages.push(...outgoing.messages);
        result.ok = result.ok && outgoing.ok;
        if (!result.ok) {
          const resolved = resolveFromCwd();
          console.error(
            formatBlockMessage("push", resolved.profile, result.messages),
          );
          if (resolved.profile) {
            const report = await diagnoseCwd(
              resolved.profile,
              resolved.enforce,
              process.cwd(),
              process.env,
              { bindingPath: resolved.bindingPath, queryPrincipal: false },
            );
            if (report.issues.length > 0) {
              console.error("");
              console.error(formatDiagnoseReport(report));
            }
          }
          process.exitCode = 1;
        }
        return;
      }
      throw new Error(`Unknown hook ${hook}`);
    });

  program
    .command("ssh-test")
    .description("Test SSH auth for a profile against github.com")
    .argument("<id>")
    .action((id) => {
      const config = loadConfig();
      const p = findProfileById(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      const r = testSshAuth(p);
      console.log(r.output);
      if (!r.ok) process.exitCode = 1;
    });

  program.command("rebind").argument("<oldPath>").argument("<newPath>").action((oldPath,newPath)=>{
    const old=normalizePath(oldPath),target=normalizePath(newPath);assertSafeBindPath(target);
    let config=loadConfig();const moved=config.bindings.filter(b=>pathIsPrefix(old,b.path));if(!moved.length)throw new Error("No bindings at or under the old path");
    config={...config,bindings:config.bindings.filter(b=>!pathIsPrefix(old,b.path))};
    for(const binding of moved){const next=normalizePath(path.join(target,path.relative(old,normalizePath(binding.path))));assertSafeBindPath(next);const ctx=fs.existsSync(next)?resolveGitContext(next,process.env):null;if(ctx?.workTree && ctx.workTree!==next)throw new Error("bind the repository root or a directory containing repositories");config=upsertBinding(config,{...binding,path:next});}
    updateConfig(process.env,()=>config);console.log(`Rebound ${old} → ${target}`);
  });
  const local=program.command("local").description("Manage the repository marker and native Git include");
  local.command("set").argument("[profileId]").option("--unbound").action((id,opts) => localSet(process.cwd(),id,!!opts.unbound,process.env));
  local.command("clear").action(() => localClear(process.cwd(),process.env));
  const choices=(command:Command)=>{
    for(const option of command.options) {
      if(option.long === "--enforce") option.choices(["strict","warn","off"]);
      if(option.long === "--protocol") option.choices(["https","ssh"]);
    }
    for(const arg of command.registeredArguments) {
      if(command.name() === "enforce")arg.choices(["strict","warn","off"]);
      if(command.name() === "hook")arg.choices(["bash","zsh","fish","powershell"]);
    }
    for(const child of command.commands)choices(child);
  };choices(program);
  let success=false;
  try {await program.parseAsync(argv);success=!process.exitCode;}
  finally {mutation?.finish(success);}
}
