import fs from "node:fs";
import YAML from "yaml";
import { describe, it, expect } from "vitest";
const read = (file: string) => fs.readFileSync(file, "utf8");
describe("reviewed release delivery contract", () => {
  it("ships version 0.2.0 with upgrade instructions", () => {
    expect(JSON.parse(read("package.json")).version).toBe("0.2.0");
    expect(JSON.parse(read("package-lock.json")).version).toBe("0.2.0");
    expect(read("docs/releases/v0.2.0.md")).toContain("acct install");
  });
  it("pins required actions and keeps CI read-only", () => {
    const source = read(".github/workflows/ci.yml");
    expect(YAML.parse(source).permissions).toEqual({ contents: "read" });
    expect(source).toContain(
      "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    );
    expect(source).toContain(
      "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
    );
    expect(source).toContain(
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    );
  });
  it("publishes only built artifacts in a protected separate job", () => {
    expect(read(".github/workflows/release.yml")).toContain(
      "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
    );
    const workflow = YAML.parse(read(".github/workflows/release.yml"));
    const build = workflow.jobs.build,
      publish = workflow.jobs.publish;
    expect(build.permissions).toEqual({ contents: "read" });
    expect(publish.needs).toBe("build");
    expect(publish.environment).toBeTruthy();
    expect(
      publish.steps.some((step: any) =>
        String(step.uses).startsWith("actions/checkout"),
      ),
    ).toBe(false);
    const runs = publish.steps.map((step: any) => step.run ?? "").join("\n");
    expect(runs).not.toMatch(/npm (ci|run|pkg)/);
    expect(runs).toContain("npm publish");
    expect(runs).toContain("--ignore-scripts");
    for (const job of Object.values(workflow.jobs) as any[])
      for (const step of job.steps)
        if (step.run) expect(step.run).not.toContain("${{");
    expect(read(".github/workflows/release.yml")).toContain(
      "softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65",
    );
  });
});
