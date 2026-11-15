import { describe, it, expect } from "vitest";
import type { RuntimeUserMessageInput } from "../contracts.js";
import { opencodeRuntime, parseSoloRuntimeCommand } from "./runtime.js";

function message(
  contentText: string,
  overrides?: Partial<RuntimeUserMessageInput>,
): RuntimeUserMessageInput {
  return {
    id: "msg_1",
    createdAt: 1,
    contentText,
    attachments: [],
    ...overrides,
  };
}

describe("parseSoloRuntimeCommand", () => {
  it("parses a solo runtime command into name and arguments", () => {
    const prepared = parseSoloRuntimeCommand([
      message("/commit -m fix", { runtimeCommand: true }),
    ]);

    expect(prepared).toEqual({
      prompt: "/commit -m fix",
      inputFormat: "prompt",
      runtimeCommand: { command: "commit", arguments: "-m fix" },
    });
  });

  it("omits arguments for a bare command", () => {
    const prepared = parseSoloRuntimeCommand([
      message("/init", { runtimeCommand: true }),
    ]);

    expect(prepared?.runtimeCommand).toEqual({ command: "init" });
  });

  it("returns null for multi-message runs and unflagged messages", () => {
    expect(
      parseSoloRuntimeCommand([
        message("/commit", { runtimeCommand: true }),
        message("also do this"),
      ]),
    ).toBeNull();
    expect(parseSoloRuntimeCommand([message("/commit")])).toBeNull();
    expect(
      parseSoloRuntimeCommand([message("/", { runtimeCommand: true })]),
    ).toBeNull();
  });
});

describe("opencodeRuntime.prepareRunExecution", () => {
  it("prepares a runtime-command execution for a solo flagged message", async () => {
    const prepared = await opencodeRuntime.prepareRunExecution({
      messages: [message("/commit -m fix", { runtimeCommand: true })],
    });

    expect(prepared.runtimeCommand).toEqual({
      command: "commit",
      arguments: "-m fix",
    });
    expect(prepared.prompt).toBe("/commit -m fix");
  });

  it("keeps the run envelope for regular messages", async () => {
    const prepared = await opencodeRuntime.prepareRunExecution({
      messages: [message("hello"), message("world")],
    });

    expect(prepared.runtimeCommand).toBeUndefined();
    expect(prepared.prompt).toContain("Convoy user messages for this run:");
  });
});
