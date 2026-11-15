import { describe, expect, test } from "vitest";
import type { DynamicToolUIPart } from "ai";
import { applyRowsToComposer, hideUnanchoredTaskGroups, initComposerFromStore } from "./composer";
import { initFromSnapshot } from "./event-store";
import { summarizeTaskNoticeGroup } from "./runtime-notices";
import type { NormalizedChunkRow, ComposerState, TaskNoticeGroupPart } from "./types";
import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import type { Id } from "@/convex/_generated/dataModel";

function cliMessageId(value: string): Id<"cliMessages"> {
  return value as Id<"cliMessages">;
}

function cliThreadId(value: string): Id<"cliThreads"> {
  return value as Id<"cliThreads">;
}

function makeRow(
  messageIdValue: string,
  chunkOrder: number,
  event: CliNormalizedEvent,
  timestamp?: number
): NormalizedChunkRow {
  return {
    messageId: cliMessageId(messageIdValue),
    threadId: cliThreadId("thread-1"),
    createdAt: 1000 + chunkOrder,
    chunkOrder,
    timestamp: timestamp ?? 1000 + chunkOrder,
    event,
  };
}

function emptyComposer(): ComposerState {
  return { messages: new Map() };
}

describe("sleep events", () => {
  const start: CliNormalizedEvent = { kind: "sleep", phase: "started", itemId: "s1", turnId: "t1", sessionId: "c1", durationMs: 30_000, startedAt: 1_000 };
  const end: CliNormalizedEvent = { ...start, phase: "completed", startedAt: undefined, completedAt: 32_000 };

  test("replaces a matched start in place without mutating the previous snapshot", () => {
    const initial = applyRowsToComposer(emptyComposer(), [makeRow("m", 0, start)]);
    const next = applyRowsToComposer(initial, [makeRow("m", 1, { kind: "text", text: "Checking" }), makeRow("m", 2, end)]);
    expect(next.messages.get("m")?.parts).toEqual([
      { type: "sleep", state: "completed", itemId: "s1", turnId: "t1", sessionId: "c1", durationMs: 30_000, startedAt: 1_000, completedAt: 32_000 },
      { type: "text", text: "Checking" },
    ]);
    expect(initial.messages.get("m")?.parts[0]).toMatchObject({ state: "sleeping" });
  });

  test("retains completed state through repeated and out-of-order lifecycle events", () => {
    const state = applyRowsToComposer(emptyComposer(), [end, end, start, start].map((event, i) => makeRow("m", i, event)));
    expect(state.messages.get("m")?.parts).toHaveLength(1);
    expect(state.messages.get("m")?.parts[0]).toMatchObject({ state: "completed", startedAt: 1_000, completedAt: 32_000 });
  });

  test.each([
    { itemId: "s2" }, { turnId: "t2" }, { sessionId: "c2" }, { itemId: undefined },
  ])("does not pair unrelated or unidentified sleep events: %j", (identity) => {
    const state = applyRowsToComposer(emptyComposer(), [makeRow("m", 0, start), makeRow("m", 1, { ...end, ...identity })]);
    expect(state.messages.get("m")?.parts).toHaveLength(2);
    expect(state.messages.get("m")?.parts[0]).toMatchObject({ state: "sleeping" });
    expect(state.messages.get("m")?.parts[1]).toMatchObject({ state: "completed" });
  });

  test("does not invent start timing from receipt time or requested duration", () => {
    const state = applyRowsToComposer(emptyComposer(), [makeRow("m", 0, end, 99_000)]);
    expect(state.messages.get("m")?.parts[0]).toMatchObject({ type: "sleep", state: "completed", completedAt: 32_000 });
    expect(state.messages.get("m")?.parts[0]).not.toHaveProperty("startedAt", expect.any(Number));
  });

  test("settles only sleeps belonging to an explicitly interrupted turn", () => {
    const state = applyRowsToComposer(emptyComposer(), [
      makeRow("m", 0, start),
      makeRow("m", 1, { ...start, turnId: "t2" }),
      makeRow("m", 2, { kind: "metadata", otherJson: JSON.stringify({ event: "turn/completed", status: "interrupted", turnId: "t1", sessionId: "c1" }) }),
    ]);
    expect(state.messages.get("m")?.parts).toMatchObject([{ state: "interrupted" }, { state: "sleeping" }]);
  });
});

describe("composer", () => {
  describe("text concatenation", () => {
    test("consecutive text events merge into one TextUIPart", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "text", text: "Hello " }),
        makeRow("msg-1", 1, { kind: "text", text: "world" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0]).toEqual({ type: "text", text: "Hello world" });
    });

    test("text after non-text creates a new TextUIPart", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "text", text: "First" }),
        makeRow("msg-1", 1, { kind: "reasoning", text: "Think" }),
        makeRow("msg-1", 2, { kind: "text", text: "Second" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(3);
      expect(msg.parts[0]).toEqual({ type: "text", text: "First" });
      expect(msg.parts[1]).toEqual({ type: "reasoning", text: "Think" });
      expect(msg.parts[2]).toEqual({ type: "text", text: "Second" });
    });
  });

  describe("usage-limit escalation", () => {
    function usageEvent(
      utilization: number,
      overrides: Partial<Extract<CliNormalizedEvent, { kind: "usage-limit" }>> = {}
    ): CliNormalizedEvent {
      return { kind: "usage-limit", window: "5h", utilization, ...overrides };
    }

    function noticeParts(state: ComposerState, messageId: string) {
      return state.messages
        .get(messageId)!
        .parts.filter((part) => part.type === "runtime-notice");
    }

    test("below the warning threshold nothing renders inline", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, usageEvent(0.5)),
      ]);
      expect(state.messages.get("msg-1")!.parts).toEqual([]);
    });

    test("crossing into warning emits one notice; repeats at the same tier stay silent", () => {
      let state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, usageEvent(0.5)),
        makeRow("msg-1", 1, usageEvent(0.85)),
        makeRow("msg-1", 2, usageEvent(0.9)),
      ]);

      expect(noticeParts(state, "msg-1")).toHaveLength(1);
      expect(noticeParts(state, "msg-1")[0]).toMatchObject({
        code: "usage-limit",
        message: "Approaching the 5h limit — 85% used.",
      });

      // Escalation state carries across incremental batches and messages.
      state = applyRowsToComposer(state, [
        makeRow("msg-2", 0, usageEvent(0.91)),
        makeRow("msg-2", 1, usageEvent(0.97)),
      ]);
      expect(noticeParts(state, "msg-2")).toHaveLength(1);
      expect(noticeParts(state, "msg-2")[0]).toMatchObject({
        message: "The 5h limit is nearly exhausted — 97% used.",
      });
    });

    test("overage escalations mention overage", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, usageEvent(0.99, { isUsingOverage: true })),
      ]);
      expect(noticeParts(state, "msg-1")[0]).toMatchObject({
        message: "Over the 5h limit — using overage (99% used).",
      });
    });

    test("windows escalate independently", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, usageEvent(0.9)),
        makeRow("msg-1", 1, usageEvent(0.9, { window: "weekly" })),
      ]);
      expect(noticeParts(state, "msg-1")).toHaveLength(2);
    });

    test("de-escalation stays silent", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, usageEvent(0.9)),
        makeRow("msg-1", 1, usageEvent(0.2)),
        makeRow("msg-1", 2, usageEvent(0.85)),
      ]);
      // Initial warning + re-escalation after dropping back to none.
      expect(noticeParts(state, "msg-1")).toHaveLength(2);
    });
  });

  describe("partial-streaming delta merge", () => {
    test("consecutive text-deltas grow one text part", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "text-delta", text: "Hel" }),
        makeRow("msg-1", 1, { kind: "text-delta", text: "lo" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toEqual([{ type: "text", text: "Hello" }]);
    });

    test("final text replaces the streamed delta parts (no duplication)", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "reasoning-delta", text: "Think" }),
        makeRow("msg-1", 1, { kind: "reasoning-delta", text: "ing..." }),
        makeRow("msg-1", 2, { kind: "text-delta", text: "Hel" }),
        makeRow("msg-1", 3, { kind: "text-delta", text: "lo" }),
        // Whole assistant message follows the deltas it supersedes.
        makeRow("msg-1", 4, { kind: "reasoning", text: "Thinking..." }),
        makeRow("msg-1", 5, { kind: "text", text: "Hello" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toEqual([
        { type: "reasoning", text: "Thinking..." },
        { type: "text", text: "Hello" },
      ]);
    });

    test("final tool-input clears delta parts and later deltas stream the next block", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "text-delta", text: "Let me check" }),
        makeRow("msg-1", 1, { kind: "text", text: "Let me check" }),
        makeRow("msg-1", 2, {
          kind: "tool-input",
          toolCallId: "toolu_1",
          toolName: "Grep",
          inputJson: "{}",
        }),
        makeRow("msg-1", 3, { kind: "text-delta", text: "Found " }),
        makeRow("msg-1", 4, { kind: "text-delta", text: "it" }),
        makeRow("msg-1", 5, { kind: "text", text: "Found it" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(3);
      expect(msg.parts[0]).toEqual({ type: "text", text: "Let me check" });
      expect(msg.parts[1]).toMatchObject({
        type: "dynamic-tool",
        toolCallId: "toolu_1",
      });
      expect(msg.parts[2]).toEqual({ type: "text", text: "Found it" });
    });

    test("tool part index survives delta part removal", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "toolu_1",
          toolName: "Grep",
          inputJson: "{}",
        }),
        makeRow("msg-1", 1, { kind: "text-delta", text: "partial" }),
        makeRow("msg-1", 2, { kind: "text", text: "final" }),
        makeRow("msg-1", 3, {
          kind: "tool-output",
          toolCallId: "toolu_1",
          outputJson: JSON.stringify({ ok: true }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      const toolPart = msg.parts[0] as DynamicToolUIPart;
      expect(toolPart.type).toBe("dynamic-tool");
      expect(toolPart.state).toBe("output-available");
      expect(msg.parts[1]).toEqual({ type: "text", text: "final" });
      expect(msg.warnings).toEqual([]);
    });

    test("delta merge works across incremental applyRowsToComposer batches", () => {
      let state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, { kind: "text-delta", text: "Hel" }),
      ]);
      state = applyRowsToComposer(state, [
        makeRow("msg-1", 1, { kind: "text-delta", text: "lo" }),
      ]);
      state = applyRowsToComposer(state, [
        makeRow("msg-1", 2, { kind: "text", text: "Hello" }),
      ]);

      const msg = state.messages.get("msg-1")!;
      expect(msg.parts).toEqual([{ type: "text", text: "Hello" }]);
    });
  });

  describe("reasoning concatenation", () => {
    test("consecutive reasoning events merge into one ReasoningUIPart", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "reasoning", text: "Step 1. " }),
        makeRow("msg-1", 1, { kind: "reasoning", text: "Step 2." }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0]).toEqual({
        type: "reasoning",
        text: "Step 1. Step 2.",
      });
    });
  });

  describe("tool state machine", () => {
    test("tool-input creates DynamicToolUIPart with state: input-available", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "tool-1",
          toolName: "Grep",
          inputJson: JSON.stringify({ pattern: "foo" }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;
      const part = msg.parts[0] as DynamicToolUIPart;

      expect(part.type).toBe("dynamic-tool");
      expect(part.toolName).toBe("Grep");
      expect(part.toolCallId).toBe("tool-1");
      expect(part.state).toBe("input-available");
      expect(part.input).toEqual({ pattern: "foo" });
    });

    test("tool-output transitions tool to output-available", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "tool-1",
          toolName: "Grep",
          inputJson: "{}",
        }),
        makeRow("msg-1", 1, {
          kind: "tool-output",
          toolCallId: "tool-1",
          outputJson: JSON.stringify({ files: ["a.ts"] }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;
      const part = msg.parts[0] as DynamicToolUIPart;

      expect(part.state).toBe("output-available");
      expect((part as DynamicToolUIPart & { output: unknown }).output).toEqual({
        files: ["a.ts"],
      });
    });

    test("tool-error transitions tool to output-error", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "tool-1",
          toolName: "Bash",
          inputJson: "{}",
        }),
        makeRow("msg-1", 1, {
          kind: "tool-error",
          toolCallId: "tool-1",
          errorText: "Permission denied",
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;
      const part = msg.parts[0] as DynamicToolUIPart;

      expect(part.state).toBe("output-error");
      expect(
        (part as DynamicToolUIPart & { errorText: string }).errorText
      ).toBe("Permission denied");
    });

    test("tool-output for unknown toolCallId adds warning", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-output",
          toolCallId: "missing-tool",
          outputJson: "{}",
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(0);
      expect(msg.warnings).toContain(
        "tool-output for unknown toolCallId: missing-tool"
      );
    });

    test("tool-error for unknown toolCallId adds warning", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-error",
          toolCallId: "missing-tool",
          errorText: "err",
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.warnings).toContain(
        "tool-error for unknown toolCallId: missing-tool"
      );
    });

    test("sub-agent child tool events are grouped under the parent task card", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "toolu_parent_1",
          toolName: "Task",
          inputJson: JSON.stringify({
            description: "Explore thread image handling",
            prompt: "Explore how image attachments are currently handled in threads.",
            subagent_type: "Explore",
          }),
        }),
        makeRow("msg-1", 1, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              type: "system",
              subtype: "task_started",
              task_id: "task-1",
              tool_use_id: "toolu_parent_1",
              description: "Explore thread image handling",
              task_type: "local_agent",
            },
          }),
        }),
        makeRow("msg-1", 2, {
          kind: "tool-input",
          toolCallId: "toolu_child_1",
          toolName: "Glob",
          inputJson: JSON.stringify({
            pattern: "apps/web/components/blocks/**/*(thread|chat|cli|message)*",
          }),
          parentToolUseId: "toolu_parent_1",
        }),
        makeRow("msg-1", 3, {
          kind: "unknown",
          reason: "no-recognized-content-blocks",
          rawType: "user",
          rawData: JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Explore how image attachments are currently handled in threads.",
                },
              ],
            },
            parent_tool_use_id: "toolu_parent_1",
          }),
        }),
        makeRow("msg-1", 4, {
          kind: "tool-output",
          toolCallId: "toolu_parent_1",
          outputJson: JSON.stringify([
            {
              type: "text",
              text: "Done.",
            },
          ]),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0]).toMatchObject({
        type: "task-notice-group",
        groupKey: "task-1::toolu_parent_1",
        parentToolUseId: "toolu_parent_1",
      });
      expect(msg.warnings).toEqual([]);

      const group = msg.parts[0] as {
        type: "task-notice-group";
        taskTool?: DynamicToolUIPart;
        childToolEvents?: CliNormalizedEvent[];
      };

      expect(group.taskTool).toMatchObject({
        toolCallId: "toolu_parent_1",
        toolName: "Task",
        state: "output-available",
      });
      expect(group.childToolEvents).toEqual([
        {
          kind: "tool-input",
          toolCallId: "toolu_child_1",
          toolName: "Glob",
          inputJson: JSON.stringify({
            pattern: "apps/web/components/blocks/**/*(thread|chat|cli|message)*",
          }),
          parentToolUseId: "toolu_parent_1",
        },
      ]);
    });

    test("Agent parent tools are grouped into the task notice card", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "toolu_agent_parent_1",
          toolName: "Agent",
          inputJson: JSON.stringify({
            description: "Explore plan mode in threads",
            prompt: "Inspect how thread mode is stored and used.",
            subagent_type: "Explore",
          }),
        }),
        makeRow("msg-1", 1, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              type: "system",
              subtype: "task_started",
              task_id: "task-1",
              tool_use_id: "toolu_agent_parent_1",
              description: "Explore plan mode in threads",
            },
          }),
        }),
        makeRow("msg-1", 2, {
          kind: "tool-output",
          toolCallId: "toolu_agent_parent_1",
          outputJson: JSON.stringify([{ type: "text", text: "Done." }]),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(1);
      const group = msg.parts[0] as TaskNoticeGroupPart;
      expect(group).toMatchObject({
        type: "task-notice-group",
        parentToolUseId: "toolu_agent_parent_1",
      });
      expect(group.taskTool).toMatchObject({
        toolCallId: "toolu_agent_parent_1",
        toolName: "Agent",
        state: "output-available",
      });
      expect(summarizeTaskNoticeGroup(group)).toMatchObject({
        title: "Explore plan mode in threads",
        prompt: "Inspect how thread mode is stored and used.",
        status: "completed",
      });
    });

    test("nested local bash task notices stay inside the parent task group", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "toolu_parent_1",
          toolName: "Task",
          inputJson: JSON.stringify({
            description: "Explore thread handling",
            prompt: "Inspect the thread UI flow.",
          }),
        }),
        makeRow("msg-1", 1, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              task_id: "task-parent",
              tool_use_id: "toolu_parent_1",
              description: "Explore thread handling",
            },
          }),
        }),
        makeRow("msg-1", 2, {
          kind: "tool-input",
          toolCallId: "toolu_child_bash_1",
          toolName: "Bash",
          inputJson: JSON.stringify({
            command: 'find /workspace -type f -name "schema.ts" | head -20',
          }),
          parentToolUseId: "toolu_parent_1",
        }),
        makeRow("msg-1", 3, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              task_id: "task-child",
              tool_use_id: "toolu_child_bash_1",
              description: 'find /workspace -type f -name "schema.ts" | head -20',
              task_type: "local_bash",
            },
          }),
        }),
        makeRow("msg-1", 4, {
          kind: "tool-output",
          toolCallId: "toolu_child_bash_1",
          outputJson: JSON.stringify("/workspace/apps/web/convex/schema.ts"),
        }),
        makeRow("msg-1", 5, {
          kind: "runtime-notice",
          code: "claude-system-task_notification",
          title: "Claude runtime notice",
          message: "Claude reported task_notification.",
          detailsJson: JSON.stringify({
            subtype: "task_notification",
            payload: {
              task_id: "task-child",
              tool_use_id: "toolu_child_bash_1",
              status: "completed",
              summary: 'find /workspace -type f -name "schema.ts" | head -20',
              task_type: "local_bash",
            },
          }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(1);
      const parentGroup = msg.parts[0] as TaskNoticeGroupPart;
      expect(parentGroup.parentToolUseId).toBe("toolu_parent_1");
      expect(parentGroup.childTaskNoticeGroups).toHaveLength(1);

      const childGroup = parentGroup.childTaskNoticeGroups?.[0];
      expect(childGroup).toMatchObject({
        type: "task-notice-group",
        parentToolUseId: "toolu_child_bash_1",
      });
      expect(childGroup?.taskTool).toMatchObject({
        toolName: "Bash",
        toolCallId: "toolu_child_bash_1",
        state: "output-available",
        input: {
          command: 'find /workspace -type f -name "schema.ts" | head -20',
        },
        output: "/workspace/apps/web/convex/schema.ts",
      });
      expect(summarizeTaskNoticeGroup(childGroup!)).toMatchObject({
        title: 'find /workspace -type f -name "schema.ts" | head -20',
        status: "completed",
      });
    });

    test("local bash task notices adopt the existing top-level tool part", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "toolu_bash_1",
          toolName: "Bash",
          inputJson: JSON.stringify({
            command: "cd /workspace && pnpm web:lint 2>&1 | tail -5",
            timeout: 120000,
          }),
        }),
        makeRow("msg-1", 1, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              type: "system",
              subtype: "task_started",
              task_id: "task-bash",
              tool_use_id: "toolu_bash_1",
              description: "cd /workspace && pnpm web:lint 2>&1 | tail -5",
              task_type: "local_bash",
            },
          }),
        }),
        makeRow("msg-1", 2, {
          kind: "tool-output",
          toolCallId: "toolu_bash_1",
          outputJson: JSON.stringify("0 errors, 49 warnings"),
        }),
        makeRow("msg-1", 3, {
          kind: "runtime-notice",
          code: "claude-system-task_notification",
          title: "Claude runtime notice",
          message: "Claude reported task_notification.",
          detailsJson: JSON.stringify({
            subtype: "task_notification",
            payload: {
              type: "system",
              subtype: "task_notification",
              task_id: "task-bash",
              tool_use_id: "toolu_bash_1",
              status: "completed",
              summary: "cd /workspace && pnpm web:lint 2>&1 | tail -5",
            },
          }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(1);
      const group = msg.parts[0] as TaskNoticeGroupPart;
      expect(group).toMatchObject({
        type: "task-notice-group",
        groupKey: "task-bash::toolu_bash_1",
        parentToolUseId: "toolu_bash_1",
      });
      expect(group.taskTool).toMatchObject({
        toolName: "Bash",
        toolCallId: "toolu_bash_1",
        state: "output-available",
        input: {
          command: "cd /workspace && pnpm web:lint 2>&1 | tail -5",
          timeout: 120000,
        },
        output: "0 errors, 49 warnings",
      });
      expect(summarizeTaskNoticeGroup(group)).toMatchObject({
        title: "cd /workspace && pnpm web:lint 2>&1 | tail -5",
        status: "completed",
      });
    });

    test("failed parent task tool updates the grouped task card", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolCallId: "toolu_parent_1",
          toolName: "Task",
          inputJson: JSON.stringify({
            description: "Explore thread image handling",
          }),
        }),
        makeRow("msg-1", 1, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              type: "system",
              subtype: "task_started",
              task_id: "task-1",
              tool_use_id: "toolu_parent_1",
              description: "Explore thread image handling",
            },
          }),
        }),
        makeRow("msg-1", 2, {
          kind: "tool-error",
          toolCallId: "toolu_parent_1",
          errorText: "Sub-agent failed",
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;
      const group = msg.parts[0] as TaskNoticeGroupPart;

      expect(msg.parts).toHaveLength(1);
      expect(group.taskTool).toMatchObject({
        toolCallId: "toolu_parent_1",
        toolName: "Task",
        state: "output-error",
        errorText: "Sub-agent failed",
      });
      expect(summarizeTaskNoticeGroup(group).status).toBe("failed");
    });
  });

  describe("metadata merge", () => {
    test("merges sessionId and otherJson into metadata", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "metadata",
          sessionId: "session-abc",
          otherJson: JSON.stringify({ model: "claude-opus-4-6" }),
        }),
        makeRow("msg-1", 1, {
          kind: "metadata",
          otherJson: JSON.stringify({ totalCostUsd: 0.05 }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.metadata.sessionId).toBe("session-abc");
      expect(msg.metadata.model).toBe("claude-opus-4-6");
      expect(msg.metadata.totalCostUsd).toBe(0.05);
    });

    test("expands bundled metadata events before merging metadata", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "metadata",
          otherJson: JSON.stringify({
            events: [
              {
                kind: "metadata",
                sessionId: "session-abc",
                otherJson: JSON.stringify({
                  usage: { input_tokens: 11, output_tokens: 638 },
                  modelUsage: {
                    "us.anthropic.claude-opus-4-6-v1": {
                      contextWindow: 200000,
                    },
                  },
                }),
              },
              {
                kind: "context-window",
                usedTokens: 87009,
                maxTokens: 200000,
              },
            ],
          }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.metadata.sessionId).toBe("session-abc");
      expect(msg.metadata.usage).toEqual({ input_tokens: 11, output_tokens: 638 });
      expect(msg.metadata.modelUsage).toEqual({
        "us.anthropic.claude-opus-4-6-v1": {
          contextWindow: 200000,
        },
      });
      expect(msg.normalizedEvents).toEqual([
        {
          kind: "metadata",
          sessionId: "session-abc",
          otherJson: JSON.stringify({
            usage: { input_tokens: 11, output_tokens: 638 },
            modelUsage: {
              "us.anthropic.claude-opus-4-6-v1": {
                contextWindow: 200000,
              },
            },
          }),
        },
        {
          kind: "context-window",
          usedTokens: 87009,
          maxTokens: 200000,
        },
      ]);
    });
  });

  describe("warning collection", () => {
    test("warning events are collected", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "warning",
          code: "TRUNCATED",
          message: "Output was truncated",
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.warnings).toContain("TRUNCATED: Output was truncated");
    });

    test("warning events also surface as inline notices", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "warning",
          code: "TRUNCATED",
          message: "Output was truncated",
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toEqual([
        {
          type: "runtime-notice",
          code: "TRUNCATED",
          title: "Warning",
          message: "Output was truncated",
          debugJson: JSON.stringify(
            {
              kind: "warning",
              code: "TRUNCATED",
              message: "Output was truncated",
            },
            null,
            2
          ),
        },
      ]);
    });

    test("unknown events are collected as warnings and inline notices", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "unknown",
          reason: "unsupported-type",
          rawType: "ping",
          rawData: JSON.stringify({ type: "ping", ts: 123 }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.warnings).toContain(
        "unknown event: unsupported-type (ping)"
      );
      expect(msg.parts).toEqual([
        {
          type: "runtime-notice",
          code: "unknown-event",
          title: "Unsupported CLI event",
          message: "Received unsupported-type (ping).",
          debugJson: JSON.stringify(
            {
              rawType: "ping",
              reason: "unsupported-type",
              rawData: JSON.stringify({ type: "ping", ts: 123 }),
            },
            null,
            2
          ),
        },
      ]);
    });

    test("legacy unknown events without rawData still render an inspectable notice", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "unknown",
          reason: "unsupported-type",
          rawType: "ping",
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.warnings).toContain(
        "unknown event: unsupported-type (ping)"
      );
      expect(msg.parts).toEqual([
        {
          type: "runtime-notice",
          code: "unknown-event",
          title: "Unsupported CLI event",
          message: "Received unsupported-type (ping).",
          debugJson: JSON.stringify(
            {
              rawType: "ping",
              reason: "unsupported-type",
              rawDataMissing: true,
            },
            null,
            2
          ),
        },
      ]);
    });

    test("dedupes nested user prompt echoes when the same task prompt is already rendered", () => {
      const duplicatedPrompt =
        "Explore the development setup of this project.";
      const rows = [
        makeRow("msg-1", 0, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              type: "system",
              subtype: "task_started",
              task_id: "task-1",
              tool_use_id: "toolu_nested_1",
              description: "Explore project setup",
              prompt: duplicatedPrompt,
            },
          }),
        }),
        makeRow("msg-1", 1, {
          kind: "unknown",
          reason: "no-recognized-content-blocks",
          rawType: "user",
          rawData: JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [{ type: "text", text: duplicatedPrompt }],
            },
            parent_tool_use_id: "toolu_nested_1",
          }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(1);
      expect(msg.parts[0]).toMatchObject({
        type: "task-notice-group",
        groupKey: "task-1::toolu_nested_1",
      });
      expect(msg.warnings).toEqual([]);
    });

    test("keeps nested user prompt echoes when they do not exactly match a rendered task prompt", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              type: "system",
              subtype: "task_started",
              task_id: "task-1",
              tool_use_id: "toolu_nested_1",
              description: "Explore project setup",
              prompt: "Explore the development setup of this project.",
            },
          }),
        }),
        makeRow("msg-1", 1, {
          kind: "unknown",
          reason: "no-recognized-content-blocks",
          rawType: "user",
          rawData: JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Explore the development setup of this project in detail.",
                },
              ],
            },
            parent_tool_use_id: "toolu_nested_1",
          }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(2);
      expect(msg.parts[0]).toMatchObject({
        type: "task-notice-group",
        groupKey: "task-1::toolu_nested_1",
      });
      expect(msg.parts[1]).toEqual({
        type: "runtime-notice",
        code: "unknown-event",
        title: "Unsupported CLI event",
        message: "Received no-recognized-content-blocks (user).",
        debugJson: JSON.stringify(
          {
            rawType: "user",
            reason: "no-recognized-content-blocks",
            rawData: JSON.stringify({
              type: "user",
              message: {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: "Explore the development setup of this project in detail.",
                  },
                ],
              },
              parent_tool_use_id: "toolu_nested_1",
            }),
          },
          null,
          2
        ),
      });
      expect(msg.warnings).toContain(
        "unknown event: no-recognized-content-blocks (user)"
      );
    });

    test("runtime notices are preserved inline and separately from warnings", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "text", text: "before" }),
        makeRow("msg-1", 0, {
          kind: "runtime-notice",
          code: "claude-api-retry",
          title: "Claude API retry",
          message: "Attempt 2 of 10. Retrying in 1.2s.",
          sessionId: "session-1",
          detailsJson: JSON.stringify({
            subtype: "api_retry",
            attempt: 2,
          }),
        }),
        makeRow("msg-1", 2, { kind: "text", text: "after" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.warnings).toEqual([]);
      expect(msg.parts).toEqual([
        {
          type: "text",
          text: "before",
        },
        {
          type: "runtime-notice",
          code: "claude-api-retry",
          title: "Claude API retry",
          message: "Attempt 2 of 10. Retrying in 1.2s.",
          sessionId: "session-1",
          detailsJson: JSON.stringify({
            subtype: "api_retry",
            attempt: 2,
          }),
        },
        {
          type: "text",
          text: "after",
        },
      ]);
    });

    test("context compaction events render as inline runtime notices", () => {
      const detailsJson = JSON.stringify({
        subtype: "compact_boundary",
        payload: {
          type: "system",
          subtype: "compact_boundary",
          session_id: "session-1",
        },
      });
      const rows = [
        makeRow("msg-1", 0, { kind: "text", text: "before" }),
        makeRow("msg-1", 1, {
          kind: "context-compaction",
          message: "Context compacted.",
          sessionId: "session-1",
          detailsJson,
        }),
        makeRow("msg-1", 2, { kind: "text", text: "after" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.warnings).toEqual([]);
      expect(msg.parts).toEqual([
        { type: "text", text: "before" },
        {
          type: "runtime-notice",
          code: "context-compaction",
          title: "Context compacted",
          message: "Context compacted.",
          sessionId: "session-1",
          detailsJson,
        },
        { type: "text", text: "after" },
      ]);
    });

    test("renders bundled context compaction events while keeping context-window out of message parts", () => {
      const detailsJson = JSON.stringify({
        subtype: "compact_boundary",
        payload: {
          type: "system",
          subtype: "compact_boundary",
        },
      });
      const rows = [
        makeRow("msg-1", 0, {
          kind: "metadata",
          otherJson: JSON.stringify({
            events: [
              {
                kind: "context-compaction",
                message: "Context compacted.",
                detailsJson,
              },
              {
                kind: "context-window",
                usedTokens: 120000,
                maxTokens: 200000,
              },
            ],
          }),
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.normalizedEvents).toEqual([
        {
          kind: "context-compaction",
          message: "Context compacted.",
          detailsJson,
        },
        {
          kind: "context-window",
          usedTokens: 120000,
          maxTokens: 200000,
        },
      ]);
      expect(msg.parts).toEqual([
        {
          type: "runtime-notice",
          code: "context-compaction",
          title: "Context compacted",
          message: "Context compacted.",
          detailsJson,
        },
      ]);
    });

    test("a completed compaction replaces the pending part from its started event in place", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "text", text: "before" }),
        makeRow("msg-1", 1, {
          kind: "context-compaction",
          message: "Compacting…",
          inProgress: true,
        }),
        makeRow("msg-1", 2, {
          kind: "context-compaction",
          message: "Conversation compacted",
        }),
        makeRow("msg-1", 3, { kind: "text", text: "after" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toEqual([
        { type: "text", text: "before" },
        {
          type: "runtime-notice",
          code: "context-compaction",
          title: "Context compacted",
          message: "Conversation compacted",
        },
        { type: "text", text: "after" },
      ]);
    });

    test("a pending compaction renders as a pending part until completion arrives", () => {
      const rows = [
        makeRow("msg-1", 0, {
          kind: "context-compaction",
          message: "Compacting…",
          inProgress: true,
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toEqual([
        {
          type: "runtime-notice",
          code: "context-compaction",
          title: "Context compacted",
          message: "Compacting…",
          pending: true,
        },
      ]);
    });

    test("repeated pending compaction ticks collapse into one part that completion resolves (OS-1909)", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "text", text: "before" }),
        ...[1, 2, 3].map((order) =>
          makeRow("msg-1", order, {
            kind: "context-compaction",
            message: "Compacting…",
            inProgress: true,
          })
        ),
        makeRow("msg-1", 4, {
          kind: "context-compaction",
          message: "Context compacted manually",
        }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toEqual([
        { type: "text", text: "before" },
        {
          type: "runtime-notice",
          code: "context-compaction",
          title: "Context compacted",
          message: "Context compacted manually",
        },
      ]);
    });

    test("collapses task lifecycle notices into one inline task notice group", () => {
      const rows = [
        makeRow("msg-1", 0, { kind: "text", text: "before" }),
        makeRow("msg-1", 1, {
          kind: "runtime-notice",
          code: "claude-system-task_started",
          title: "Claude runtime notice",
          message: "Claude reported task_started.",
          detailsJson: JSON.stringify({
            subtype: "task_started",
            payload: {
              type: "system",
              subtype: "task_started",
              task_id: "task-1",
              tool_use_id: "tool-1",
              description: "Explore thread mark-as-read",
              prompt: "Find the read-state flow",
            },
          }),
        }),
        makeRow("msg-1", 2, {
          kind: "runtime-notice",
          code: "claude-system-task_progress",
          title: "Claude runtime notice",
          message: "Claude reported task_progress.",
          detailsJson: JSON.stringify({
            subtype: "task_progress",
            payload: {
              type: "system",
              subtype: "task_progress",
              task_id: "task-1",
              tool_use_id: "tool-1",
              description: "Reading schema.ts",
              last_tool_name: "Read",
              usage: {
                total_tokens: 23313,
                tool_uses: 1,
                duration_ms: 2346,
              },
            },
          }),
        }),
        makeRow("msg-1", 3, {
          kind: "runtime-notice",
          code: "claude-system-task_notification",
          title: "Claude runtime notice",
          message: "Claude reported task_notification.",
          detailsJson: JSON.stringify({
            subtype: "task_notification",
            payload: {
              type: "system",
              subtype: "task_notification",
              task_id: "task-1",
              tool_use_id: "tool-1",
              status: "completed",
              summary: "Explore thread mark-as-read",
              output_file: "report.md",
            },
          }),
        }),
        makeRow("msg-1", 4, { kind: "text", text: "after" }),
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      const msg = state.messages.get("msg-1")!;

      expect(msg.parts).toHaveLength(3);
      expect(msg.parts[0]).toEqual({ type: "text", text: "before" });
      expect(msg.parts[1]).toMatchObject({
        type: "task-notice-group",
        groupKey: "task-1::tool-1",
      });
      expect((msg.parts[1] as { notices: unknown[] }).notices).toHaveLength(3);
      expect(msg.parts[2]).toEqual({ type: "text", text: "after" });
    });
  });

  describe("initComposerFromStore", () => {
    test("builds composer from full event store", () => {
      const store = initFromSnapshot([
        makeRow("msg-1", 0, { kind: "text", text: "Hello" }),
        makeRow("msg-1", 1, { kind: "text", text: " world" }),
        makeRow("msg-2", 0, { kind: "reasoning", text: "Thinking..." }),
      ]);

      const state = initComposerFromStore(store);

      expect(state.messages.size).toBe(2);
      expect(state.messages.get("msg-1")!.parts[0]).toEqual({
        type: "text",
        text: "Hello world",
      });
      expect(state.messages.get("msg-2")!.parts[0]).toEqual({
        type: "reasoning",
        text: "Thinking...",
      });
    });
  });

  describe("rows with undefined event", () => {
    test("skips rows with no event", () => {
      const rows: NormalizedChunkRow[] = [
        {
          messageId: cliMessageId("msg-1"),
          threadId: cliThreadId("thread-1"),
          createdAt: 1000,
          chunkOrder: 0,
          timestamp: 1000,
          event: undefined,
        },
      ];

      const state = applyRowsToComposer(emptyComposer(), rows);
      expect(state.messages.size).toBe(0);
    });
  });

  describe("tool call timings", () => {
    test("records the span from tool-input to tool-output", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow(
          "msg-1",
          0,
          {
            kind: "tool-input",
            toolCallId: "tool-1",
            toolName: "Grep",
            inputJson: "{}",
          },
          5_000
        ),
        makeRow(
          "msg-1",
          1,
          { kind: "tool-output", toolCallId: "tool-1", outputJson: "{}" },
          9_500
        ),
      ]);

      expect(
        state.messages.get("msg-1")!.toolTimingsByCallId.get("tool-1")
      ).toEqual({ startedAt: 5_000, endedAt: 9_500 });
    });

    test("records the end from tool-error too", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow(
          "msg-1",
          0,
          {
            kind: "tool-input",
            toolCallId: "tool-1",
            toolName: "Bash",
            inputJson: "{}",
          },
          5_000
        ),
        makeRow(
          "msg-1",
          1,
          { kind: "tool-error", toolCallId: "tool-1", errorText: "boom" },
          6_000
        ),
      ]);

      expect(
        state.messages.get("msg-1")!.toolTimingsByCallId.get("tool-1")
      ).toEqual({ startedAt: 5_000, endedAt: 6_000 });
    });

    test("leaves endedAt unset while a call is in flight", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow(
          "msg-1",
          0,
          {
            kind: "tool-input",
            toolCallId: "tool-1",
            toolName: "Grep",
            inputJson: "{}",
          },
          5_000
        ),
      ]);

      expect(
        state.messages.get("msg-1")!.toolTimingsByCallId.get("tool-1")
      ).toEqual({ startedAt: 5_000 });
    });

    test("first tool-input wins, last result wins", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow(
          "msg-1",
          0,
          {
            kind: "tool-input",
            toolCallId: "tool-1",
            toolName: "Grep",
            inputJson: "{}",
          },
          5_000
        ),
        makeRow(
          "msg-1",
          1,
          {
            kind: "tool-input",
            toolCallId: "tool-1",
            toolName: "Grep",
            inputJson: "{}",
          },
          6_000
        ),
        makeRow(
          "msg-1",
          2,
          { kind: "tool-output", toolCallId: "tool-1", outputJson: "{}" },
          7_000
        ),
        makeRow(
          "msg-1",
          3,
          { kind: "tool-output", toolCallId: "tool-1", outputJson: "{}" },
          8_000
        ),
      ]);

      expect(
        state.messages.get("msg-1")!.toolTimingsByCallId.get("tool-1")
      ).toEqual({ startedAt: 5_000, endedAt: 8_000 });
    });

    test("a result without a recorded start seeds both ends", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow(
          "msg-1",
          0,
          { kind: "tool-output", toolCallId: "orphan", outputJson: "{}" },
          7_000
        ),
      ]);

      expect(
        state.messages.get("msg-1")!.toolTimingsByCallId.get("orphan")
      ).toEqual({ startedAt: 7_000, endedAt: 7_000 });
    });

    test("times child tool calls of a grouped sub-agent", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow(
          "msg-1",
          0,
          {
            kind: "tool-input",
            toolCallId: "child-1",
            toolName: "Read",
            inputJson: "{}",
            parentToolUseId: "parent-1",
          },
          5_000
        ),
        makeRow(
          "msg-1",
          1,
          {
            kind: "tool-output",
            toolCallId: "child-1",
            outputJson: "{}",
            parentToolUseId: "parent-1",
          },
          5_400
        ),
      ]);

      expect(
        state.messages.get("msg-1")!.toolTimingsByCallId.get("child-1")
      ).toEqual({ startedAt: 5_000, endedAt: 5_400 });
    });

    test("tolerates legacy chunks with no toolCallId", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, {
          kind: "tool-input",
          toolName: "Grep",
          inputJson: "{}",
        }),
        makeRow("msg-1", 1, { kind: "tool-output", outputJson: "{}" }),
      ]);

      expect(state.messages.get("msg-1")!.toolTimingsByCallId.size).toBe(0);
    });

    test("survives delta parts being superseded", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow(
          "msg-1",
          0,
          {
            kind: "tool-input",
            toolCallId: "tool-1",
            toolName: "Grep",
            inputJson: "{}",
          },
          5_000
        ),
        makeRow(
          "msg-1",
          1,
          { kind: "tool-output", toolCallId: "tool-1", outputJson: "{}" },
          6_000
        ),
        makeRow("msg-1", 2, { kind: "text-delta", text: "par" }),
        makeRow("msg-1", 3, { kind: "text", text: "partial answer" }),
      ]);

      expect(
        state.messages.get("msg-1")!.toolTimingsByCallId.get("tool-1")
      ).toEqual({ startedAt: 5_000, endedAt: 6_000 });
    });

    test("clones timings per batch instead of mutating the previous state", () => {
      const initial = applyRowsToComposer(emptyComposer(), [
        makeRow(
          "msg-1",
          0,
          {
            kind: "tool-input",
            toolCallId: "tool-1",
            toolName: "Grep",
            inputJson: "{}",
          },
          5_000
        ),
      ]);
      const originalTimings = initial.messages.get("msg-1")!.toolTimingsByCallId;

      const updated = applyRowsToComposer(initial, [
        makeRow(
          "msg-1",
          1,
          { kind: "tool-output", toolCallId: "tool-1", outputJson: "{}" },
          6_000
        ),
      ]);
      const updatedTimings = updated.messages.get("msg-1")!.toolTimingsByCallId;

      expect(updatedTimings === originalTimings).toBe(false);
      expect(originalTimings.get("tool-1")).toEqual({ startedAt: 5_000 });
      expect(updatedTimings.get("tool-1")).toEqual({
        startedAt: 5_000,
        endedAt: 6_000,
      });
    });
  });

  describe("immutability", () => {
    test("does not mutate previous ComposerMessageState on delta", () => {
      const initial = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, { kind: "text", text: "Hello" }),
      ]);

      const originalMsg = initial.messages.get("msg-1")!;
      const originalParts = originalMsg.parts;
      const originalWarnings = originalMsg.warnings;

      // Apply a delta to the same message.
      const updated = applyRowsToComposer(initial, [
        makeRow("msg-1", 1, { kind: "text", text: " world" }),
      ]);

      const updatedMsg = updated.messages.get("msg-1")!;

      // Updated message should be a different reference.
      expect(updatedMsg === originalMsg).toBe(false);
      expect(updatedMsg.parts === originalParts).toBe(false);
      expect(updatedMsg.warnings === originalWarnings).toBe(false);

      // Original should be unchanged.
      expect(originalMsg.parts).toHaveLength(1);
      expect((originalMsg.parts[0] as { text: string }).text).toBe("Hello");

      // Updated should have the merged content.
      expect(updatedMsg.parts).toHaveLength(1);
      expect((updatedMsg.parts[0] as { text: string }).text).toBe(
        "Hello world"
      );
    });
  });

  describe("task_updated patches (OS-1597)", () => {
    const taskStartedEvent = (): CliNormalizedEvent => ({
      kind: "runtime-notice",
      code: "claude-system-task_started",
      title: "Claude runtime notice",
      message: "Claude reported task_started.",
      detailsJson: JSON.stringify({
        subtype: "task_started",
        payload: {
          task_id: "task-1",
          tool_use_id: "toolu_1",
          description: "Explore thread image handling",
        },
      }),
    });

    const taskUpdatedEvent = (
      patch: Record<string, unknown>
    ): CliNormalizedEvent => ({
      kind: "runtime-notice",
      code: "claude-task-updated",
      title: "Task updated",
      message: "Task task-1 changed.",
      detailsJson: JSON.stringify({
        subtype: "task_updated",
        payload: { task_id: "task-1", patch },
      }),
    });

    function taskGroups(state: ComposerState): TaskNoticeGroupPart[] {
      return (state.messages.get("msg-1")?.parts ?? []).filter(
        (part): part is TaskNoticeGroupPart => part.type === "task-notice-group"
      );
    }

    test("folds into the existing lifecycle group instead of adding a sibling group", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, taskStartedEvent()),
        makeRow("msg-1", 1, taskUpdatedEvent({ status: "running" })),
        makeRow("msg-1", 2, taskUpdatedEvent({ status: "completed" })),
      ]);

      const groups = taskGroups(state);
      expect(groups).toHaveLength(1);
      expect(groups[0].notices).toHaveLength(3);
      expect(summarizeTaskNoticeGroup(groups[0])).toMatchObject({
        title: "Explore thread image handling",
        status: "completed",
      });
    });

    test("never renders a standalone runtime-notice card", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, taskStartedEvent()),
        makeRow("msg-1", 1, taskUpdatedEvent({ status: "completed" })),
      ]);

      const notices = (state.messages.get("msg-1")?.parts ?? []).filter(
        (part) => part.type === "runtime-notice"
      );
      expect(notices).toHaveLength(0);
    });

    test("is dropped when no group exists for its task_id", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, taskUpdatedEvent({ status: "completed" })),
      ]);

      expect(state.messages.get("msg-1")?.parts ?? []).toHaveLength(0);
    });

    test("carries the patch error into the group summary", () => {
      const state = applyRowsToComposer(emptyComposer(), [
        makeRow("msg-1", 0, taskStartedEvent()),
        makeRow(
          "msg-1",
          1,
          taskUpdatedEvent({ status: "failed", error: "Subagent exploded" })
        ),
      ]);

      const summary = summarizeTaskNoticeGroup(taskGroups(state)[0]);
      expect(summary.status).toBe("failed");
      expect(summary.error).toBe("Subagent exploded");
    });
  });
});

describe("memory-recall events (OS-1598)", () => {
  test("become a memory-recall part carrying the recalled files", () => {
    const state = applyRowsToComposer(emptyComposer(), [
      makeRow("msg-1", 0, {
        kind: "memory-recall",
        mode: "files",
        memories: [
          { path: "/repo/.claude/memory/rules.md", scope: "team" },
          { path: "/home/u/.claude/memory/prefs.md", scope: "personal" },
        ],
        detailsJson: '{"subtype":"memory_recall"}',
      }),
    ]);

    expect(state.messages.get("msg-1")?.parts).toEqual([
      {
        type: "memory-recall",
        mode: "files",
        memories: [
          { path: "/repo/.claude/memory/rules.md", scope: "team" },
          { path: "/home/u/.claude/memory/prefs.md", scope: "personal" },
        ],
        detailsJson: '{"subtype":"memory_recall"}',
      },
    ]);
  });

  test("a recall does not interrupt surrounding text parts", () => {
    const state = applyRowsToComposer(emptyComposer(), [
      makeRow("msg-1", 0, { kind: "text", text: "Before" }),
      makeRow("msg-1", 1, {
        kind: "memory-recall",
        mode: "synthesis",
        memories: [{ content: "The reviewer wants specs updated in the same change." }],
      }),
      makeRow("msg-1", 2, { kind: "text", text: "After" }),
    ]);

    const parts = state.messages.get("msg-1")!.parts;
    expect(parts.map((part) => part.type)).toEqual(["text", "memory-recall", "text"]);
  });
});


describe("proposed plans", () => {
  test("replaces streamed draft with authoritative completed text and ignores late deltas", () => {
    const draft = { kind: "proposed-plan", phase: "delta", itemId: "p1", turnId: "t1", text: "Draft" } as const;
    const initial = applyRowsToComposer(emptyComposer(), [makeRow("m", 0, draft)]);
    const next = applyRowsToComposer(initial, [
      makeRow("m", 1, { ...draft, text: " more" }),
      makeRow("m", 2, { ...draft, phase: "completed", text: "# Final plan" }),
      makeRow("m", 3, draft),
    ]);
    expect(next.messages.get("m")?.parts).toEqual([{ type: "proposed-plan", itemId: "p1", turnId: "t1", text: "# Final plan", state: "completed" }]);
    expect(initial.messages.get("m")?.parts[0]).toMatchObject({ text: "Draft" });
  });
});

describe("narrative source isolation", () => {
  const root = { threadId: "root", turnId: "turn", itemId: "one", scope: "root" as const };
  test("completes one draft without erasing another and ignores late deltas", () => {
    const events: CliNormalizedEvent[] = [
      { kind: "text-delta", text: "first draft", source: root },
      { kind: "reasoning-delta", text: "thinking", source: { ...root, itemId: "two" } },
      { kind: "text", text: "first final", source: root },
      { kind: "text-delta", text: "too late", source: root },
      { kind: "text", text: "first final", source: root },
    ];
    const state = applyRowsToComposer(
      emptyComposer(),
      events.map((e, i) => makeRow("m", i, e))
    );
    expect(state.messages.get("m")?.parts).toEqual([
      { type: "text", text: "first final" },
      { type: "reasoning", text: "thinking" },
    ]);
  });
  test("suppresses two children and a nested child without clearing the parent draft", () => {
    const events: CliNormalizedEvent[] = [
      { kind: "metadata", sessionId: "root" },
      { kind: "text-delta", text: "parent", source: root },
      { kind: "text", text: "child A", source: { ...root, threadId: "child-a", scope: "child" } },
      { kind: "reasoning", text: "child B", source: { ...root, threadId: "child-b" } },
      { kind: "text-delta", text: "nested", source: { parentToolUseId: "nested-task" } },
      { kind: "text", text: "unknown thread", source: { ...root, scope: "unknown" } },
    ];
    const state = applyRowsToComposer(
      emptyComposer(),
      events.map((e, i) => makeRow("m", i, e))
    );
    expect(state.messages.get("m")?.parts).toEqual([{ type: "text", text: "parent" }]);
    expect(state.messages.get("m")?.normalizedEvents).toHaveLength(events.length);
  });
  test("legacy completion preserves identified drafts and distinct final items", () => {
    const events: CliNormalizedEvent[] = [
      { kind: "text-delta", text: "identified", source: root },
      { kind: "text", text: "legacy" },
      { kind: "text", text: "second item", source: { ...root, itemId: "two" } },
    ];
    const first = applyRowsToComposer(
      emptyComposer(),
      events.map((e, i) => makeRow("m", i, e))
    );
    const next = applyRowsToComposer(first, [
      makeRow("m", 3, { kind: "text", text: "final", source: root }),
    ]);
    expect(next.messages.get("m")?.parts).toEqual([
      { type: "text", text: "final" },
      { type: "text", text: "legacy" },
      { type: "text", text: "second item" },
    ]);
    expect(first.messages.get("m")?.parts[0]).toEqual({ type: "text", text: "identified" });
  });
});

test("partial historical windows wait for root identity before displaying attributed text", () => {
  const state = applyRowsToComposer(emptyComposer(), [
    makeRow("m", 0, {
      kind: "text",
      text: "unclassified historical child",
      source: { threadId: "child", itemId: "one" },
    }),
  ]);
  expect(state.messages.get("m")?.parts).toEqual([]);
});

test("Codex wire events compose into child activity groups beside the root answer", async () => {
  const { normalizeCodexAppServerChunk } =
    await import("@/convex/cli/lib/runtimes/codex/appServerEvents");
  const raw = [
    { type: "thread/started", params: { thread: { id: "root" } } },
    {
      type: "item/completed",
      params: {
        threadId: "root",
        item: {
          type: "subAgentActivity",
          id: "activity",
          agentThreadId: "a",
          agentPath: "/root/a",
          kind: "started",
        },
      },
    },
    {
      type: "convoy/child",
      params: {
        method: "turn/completed",
        source: { scope: "child", threadId: "a", agentPath: "/root/a", rootThreadId: "root" },
        params: { turn: { id: "child-turn", status: "completed" } },
      },
    },
    {
      type: "convoy/child",
      params: {
        method: "item/completed",
        source: { scope: "child", threadId: "a" },
        params: { item: { type: "agentMessage", id: "answer", text: "child answer" } },
      },
    },
    {
      type: "item/completed",
      params: {
        threadId: "root",
        turnId: "turn",
        item: { type: "agentMessage", id: "answer", text: "root answer" },
      },
    },
  ];
  const state = applyRowsToComposer(
    emptyComposer(),
    raw.map((event, i) =>
      makeRow(
        "m",
        i,
        normalizeCodexAppServerChunk({ type: event.type, data: JSON.stringify(event.params) })
      )
    )
  );
  const parts = state.messages.get("m")!.parts;
  expect(parts).toHaveLength(2);
  expect(parts[0].type).toBe("task-notice-group");
  if (parts[0].type === "task-notice-group") {
    expect(summarizeTaskNoticeGroup(parts[0].childTaskNoticeGroups![0])).toMatchObject({
      title: "/root/a",
      status: "completed",
    });
  }
  expect(parts[1]).toEqual({ type: "text", text: "root answer" });
});

describe("Codex agent-call accordion", () => {
  const activity = (id: string): CliNormalizedEvent => ({
    kind: "runtime-notice",
    code: "codex-subagent",
    title: `/root/${id}`,
    message: "completed",
    detailsJson: JSON.stringify({
      subtype: "codex_subagent",
      payload: {
        task_id: `codex:${id}`,
        description: `/root/${id}`,
        status: "completed",
        turnId: `turn-${id}`,
      },
    }),
  });
  const wait = {
    type: "collabAgentToolCall",
    id: "wait-1",
    tool: "wait",
    senderThreadId: "root",
    receiverThreadIds: [],
    agentsStates: {},
  };
  const start: CliNormalizedEvent = {
    kind: "tool-input",
    toolFamily: "codex-collaboration",
    toolCallId: wait.id,
    toolName: "Agent wait",
    inputJson: JSON.stringify({ ...wait, status: "inProgress" }),
  };
  const end: CliNormalizedEvent = {
    kind: "tool-output",
    toolFamily: "codex-collaboration",
    toolCallId: wait.id,
    outputJson: JSON.stringify({ ...wait, status: "completed" }),
  };

  test("rolls two children and an unaddressed wait into one accordion", () => {
    const events = [activity("a"), start, activity("b"), end];
    const state = applyRowsToComposer(
      emptyComposer(),
      events.map((event, i) => makeRow("m", i, event))
    );
    const parts = state.messages.get("m")!.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "task-notice-group",
      groupKey: "codex-agents",
      childTaskNoticeGroups: [{ groupKey: "codex:a" }, { groupKey: "codex:b" }],
    });
    if (parts[0].type === "task-notice-group") {
      expect(parts[0].childToolEvents).toEqual([start, end]);
    }
  });

  test("keeps late completion and failure in the group without reopening a completed call", () => {
    const error: CliNormalizedEvent = {
      kind: "tool-error",
      toolFamily: "codex-collaboration",
      toolCallId: wait.id,
      errorText: JSON.stringify({ ...wait, status: "failed" }),
    };
    for (const terminal of [end, error]) {
      const first = applyRowsToComposer(emptyComposer(), [makeRow("m", 0, terminal)]);
      const next = applyRowsToComposer(first, [makeRow("m", 1, start)]);
      expect(next.messages.get("m")!.parts).toHaveLength(1);
      const part = next.messages.get("m")!.parts[0];
      expect(part).toMatchObject({ type: "task-notice-group", groupKey: "codex-agents" });
      if (part.type === "task-notice-group")
        expect(part.childToolEvents?.at(-1)?.kind).toBe(terminal.kind);
      expect(first.messages.get("m")!.parts).toEqual(next.messages.get("m")!.parts);
    }
  });
});

describe("empty narrative completion", () => {
  test.each([false, true])(
    "removes empty reasoning, preserves indices and ignores late deltas; draft=%s",
    (hasDraft) => {
      const source = { scope: "root" as const, threadId: "root", turnId: "turn", itemId: "reason" };
      const otherSource = { ...source, itemId: "answer" };
      const events: CliNormalizedEvent[] = [
        ...(hasDraft ? [{ kind: "reasoning-delta" as const, text: "draft", source }] : []),
        { kind: "tool-input", toolCallId: "shell", toolName: "Shell", inputJson: "{}" },
        { kind: "text-delta", text: "answer draft", source: otherSource },
        { kind: "reasoning", text: "", source },
        { kind: "reasoning-delta", text: "late", source },
        { kind: "text", text: "answer", source: otherSource },
        { kind: "tool-output", toolCallId: "shell", outputJson: "{}" },
      ];
      const state = applyRowsToComposer(
        emptyComposer(),
        events.map((event, i) => makeRow("m", i, event))
      );
      expect(state.messages.get("m")?.parts).toEqual([
        expect.objectContaining({ type: "dynamic-tool", state: "output-available" }),
        { type: "text", text: "answer" },
      ]);
    }
  );
});

describe("explicit collaboration identity", () => {
  test("ordinary tool JSON cannot impersonate Codex orchestration", () => {
    const state = applyRowsToComposer(emptyComposer(), [
      makeRow("m", 0, {
        kind: "tool-input",
        toolCallId: "ordinary",
        toolName: "Read",
        inputJson: JSON.stringify({ type: "collabAgentToolCall", tool: "wait" }),
      }),
    ]);
    expect(state.messages.get("m")?.parts[0]).toMatchObject({
      type: "dynamic-tool",
      toolName: "Read",
    });
  });
});

describe("hideUnanchoredTaskGroups (OS-2285)", () => {
  const notice = (subtype: string, payload: Record<string, unknown>): CliNormalizedEvent => ({
    kind: "runtime-notice",
    code: `claude-system-${subtype}`,
    title: "Claude runtime notice",
    message: `Claude reported ${subtype}.`,
    detailsJson: JSON.stringify({ subtype, payload: { type: "system", subtype, ...payload } }),
  });
  // A background agent keeps streaming after the main reply; its own background Bash nests under it.
  const rows = [
    { kind: "text", text: "Starting work" },
    {
      kind: "tool-input",
      toolCallId: "toolu_agent",
      toolName: "Agent",
      inputJson: JSON.stringify({ description: "Verify slices", prompt: "Verify", run_in_background: true }),
    },
    notice("task_started", { task_id: "t_agent", tool_use_id: "toolu_agent", description: "Verify slices" }),
    { kind: "text", text: "Final summary" },
    {
      kind: "tool-input",
      toolCallId: "toolu_bash",
      toolName: "Bash",
      parentToolUseId: "toolu_agent",
      inputJson: JSON.stringify({ command: "pnpm test", description: "Run slice tests", run_in_background: true }),
    },
    notice("task_started", { task_id: "t_bash", tool_use_id: "toolu_bash", description: "Run slice tests" }),
    {
      kind: "tool-input",
      toolCallId: "toolu_read",
      toolName: "Read",
      parentToolUseId: "toolu_agent",
      inputJson: JSON.stringify({ file_path: "/x" }),
    },
    notice("task_notification", { task_id: "t_bash", tool_use_id: "toolu_bash", status: "completed", summary: "Run slice tests" }),
    notice("task_progress", { task_id: "t_agent", tool_use_id: "toolu_agent", description: "Running Wait for tests" }),
  ].map((event, index) => makeRow("msg-1", index, event as CliNormalizedEvent));

  function visibleParts(loaded: NormalizedChunkRow[]) {
    const composer = initComposerFromStore(initFromSnapshot(loaded));
    return hideUnanchoredTaskGroups(composer.messages, cliMessageId("msg-1"))
      .get("msg-1")!
      .parts.map((part) =>
        part.type === "task-notice-group"
          ? `group:${summarizeTaskNoticeGroup(part).title}`
          : part.type === "text"
            ? `text:${part.text}`
            : part.type
      );
  }

  test("keeps every group when the message's Agent call is loaded", () => {
    expect(visibleParts(rows)).toEqual([
      "text:Starting work",
      "group:Running Wait for tests",
      "text:Final summary",
    ]);
  });

  test("hides a sub-agent group whose Agent call is above the loaded window", () => {
    expect(visibleParts(rows.slice(4))).toEqual([]);
  });

  test("hides a sub-agent's background task notices whose tool call is above the loaded window", () => {
    expect(visibleParts(rows.slice(7))).toEqual([]);
  });

  test("leaves the other messages and a null message id untouched", () => {
    const messages = initComposerFromStore(initFromSnapshot(rows.slice(7))).messages;
    expect(hideUnanchoredTaskGroups(messages, null)).toBe(messages);
    expect(hideUnanchoredTaskGroups(messages, cliMessageId("other"))).toBe(messages);
  });
});
