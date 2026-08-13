import { describe, expect, it } from "vitest";
import { assertNoSecretsInConfig } from "../../src/config/store.js";

describe("config refuses tokens on disk", () => {
  it("assertNoSecretsInConfig throws on token-like strings", () => {
    expect(() =>
      assertNoSecretsInConfig({
        version: 1,
        defaultEnforce: "strict",
        profiles: [],
        bindings: [],
        // sneak token into a field
        // @ts-expect-error intentional
        evil: "gho_abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow(/token/);
  });
});
