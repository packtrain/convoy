import { describe, expect, it } from "vitest";
import {
  threadIdentityInstruction,
  withFirstMessageAgentInstructions,
  withRunAttachmentInstructions,
} from "./agent-instructions.js";

const THREAD_ID = "k17thread";
const IDENTITY_LINE = threadIdentityInstruction(THREAD_ID);

describe("threadIdentityInstruction", () => {
  it("names the thread id", () => {
    expect(IDENTITY_LINE).toContain(THREAD_ID);
  });
});

describe("withFirstMessageAgentInstructions", () => {
  it("delivers a recovered working directory on resumed sessions", () => {
    expect(withFirstMessageAgentInstructions("Continue", {
      continuationId: "existing", threadId: THREAD_ID, workspaceNotice: "The working directory is now /workspace.",
    })).toBe("The working directory is now /workspace.\n\nContinue");
  });
  it("prepends the delimited agent block and identity line on a fresh session", () => {
    const result = withFirstMessageAgentInstructions("Fix the bug", {
      agentPrompt: "You are a meticulous reviewer.",
      agentName: "Reviewer",
      threadId: THREAD_ID,
    });

    expect(result).toBe(
      [
        '<agent-instructions agent="Reviewer">',
        "You are a meticulous reviewer.",
        "</agent-instructions>",
        "",
        IDENTITY_LINE,
        "",
        "Fix the bug",
      ].join("\n"),
    );
  });

  it("omits the agent attribute when no agent name is available", () => {
    const result = withFirstMessageAgentInstructions("Hello", {
      agentPrompt: "Be terse.",
      threadId: THREAD_ID,
    });

    expect(result).toBe(
      [
        "<agent-instructions>",
        "Be terse.",
        "</agent-instructions>",
        "",
        IDENTITY_LINE,
        "",
        "Hello",
      ].join("\n"),
    );
  });

  it("does not inject on resumed runtime sessions", () => {
    const result = withFirstMessageAgentInstructions("Hello", {
      agentPrompt: "Be terse.",
      agentName: "Reviewer",
      continuationId: "ses_1",
      threadId: THREAD_ID,
    });

    expect(result).toBe("Hello");
  });

  it("injects the identity line without an agent prompt (OS-1223)", () => {
    expect(
      withFirstMessageAgentInstructions("Hello", {
        agentName: "Reviewer",
        threadId: THREAD_ID,
      }),
    ).toBe([IDENTITY_LINE, "", "Hello"].join("\n"));
    expect(withFirstMessageAgentInstructions("Hello", { threadId: THREAD_ID })).toBe(
      [IDENTITY_LINE, "", "Hello"].join("\n"),
    );
  });

  it("keeps the block readable when the agent name contains quotes", () => {
    const result = withFirstMessageAgentInstructions("Hello", {
      agentPrompt: "Be terse.",
      agentName: 'The "Reviewer"',
      threadId: THREAD_ID,
    });

    expect(result.startsWith("<agent-instructions agent=\"The 'Reviewer'\">")).toBe(
      true,
    );
  });
});

describe("withRunAttachmentInstructions (OS-2091)", () => {
  const ids = { threadId: "thr_1", messageId: "msg_reply", sessionId: "ses_1" };
  const command = "convoy threads attach thr_1 <file...> --message-id msg_reply --session-id ses_1";

  it("appends the attach command with this run's ids to a text prompt", () => {
    const prepared = withRunAttachmentInstructions({ prompt: "Take a screenshot", inputFormat: "prompt" }, ids);

    expect(prepared.inputFormat).toBe("prompt");
    expect(prepared.prompt.startsWith("Take a screenshot\n\n")).toBe(true);
    expect(prepared.prompt).toContain(command);
    expect(prepared.prompt).not.toContain("convoy browser");
    expect(prepared.prompt).toContain("Convoy skill's inline HTML guide");
    // The footer names the checks command, so "run the checks" needs no other context (OS-2291).
    expect(prepared.prompt).toContain("--check <key>");
    expect(prepared.prompt).toContain("`convoy threads checks thr_1`");
  });

  it("adds the command to Claude's structured input, which replaces the text prompt", () => {
    const frame = { type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } };
    const prepared = withRunAttachmentInstructions({ prompt: "hi", inputFormat: "stream-json", bootstrapInput: [frame] }, ids);

    const content = (prepared.bootstrapInput?.[0] as typeof frame).message.content;
    expect(content[0]).toEqual({ type: "text", text: "hi" });
    expect(content[1]?.text).toContain(command);
    expect(content[1]?.text).not.toContain("convoy browser");
    expect(content[1]?.text).toContain("Convoy skill's inline HTML guide");
    // The caller's frame is not mutated, so a retried preparation is not doubled.
    expect(frame.message.content).toHaveLength(1);
  });

  it("keeps a frame's string content whole, as a text block before the command", () => {
    const frame = { type: "user", message: { role: "user", content: "hi" } };
    const prepared = withRunAttachmentInstructions({ prompt: "hi", inputFormat: "stream-json", bootstrapInput: [frame] }, ids);

    const content = (prepared.bootstrapInput?.[0] as { message: { content: Array<{ type: string; text: string }> } }).message.content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "hi" });
    expect(content[1]?.text).toContain(command);
    expect(content[1]?.text).not.toContain("convoy browser");
    expect(content[1]?.text).toContain("Convoy skill's inline HTML guide");
  });
});
