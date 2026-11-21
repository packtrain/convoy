import { describe, expect, test } from "vitest";
import { getAntigravitySlashCommandsFromIncomingChunks } from "./slashCommands";

const commandsUpdate = (availableCommands: unknown) => ({
  type: "session/update",
  data: JSON.stringify({ sessionId: "s-1", update: { sessionUpdate: "available_commands_update", availableCommands } }),
});

describe("getAntigravitySlashCommandsFromIncomingChunks", () => {
  test("reads agy's own command update, with the input hint as the argument hint", () => {
    // Shapes from agy 1.5.13; `input.hint` and `logout` are t3code's.
    const chunks = [
      { type: "convoy/acp_session", data: JSON.stringify({ sessionId: "s-1" }) },
      commandsUpdate([
        { name: "compact", description: "Compact the conversation now." },
        { name: "goal", description: "Run until the goal is finished.", input: { hint: "<goal>" } },
        { name: "logout", description: "Sign out." },
        { name: "" },
        "junk",
      ]),
    ];
    expect(getAntigravitySlashCommandsFromIncomingChunks(chunks)).toEqual([
      { name: "compact", description: "Compact the conversation now." },
      { name: "goal", description: "Run until the goal is finished.", argumentHint: "<goal>" },
    ]);
  });

  test("the last update in a batch wins, and an empty list clears the commands", () => {
    expect(getAntigravitySlashCommandsFromIncomingChunks([commandsUpdate([{ name: "plan" }]), commandsUpdate([])])).toEqual([]);
  });

  test("returns null when no chunk carries the update", () => {
    const other = { type: "session/update", data: JSON.stringify({ update: { sessionUpdate: "usage_update", used: 1, size: 2 } }) };
    expect(getAntigravitySlashCommandsFromIncomingChunks([other, { type: "session/update", data: "{" }])).toBeNull();
  });
});
