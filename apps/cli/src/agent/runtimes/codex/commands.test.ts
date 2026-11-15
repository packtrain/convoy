import { describe, it, expect } from "vitest";
import {
  CODEX_APP_SERVER_COMMANDS,
  discoverCodexCommands,
  isCodexAppServerCommand,
} from "./commands.js";

describe("discoverCodexCommands", () => {
  it("advertises app-server commands on the app-server transport", () => {
    expect(discoverCodexCommands({ appServer: true })).toEqual([
      "compact",
      "usage",
      {
        name: "goal",
        description: "Keep working until a condition holds",
        argumentHint: "[objective | pause | resume | clear]",
      },
    ]);
  });

  it("advertises nothing on the exec transport (OS-1582)", () => {
    // Discovery feeds the composer autocomplete, which is what flags a
    // message as a runtime command. Advertising on exec — which has no RPC
    // channel — would send "/compact" as prose.
    expect(discoverCodexCommands({ appServer: false })).toEqual([]);
  });
});

describe("isCodexAppServerCommand", () => {
  it("recognizes every advertised command", () => {
    for (const command of CODEX_APP_SERVER_COMMANDS) {
      expect(isCodexAppServerCommand(command)).toBe(true);
    }
  });

  it("rejects unknown and slash-prefixed names", () => {
    expect(isCodexAppServerCommand("unknown")).toBe(false);
    expect(isCodexAppServerCommand("/compact")).toBe(false);
    expect(isCodexAppServerCommand("")).toBe(false);
  });
});
