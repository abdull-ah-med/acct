import { Command } from "commander";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  loadConfig,
  saveConfig,
  upsertProfile,
  removeProfile,
  upsertBinding,
  removeBinding,
  assertNoSecretsInConfig,
  getProfile,
} from "../config/store.js";
import type { EnforceMode, Profile, Protocol } from "../types.js";
import { resolveFromCwd } from "../resolution/fromCwd.js";
import { normalizePath } from "../util/paths.js";
import {
  installIncludeIf,
  uninstallIncludeIf,
  restoreGitconfigBackup,
  writeProfileInclude,
} from "../identity/includeIf.js";
import { setProfileToken, getProfileToken, deleteProfileToken } from "../secrets/store.js";
import { importAndStoreToken, envForProfile, isDangerousGhArgv, ghApiLogin } from "../gh/env.js";
import { generateSshKey, readPublicKey, testSshAuth } from "../ssh/keys.js";
import {
  checkCommitIdentity,
  checkPushAuth,
  formatBlockMessage,
} from "../enforce/checks.js";
import { installHooks } from "../enforce/hooks.js";
import { hookScript, shellEnvExports, type ShellKind } from "../shell/hooks.js";
import { buildShellEnvExports } from "../shell/env.js";
import { installWrapShims, wrapPathExport } from "../shell/wrap.js";
import { runDoctor } from "../doctor/run.js";
import { execFileSync } from "node:child_process";

function configureHooksPath(
  hooks: string,
  opts: { global?: boolean } = {},
): void {
  if (opts.global) {
    execFileSync("git", ["config", "--global", "core.hooksPath", hooks]);
    console.log(`core.hooksPath=${hooks} (global)`);
    console.log(
      "Warning: a global hooksPath replaces hooks for every repository. Prefer per-repo install without --global.",
    );
    return;
  }
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    console.log(`Hooks written to ${hooks}`);
    console.log(
      "Not inside a git repo — skipped core.hooksPath. Re-run `acct install` inside a repo, or pass --global.",
    );
    return;
  }
  execFileSync("git", ["config", "core.hooksPath", hooks]);
  console.log(`core.hooksPath=${hooks} (local repo)`);
}

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("acct")
    .description(
      "Directory-scoped GitHub identity and auth — one account, one identity, one directory",
    )
    .version("0.1.2");

  program
    .command("init")
    .description("Interactive-ish setup: create a profile and bind a directory")
    .requiredOption("--id <id>", "Profile id (e.g. work)")
    .requiredOption("--user <githubUser>", "GitHub username")
    .requiredOption("--email <email>", "Commit email")
    .requiredOption("--name <name>", "Commit name")
    .option("--host <host>", "GitHub host", "github.com")
    .option("--protocol <protocol>", "https|ssh", "https")
    .option("--bind <dir>", "Directory to bind", process.cwd())
    .option("--import-gh", "Import token via gh auth token --user")
    .option(
      "--global-hooks",
      "Set core.hooksPath globally (discouraged; replaces hooks in all repos)",
    )
    .action(async (opts) => {
      let config = loadConfig();
      const profile: Profile = {
        id: opts.id,
        githubUser: opts.user,
        host: opts.host,
        name: opts.name,
        email: opts.email,
        protocol: opts.protocol as Protocol,
        enforce: "strict",
      };
      config = upsertProfile(config, profile);
      config = upsertBinding(config, {
        path: path.resolve(opts.bind),
        profileId: profile.id,
      });
      assertNoSecretsInConfig(config);
      saveConfig(config);
      if (opts.importGh) {
        await importAndStoreToken(profile);
        console.log(`Imported token for ${profile.githubUser} into OS keychain`);
      }
      installIncludeIf(config);
      const hooks = installHooks();
      try {
        configureHooksPath(hooks, { global: !!opts.globalHooks });
      } catch (e) {
        console.warn(`Could not set core.hooksPath: ${e}`);
      }
      config.installed = true;
      saveConfig(config);
      console.log(`Initialized profile "${profile.id}" bound to ${normalizePath(opts.bind)}`);
      console.log("Add shell hook: eval \"$(acct hook zsh)\"  # or bash/fish/powershell");
    });

  const profileCmd = program.command("profile").description("Manage profiles");

  profileCmd
    .command("add")
    .requiredOption("--id <id>")
    .requiredOption("--user <githubUser>")
    .requiredOption("--email <email>")
    .requiredOption("--name <name>")
    .option("--host <host>", "github.com")
    .option("--protocol <protocol>", "https")
    .option("--import-gh", "Import token via gh auth token --user")
    .action(async (opts) => {
      let config = loadConfig();
      const profile: Profile = {
        id: opts.id,
        githubUser: opts.user,
        host: opts.host || "github.com",
        name: opts.name,
        email: opts.email,
        protocol: (opts.protocol || "https") as Protocol,
        enforce: "strict",
      };
      config = upsertProfile(config, profile);
      assertNoSecretsInConfig(config);
      saveConfig(config);
      writeProfileInclude(profile);
      if (opts.importGh) await importAndStoreToken(profile);
      console.log(`Added profile ${profile.id}`);
    });

  profileCmd.command("list").action(() => {
    const config = loadConfig();
    for (const p of config.profiles) {
      console.log(
        `${p.id}\t${p.githubUser}@${p.host}\t${p.email}\t${p.protocol}`,
      );
    }
  });

  profileCmd
    .command("show")
    .argument("<id>")
    .action((id) => {
      const config = loadConfig();
      const p = getProfile(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      console.log(JSON.stringify(p, null, 2));
    });

  profileCmd
    .command("remove")
    .argument("<id>")
    .action(async (id) => {
      let config = loadConfig();
      const p = getProfile(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      await deleteProfileToken(p);
      config = removeProfile(config, id);
      saveConfig(config);
      installIncludeIf(config);
      console.log(`Removed profile ${id}`);
    });

  profileCmd
    .command("token")
    .argument("<id>")
    .option("--import-gh", "Import from gh auth token --user")
    .option("--stdin", "Read token from stdin")
    .action(async (id, opts) => {
      const config = loadConfig();
      const p = getProfile(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      if (opts.importGh) {
        await importAndStoreToken(p);
        console.log("Token imported into OS keychain");
        return;
      }
      if (opts.stdin) {
        const chunks: Buffer[] = [];
        for await (const c of process.stdin) {
          chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        }
        await setProfileToken(p, Buffer.concat(chunks).toString("utf8"));
        console.log("Token stored in OS keychain");
        return;
      }
      throw new Error("Specify --import-gh or --stdin");
    });

  profileCmd
    .command("ssh-key")
    .argument("<id>")
    .option("--generate", "Generate ed25519 key")
    .option("--path <path>", "Attach existing private key")
    .option(
      "--protocol <protocol>",
      "Set preferred protocol https|ssh (default: leave unchanged; generate defaults to ssh)",
    )
    .action((id, opts) => {
      let config = loadConfig();
      const p = getProfile(config, id);
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
        saveConfig(config);
        writeProfileInclude(p);
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
        saveConfig(config);
        writeProfileInclude(p);
        console.log(`Attached ${p.sshKeyPath}`);
        return;
      }
      throw new Error("Specify --generate or --path");
    });

  program
    .command("bind")
    .argument("<dir>")
    .argument("<profileId>")
    .option("--enforce <mode>", "strict|warn|off")
    .action((dir, profileId, opts) => {
      let config = loadConfig();
      if (!getProfile(config, profileId)) {
        throw new Error(`Unknown profile: ${profileId}`);
      }
      config = upsertBinding(config, {
        path: path.resolve(dir),
        profileId,
        enforce: opts.enforce as EnforceMode | undefined,
      });
      saveConfig(config);
      installIncludeIf(config);
      console.log(`Bound ${normalizePath(dir)} → ${profileId}`);
    });

  program
    .command("unbind")
    .argument("<dir>")
    .action((dir) => {
      let config = loadConfig();
      config = removeBinding(config, path.resolve(dir));
      saveConfig(config);
      installIncludeIf(config);
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
      if (!resolved.profile) {
        console.log("profile: (unbound)");
        return;
      }
      const p = resolved.profile;
      console.log(`profile: ${p.id}`);
      console.log(`github: ${p.githubUser}@${p.host}`);
      console.log(`identity: ${p.name} <${p.email}>`);
      console.log(`protocol: ${p.protocol}`);
      const hasToken = !!(await getProfileToken(p));
      console.log(`token: ${hasToken ? "present (keychain)" : "missing"}`);
      const env = await envForProfile(p);
      const login = ghApiLogin(env);
      console.log(`auth principal: ${login ?? "(could not query)"}`);
      if (login && login !== p.githubUser) {
        console.log("LEAK RISK: auth principal ≠ profile github user");
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
        console.log("unbound");
        return;
      }
      const env = await envForProfile(resolved.profile);
      const login = ghApiLogin(env);
      console.log(
        `expected=${resolved.profile.githubUser} actual=${login ?? "?"} email=${resolved.profile.email}`,
      );
    });

  program
    .command("doctor")
    .action(() => {
      const findings = runDoctor();
      for (const f of findings) {
        const tag = f.severity.toUpperCase();
        console.log(`[${tag}] ${f.code}: ${f.message}`);
        if (f.fix) console.log(`  fix: ${f.fix}`);
      }
      if (findings.some((f) => f.severity === "error")) process.exitCode = 1;
    });

  program
    .command("exec")
    .description(
      "Run a command with profile GH_TOKEN (no gh auth switch). Git HTTPS still follows cwd/.acct.",
    )
    .allowUnknownOption(true)
    .option(
      "--profile <id>",
      "Inject this profile's token for gh (does not rebind git credential helper)",
    )
    .argument("<command...>")
    .action(async (command: string[], opts) => {
      if (isDangerousGhArgv(command)) {
        throw new Error(
          `Refusing to run "${command.join(" ")}" under acct exec — it mutates global gh/git state. Use acct profile flows instead.`,
        );
      }
      // GH plane: optional --profile. Git helper ignores ambient ACCT_PROFILE (I4).
      const resolved = resolveFromCwd(process.cwd(), process.env, {
        forcedProfileId: opts.profile,
        allowEnvProfile: false,
      });
      const env = resolved.profile
        ? await envForProfile(resolved.profile)
        : { ...process.env };
      if (command[0] === "git" && opts.profile) {
        console.error(
          "acct note: --profile affects GH_TOKEN only; git HTTPS credentials follow directory/.acct (https://github.com/cli/cli/issues/2771).",
        );
      }
      const code = await new Promise<number>((resolve) => {
        const child = spawn(command[0]!, command.slice(1), {
          stdio: "inherit",
          env,
          shell: process.platform === "win32",
        });
        child.on("exit", (c) => resolve(c ?? 1));
      });
      process.exitCode = code;
    });

  program
    .command("clone")
    .argument("<url>")
    .argument("[dir]")
    .option(
      "--profile <id>",
      "Inject profile GH_TOKEN for helpers that honor it; git still uses cwd binding",
    )
    .action(async (url, dir, opts) => {
      const resolved = resolveFromCwd(process.cwd(), process.env, {
        forcedProfileId: opts.profile,
        allowEnvProfile: false,
      });
      const env = resolved.profile
        ? await envForProfile(resolved.profile)
        : process.env;
      const args = ["clone", url];
      if (dir) args.push(dir);
      execFileSync("git", args, { stdio: "inherit", env });
    });

  program
    .command("enforce")
    .argument("<mode>", "strict|warn|off|on")
    .action((mode) => {
      let m = mode as string;
      if (m === "on") m = "strict";
      if (!["strict", "warn", "off"].includes(m)) {
        throw new Error("mode must be strict|warn|off|on");
      }
      const config = loadConfig();
      config.defaultEnforce = m as EnforceMode;
      saveConfig(config);
      console.log(`defaultEnforce=${m}`);
    });

  program
    .command("hook")
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
    .option("--powershell", "Emit PowerShell syntax")
    .action((opts) => {
      const dir = installWrapShims();
      process.stdout.write(wrapPathExport(dir, !!opts.powershell));
    });

  program
    .command("shell-env")
    .option("--powershell", "Emit PowerShell syntax")
    .action(async (opts) => {
      const exports = await buildShellEnvExports();
      process.stdout.write(shellEnvExports(exports, !!opts.powershell));
    });

  program
    .command("install")
    .description("Wire includeIf; set core.hooksPath (local repo by default)")
    .option(
      "--global",
      "Set core.hooksPath globally (discouraged; replaces hooks in all repos)",
    )
    .action((opts) => {
      const config = loadConfig();
      installIncludeIf(config);
      const hooks = installHooks();
      configureHooksPath(hooks, { global: !!opts.global });
      config.installed = true;
      saveConfig(config);
      console.log("Installed acct git includes and hooks");
    });

  program
    .command("uninstall")
    .option("--restore-backup", "Restore pre-acct gitconfig backup")
    .action((opts) => {
      uninstallIncludeIf();
      try {
        execFileSync("git", ["config", "--global", "--unset", "core.hooksPath"]);
      } catch {
        // ignore
      }
      if (opts.restoreBackup) {
        if (restoreGitconfigBackup()) console.log("Restored gitconfig backup");
        else console.log("No backup found");
      }
      const config = loadConfig();
      config.installed = false;
      saveConfig(config);
      console.log("Uninstalled acct managed gitconfig block");
    });

  program
    .command("hook-run")
    .argument("<hook>", "pre-commit|pre-push")
    .action(async (hook) => {
      if (hook === "pre-commit") {
        const result = await checkCommitIdentity();
        if (!result.ok) {
          const resolved = resolveFromCwd();
          console.error(
            formatBlockMessage("commit", resolved.profile, result.messages),
          );
          process.exitCode = 1;
        }
        return;
      }
      if (hook === "pre-push") {
        const result = await checkPushAuth();
        if (!result.ok) {
          const resolved = resolveFromCwd();
          console.error(
            formatBlockMessage("push", resolved.profile, result.messages),
          );
          process.exitCode = 1;
        }
        return;
      }
      throw new Error(`Unknown hook ${hook}`);
    });

  program
    .command("ssh-test")
    .argument("<id>")
    .action((id) => {
      const config = loadConfig();
      const p = getProfile(config, id);
      if (!p) throw new Error(`Unknown profile: ${id}`);
      const r = testSshAuth(p);
      console.log(r.output);
      if (!r.ok) process.exitCode = 1;
    });

  await program.parseAsync(argv);
}
