import { describe, it, expect } from "vitest";
import type { RuntimeUserMessageInput } from "../contracts.js";
import { codexRuntime, parseSoloCodexCommand } from "./runtime.js";

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

describe("codexRuntime.prepareRunExecution", () => {
  it("includes attachment local-path context lines (OS-1392)", async () => {
    const prepared = await codexRuntime.prepareRunExecution({
      messages: [
        message("check this file", {
          attachments: [
            {
              storageId: "st_1",
              fileName: "report.pdf",
              contentType: "application/pdf",
              localPath: "/tmp/cache/report.pdf",
              inlineImage: false,
            },
          ],
        }),
      ],
    });

    expect(prepared.prompt).toContain("attachments:");
    expect(prepared.prompt).toContain(
      "- report.pdf (application/pdf): /tmp/cache/report.pdf",
    );
  });

  it("delivers a solo /compact as a runtime command, not a wrapped run (OS-1582)", async () => {
    const prepared = await codexRuntime.prepareRunExecution({
      messages: [message("/compact", { runtimeCommand: true })],
    });

    expect(prepared.runtimeCommand).toEqual({ command: "compact" });
    // The run envelope is what made the model read "/compact" as prose.
    expect(prepared.prompt).toBe("/compact");
    expect(prepared.prompt).not.toContain("Convoy user messages for this run:");
    expect(prepared.prompt).not.toContain("--- user-message-1 ---");
  });

  it("delivers a solo /goal with its objective as a runtime command (OS-2277)", async () => {
    const prepared = await codexRuntime.prepareRunExecution({
      messages: [message("/goal count.txt contains\nthe number 3", { runtimeCommand: true })],
    });

    expect(prepared.runtimeCommand).toEqual({ command: "goal", arguments: "count.txt contains\nthe number 3" });
  });

  it("wraps unsupported commands as prose so codex can reject them", async () => {
    const prepared = await codexRuntime.prepareRunExecution({
      messages: [message("/some-custom-prompt", { runtimeCommand: true })],
    });

    expect(prepared.runtimeCommand).toBeUndefined();
    expect(prepared.prompt).toContain("Convoy user messages for this run:");
  });
});

describe("parseSoloCodexCommand", () => {
  it("routes /usage without a model prompt envelope", () => {
    expect(parseSoloCodexCommand([message("/usage", { runtimeCommand: true })])?.runtimeCommand)
      .toEqual({ command: "usage" });
  });

  it("parses a supported command", () => {
    expect(
      parseSoloCodexCommand([message("/compact", { runtimeCommand: true })]),
    ).toEqual({
      prompt: "/compact",
      inputFormat: "prompt",
      runtimeCommand: { command: "compact" },
    });
  });

  it("keeps trailing arguments", () => {
    expect(
      parseSoloCodexCommand([
        message("/compact focus on the API", { runtimeCommand: true }),
      ])?.runtimeCommand,
    ).toEqual({ command: "compact", arguments: "focus on the API" });
  });

  it("returns null for unflagged, multi-message, and unknown commands", () => {
    expect(parseSoloCodexCommand([message("/compact")])).toBeNull();
    expect(
      parseSoloCodexCommand([
        message("/compact", { runtimeCommand: true }),
        message("and also this"),
      ]),
    ).toBeNull();
    expect(
      parseSoloCodexCommand([message("/", { runtimeCommand: true })]),
    ).toBeNull();
    expect(
      parseSoloCodexCommand([message("/unknown", { runtimeCommand: true })]),
    ).toBeNull();
  });

  it("does not treat prose mentioning a command as a command", () => {
    expect(
      parseSoloCodexCommand([
        message("please run /compact for me", { runtimeCommand: true }),
      ]),
    ).toBeNull();
  });
});
