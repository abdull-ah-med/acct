import {
  assertValidProfileId,
} from "../util/profile-id.js";
import {
  assertSafeGithubUser,
  assertSafeProfileEmail,
  assertSafeProfileName,
} from "../util/profile-fields.js";
import type { Protocol } from "../types.js";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

export interface WizardIO {
  ask(prompt: string): Promise<string>;
  say(line: string): void;
}

export function createStdioWizardIO(): WizardIO & { close(): void } {
  const rl = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  const buffer: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let closed = false;
  rl.on("line", (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else buffer.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) waiters.shift()!("");
  });
  return {
    async ask(prompt: string) {
      const p = prompt.endsWith(" ") ? prompt : `${prompt} `;
      output.write(p);
      if (buffer.length > 0) return buffer.shift()!;
      if (closed) return "";
      return await new Promise<string>((resolve) => waiters.push(resolve));
    },
    say(line: string) {
      output.write(`${line}\n`);
    },
    close() {
      rl.close();
    },
  };
}

export interface CurrentFolderIdentity {
  name: string;
  email: string;
  githubUser: string | null;
}

export interface InitPlan {
  id: string;
  githubUser: string;
  email: string;
  name: string;
  host: string;
  protocol: Protocol;
  bind: string;
  importGh: boolean;
  globalHooks?: boolean;
  force?: boolean;
}

export function currentIdentityUsable(current: CurrentFolderIdentity): boolean {
  return !!(current.name && current.email) || !!current.githubUser;
}

function parseYes(raw: string, defaultYes: boolean): boolean | null {
  const t = raw.trim().toLowerCase();
  if (t === "") return defaultYes;
  if (t === "y" || t === "yes") return true;
  if (t === "n" || t === "no") return false;
  return null;
}

async function askYesNo(
  io: WizardIO,
  prompt: string,
  defaultYes: boolean,
): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  for (;;) {
    const parsed = parseYes(await io.ask(`${prompt} ${hint}`), defaultYes);
    if (parsed !== null) return parsed;
    io.say("Please answer y or n.");
  }
}

async function askValidated(
  io: WizardIO,
  enter: string,
  echo: string,
  validate: (value: string) => void,
): Promise<string> {
  for (;;) {
    const value = (await io.ask(`enter ${enter}:`)).trim();
    try {
      validate(value);
      io.say(`${echo}: ${value}`);
      return value;
    } catch (err) {
      io.say(err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Step-by-step init: offer the folder's current git/gh identity, then
 * collect missing fields one at a time (echo each), print a summary, confirm.
 */
export async function collectInitPlan(
  io: WizardIO,
  ctx: { cwd: string; current: CurrentFolderIdentity },
): Promise<InitPlan | null> {
  const host = "github.com";
  const bind = ctx.cwd;

  io.say(`This folder: ${bind}`);

  let name = "";
  let email = "";
  let githubUser = "";

  if (ctx.current.name || ctx.current.email) {
    io.say(
      `  git:  ${ctx.current.name || "(unset)"} <${ctx.current.email || "(unset)"}>`,
    );
  } else {
    io.say("  git:  (unset)");
  }
  if (ctx.current.githubUser) {
    io.say(`  gh:   ${ctx.current.githubUser}`);
  } else {
    io.say("  gh:   (unset)");
  }

  const useCurrent = await askYesNo(
    io,
    "Use the identity already in this folder?",
    currentIdentityUsable(ctx.current),
  );
  if (useCurrent) {
    name = ctx.current.name.trim();
    email = ctx.current.email.trim();
    githubUser = (ctx.current.githubUser ?? "").trim();
  }

  const id = await askValidated(io, "id", "id", assertValidProfileId);

  if (!githubUser) {
    githubUser = await askValidated(
      io,
      "GitHub username",
      "GitHub username",
      assertSafeGithubUser,
    );
  }
  if (!email) {
    email = await askValidated(io, "email", "email", assertSafeProfileEmail);
  }
  if (!name) {
    name = await askValidated(io, "name", "name", assertSafeProfileName);
  }

  io.say("");
  io.say("Create this profile?");
  io.say(`  id:       ${id}`);
  io.say(`  github:   ${githubUser}@${host}`);
  io.say(`  identity: ${name} <${email}>`);
  io.say(`  bind:     ${bind}`);
  io.say("  token:    import from gh");

  const ok = await askYesNo(io, "Proceed?", false);
  if (!ok) {
    io.say("Aborted.");
    return null;
  }

  return {
    id,
    githubUser,
    email,
    name,
    host,
    protocol: "https",
    bind,
    importGh: true,
  };
}
