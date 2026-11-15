import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRunnerForCliType,
  getAgentPromptDelivery,
  getChunkStreamPolicy,
  normalizeCliRuntimeModel,
  prepareRunExecution,
} from "./registry.js";

describe("agentPromptDelivery", () => {
  it("declares a delivery mode for every runtime", () => {
    expect(getAgentPromptDelivery("claude-code")).toBe("system-append");
    expect(getAgentPromptDelivery("codex")).toBe("system-append");
    expect(getAgentPromptDelivery("opencode")).toBe("first-message");
    expect(getAgentPromptDelivery("cursor")).toBe("first-message");
  });

  it("returns undefined for unknown cli types", () => {
    expect(getAgentPromptDelivery("droid")).toBeUndefined();
  });
});

describe("sandbox support (OS-1242)", () => {
  it("fails runs fast on runtimes without OS sandbox support", async () => {
    for (const cliType of ["cursor", "opencode"]) {
      const runner = createRunnerForCliType(cliType, {
        sandbox: { writableRoots: ["/repos/a"] },
      });
      expect(runner).not.toBeNull();
      const execution = runner!.execute("/repos/a", "prompt", {
        threadId: "thread_test",
        cliType,
      });
      await expect(execution.next()).rejects.toThrow(/does not support OS sandboxing/);
    }
  });
});

describe("prepareRunExecution", () => {
  it("adds the pr(github) line after the task line", async () => {
    const result = await prepareRunExecution("codex", {
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          taskRef: "OS-123",
          pullRequest: { owner: "contoso", name: "convoy", number: 482 },
          contentText: "Review this PR",
          attachments: [],
        },
      ],
    });

    expect(result.prompt).toContain(
      "task(convoy): OS-123\npr(github): contoso/convoy#482 https://github.com/contoso/convoy/pull/482\ncontent:"
    );
  });

  it("adds task(convoy) marker for generic runtimes", async () => {
    const result = await prepareRunExecution("codex", {
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          taskRef: "OS-123",
          contentText: "Review this change",
          attachments: [],
        },
      ],
    });

    expect(result.prompt).toContain("task(convoy): OS-123");
    expect(result.prompt).toContain("content:\nReview this change");
  });

  it("formats opencode runs through the shared message format", async () => {
    const result = await prepareRunExecution("opencode", {
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          contentText: "Hello",
          attachments: [],
        },
      ],
    });

    expect(result.inputFormat).toBe("prompt");
    expect(result.prompt).toContain("content:\nHello");
  });
});

describe("cursor runtime registration", () => {
  it("creates a runner for the cursor cliType", () => {
    expect(createRunnerForCliType("cursor", {})).not.toBeNull();
  });

  it("normalizes cursor models to the curated slots", () => {
    expect(normalizeCliRuntimeModel("cursor", "default")).toBe("default");
    expect(normalizeCliRuntimeModel("cursor", "claude-sonnet-5")).toBe(
      "claude-sonnet-5",
    );
    expect(normalizeCliRuntimeModel("cursor", "sonnet-4")).toBeUndefined();
  });

  it("delivers a solo runtime command as the raw prompt", async () => {
    const result = await prepareRunExecution("cursor", {
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          contentText: "/plan refactor the parser ",
          runtimeCommand: true,
          attachments: [],
        },
      ],
    });

    expect(result.prompt).toBe("/plan refactor the parser");
    expect(result.runtimeCommand).toBeUndefined();
  });

  it("formats multi-message cursor runs through the shared envelope", async () => {
    const result = await prepareRunExecution("cursor", {
      messages: [
        {
          id: "msg_1",
          createdAt: Date.UTC(2026, 2, 19, 10, 0, 0),
          contentText: "Hello",
          attachments: [],
        },
        {
          id: "msg_2",
          createdAt: Date.UTC(2026, 2, 19, 10, 1, 0),
          contentText: "/plan not-a-solo-command",
          attachments: [],
        },
      ],
    });

    expect(result.prompt).toContain("Convoy user messages for this run:");
    expect(result.prompt).toContain("content:\nHello");
  });

  it("exposes a chunk stream policy that defers cursor micro-chunks", () => {
    const policy = getChunkStreamPolicy("cursor");
    expect(policy).not.toBeNull();
    expect(policy?.isDeferrable({ type: "assistant", data: "{}" })).toBe(true);
    expect(policy?.isDeferrable({ type: "result", data: "{}" })).toBe(false);
  });
});

describe("opencode runtime registration", () => {
  it("creates a runner for the opencode cliType", () => {
    expect(createRunnerForCliType("opencode", {})).not.toBeNull();
  });

  it("normalizes opencode models to the default slot or provider/model slugs", () => {
    expect(normalizeCliRuntimeModel("opencode", "default")).toBe("default");
    expect(normalizeCliRuntimeModel("opencode", "anthropic/claude-sonnet-5")).toBe(
      "anthropic/claude-sonnet-5",
    );
    expect(normalizeCliRuntimeModel("opencode", "opus")).toBeUndefined();
  });

  it("exposes a chunk stream policy that defers opencode deltas", () => {
    const policy = getChunkStreamPolicy("opencode");
    expect(policy).not.toBeNull();
    expect(
      policy?.isDeferrable({ type: "text.delta", data: "{}" }),
    ).toBe(true);
    expect(
      policy?.isDeferrable({ type: "message.part.updated", data: "{}" }),
    ).toBe(false);

    const merged = policy?.coalesce(
      {
        type: "text.delta",
        data: JSON.stringify({ sessionID: "s", partID: "p", text: "he" }),
      },
      {
        type: "text.delta",
        data: JSON.stringify({ sessionID: "s", partID: "p", text: "llo" }),
      },
    );
    expect(merged).toEqual({
      type: "text.delta",
      data: JSON.stringify({ sessionID: "s", partID: "p", text: "hello" }),
    });

    expect(
      policy?.coalesce(
        {
          type: "text.delta",
          data: JSON.stringify({ sessionID: "s", partID: "p1", text: "a" }),
        },
        {
          type: "text.delta",
          data: JSON.stringify({ sessionID: "s", partID: "p2", text: "b" }),
        },
      ),
    ).toBeNull();
  });
});

describe("codex runtime registration", () => {
  it("exposes a chunk stream policy that defers codex deltas (OS-1761)", () => {
    const policy = getChunkStreamPolicy("codex");
    expect(policy).not.toBeNull();
    expect(
      policy?.isDeferrable({ type: "item/agentMessage/delta", data: "{}" }),
    ).toBe(true);
    expect(policy?.isDeferrable({ type: "item/completed", data: "{}" })).toBe(
      false,
    );
  });
});


describe("project runtime detection", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("rejects an undetected runtime through execution rather than throwing during dispatch", async () => {
    vi.stubEnv("CONVOY_PROJECT_IDENTITY", "a".repeat(64));
    vi.stubEnv("CONVOY_PROJECT_RUNTIMES", "codex");
    const runner = createRunnerForCliType("claude-code", {});
    expect(runner).not.toBeNull();
    await expect(runner!.execute("/tmp", "hello", { threadId: "a", cliType: "claude-code" }).next()).rejects.toThrow(/claude-code is not available in this project/);
    expect(createRunnerForCliType("codex", {})).not.toBeNull();
  });
  it("fails closed when the launcher detected no runtime", async () => {
    vi.stubEnv("CONVOY_PROJECT_IDENTITY", "a".repeat(64));
    vi.stubEnv("CONVOY_PROJECT_RUNTIMES", "");
    const runner = createRunnerForCliType("codex", {});
    await expect(runner!.execute("/tmp", "hello", { threadId: "a", cliType: "codex" }).next()).rejects.toThrow(/not available/);
  });
});
