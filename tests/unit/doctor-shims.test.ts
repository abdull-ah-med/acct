import { describe, expect, it } from "vitest";
import { cmdWords } from "../../src/doctor/shims.js";
import { renderCmdNodeInvoke } from "../../src/util/cmd-escape.js";

describe("doctor .cmd shim parsing", () => {
  it("keeps Windows backslashes and undoes cmd escaping", () => {
    const node = "C:\\hostedtoolcache\\windows\\node\\20.20.2\\x64\\node.exe";
    const script = 'D:\\a\\acct "x"\\100%\\bin\\git-credential-acct.js';
    const line = renderCmdNodeInvoke(node, script).split("\r\n")[1]!;
    expect(cmdWords(line).slice(0, 2)).toEqual([node, script]);
  });
});
