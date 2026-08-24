import { describe, expect, it } from "vitest";
import {
  collectInitPlan,
  type WizardIO,
} from "../../src/cli/wizard.js";

function scriptedIo(answers: string[]): { io: WizardIO; log: string[] } {
  const log: string[] = [];
  let i = 0;
  return {
    log,
    io: {
      async ask(prompt: string) {
        log.push(`ASK ${prompt}`);
        const next = answers[i];
        if (next === undefined) {
          throw new Error(`unexpected prompt: ${prompt}`);
        }
        i += 1;
        return next;
      },
      say(line: string) {
        log.push(line);
      },
    },
  };
}

describe("init wizard (product: one field at a time, confirm at end)", () => {
  it("new identity: echoes each field, prints a summary, requires yes to proceed", async () => {
    const { io, log } = scriptedIo([
      "n",
      "work",
      "user-a",
      "user-a@example.com",
      "User A",
      "y",
    ]);
    const plan = await collectInitPlan(io, {
      cwd: "/tmp/Work",
      current: { name: "", email: "", githubUser: null },
    });
    expect(plan).toEqual({
      id: "work",
      githubUser: "user-a",
      email: "user-a@example.com",
      name: "User A",
      host: "github.com",
      protocol: "https",
      bind: "/tmp/Work",
      importGh: true,
    });
    expect(log).toContain("id: work");
    expect(log).toContain("GitHub username: user-a");
    expect(log).toContain("email: user-a@example.com");
    expect(log).toContain("name: User A");
    expect(log.some((l) => l.includes("user-a@github.com"))).toBe(true);
    expect(log.some((l) => l.includes("User A <user-a@example.com>"))).toBe(
      true,
    );
    expect(log.some((l) => l.includes("/tmp/Work"))).toBe(true);
  });

  it("use identity already in this folder: only asks for id, then confirm", async () => {
    const { io, log } = scriptedIo(["y", "personal", "y"]);
    const plan = await collectInitPlan(io, {
      cwd: "/home/me/Personal",
      current: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        githubUser: "adal",
      },
    });
    expect(plan).toEqual({
      id: "personal",
      githubUser: "adal",
      email: "ada@example.com",
      name: "Ada Lovelace",
      host: "github.com",
      protocol: "https",
      bind: "/home/me/Personal",
      importGh: true,
    });
    expect(log.some((l) => l.includes("Ada Lovelace <ada@example.com>"))).toBe(
      true,
    );
    expect(log.some((l) => /adal/.test(l))).toBe(true);
    expect(log).toContain("id: personal");
  });

  it("declining the summary aborts with no plan", async () => {
    const { io } = scriptedIo([
      "n",
      "work",
      "user-a",
      "user-a@example.com",
      "User A",
      "n",
    ]);
    const plan = await collectInitPlan(io, {
      cwd: "/tmp/Work",
      current: { name: "", email: "", githubUser: null },
    });
    expect(plan).toBeNull();
  });
});
