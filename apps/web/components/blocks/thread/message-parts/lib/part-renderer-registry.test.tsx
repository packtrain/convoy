/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { normalizeCodexChunk } from "@/convex/cli/lib/runtimes/codex/normalizeChunk";
import { applyRowsToComposer } from "@/lib/cli-stream-ui/composer";
import { renderCliUiMessagePart } from "./part-renderer-registry";
import { FileChangeToolPart } from "../file-change-tool-part";
import type { CliRenderMessage, CliUiPart } from "@/lib/cli-stream-ui";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("@pierre/diffs/react", () => ({
  PatchDiff: ({ patch }: { patch: string }) => (
    <pre data-testid="patch-diff">{patch}</pre>
  ),
  File: ({ file }: { file: { contents: string } }) => (
    <pre data-testid="file-view">{file.contents}</pre>
  ),
}));

function createMessage(parts: CliUiPart[]): CliRenderMessage {
  return {
    id: "msg_1",
    role: "assistant",
    parts,
  };
}

describe("part-renderer-registry", () => {
  test("renders a quota wire snapshot as cards with remaining usage and reset timing", async () => {
    const refreshedAt = Date.now();
    const event = normalizeCodexChunk({ type: "convoy.account_usage", data: JSON.stringify({
      account: "one@example.com", refreshedAt,
      buckets: [{ id: "codex", windows: [
        { name: "primary", durationMinutes: 10080, usedPercent: 40, resetsAt: Math.floor(refreshedAt / 1000) + 464400 },
        { name: "secondary", durationMinutes: 300 },
      ] }, { id: "review", name: "Code review", windows: [{ name: "primary", durationMinutes: 17, usedPercent: 0 }] }],
    }) });
    const state = applyRowsToComposer({ messages: new Map() }, [{
      messageId: "msg_1" as Id<"cliMessages">, threadId: "thread_1" as Id<"cliThreads">,
      createdAt: refreshedAt, timestamp: refreshedAt, chunkOrder: 0, event,
    }]);
    const parts = state.messages.get("msg_1")!.parts;
    const message = createMessage(parts);
    render(<>{parts.map((part, partIndex) => <div key={partIndex}>{renderCliUiMessagePart({ part, context: { partIndex, message, cliType: "codex" } })}</div>)}</>);
    expect(screen.getByText("Weekly limit")).toBeTruthy();
    expect(screen.getByText("Resets in 5d 9h")).toBeTruthy();
    expect(screen.getByText("60% left")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "codex · Weekly limit" }).getAttribute("aria-valuenow")).toBe("60");
    expect(screen.getByText("5-hour limit")).toBeTruthy();
    expect(screen.getByText("Usage unavailable")).toBeTruthy();
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
    expect(screen.getByText("17-minute limit")).toBeTruthy();
    expect(screen.getByText("100% left")).toBeTruthy();
    expect(screen.queryByText("one@example.com")).toBeNull();
    expect(screen.queryByText(/Snapshot|Updated/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Account information" })[0]!); });
    expect(screen.getByRole("dialog").textContent).toContain("one@example.com");
    expect(screen.queryByText(/Snapshot|Updated/)).toBeNull();
  });

  test("renders a native proposal with approval bound to its identity", async () => {
    const part: CliUiPart = { type: "proposed-plan", itemId: "p1", turnId: "t1", text: "# Native plan", state: "completed" };
    const message = createMessage([part]);
    const onPlanDecision = vi.fn();
    const source = { messageId: "msg_1" as Id<"cliMessages">, itemId: "p1", turnId: "t1" };
    render(<>{renderCliUiMessagePart({ part, context: { partIndex: 0, message, cliType: "codex", showPlanDecisions: true, pendingProposedPlan: source, onPlanDecision } })}</>);
    expect(screen.getByText("Native plan")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Approve & continue in Sandboxed" })); });
    expect(onPlanDecision).toHaveBeenCalledWith({ nextMode: "auto", proposedPlan: source });
  });

  test.each(["messageId", "itemId", "turnId", "absent"] as const)("hides proposal approval when the pending identity differs in %s", field => {
    const part: CliUiPart = { type: "proposed-plan", itemId: "p1", turnId: "t1", text: "# Native plan", state: "completed" };
    const source = { messageId: "msg_1" as Id<"cliMessages">, itemId: "p1", turnId: "t1", [field]: "different" };
    render(<>{renderCliUiMessagePart({ part, context: {
      partIndex: 0, message: createMessage([part]), cliType: "codex", showPlanDecisions: true,
      pendingProposedPlan: field === "absent" ? undefined : source,
      onPlanDecision: vi.fn(),
    } })}</>);
    expect(screen.queryAllByRole("button", { name: /Approve/ })).toHaveLength(0);
  });


  test.each(["streaming", "completed"] as const)("shows no approval for a %s proposal without permission", state => {
    const part: CliUiPart = { type: "proposed-plan", itemId: "p1", turnId: "t1", text: "# Native plan", state };
    const message = createMessage([part]);
    render(<>{renderCliUiMessagePart({ part, context: { partIndex: 0, message, cliType: "codex", showPlanDecisions: false, onPlanDecision: vi.fn() } })}</>);
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  test("only the latest completed proposal gets approval controls", () => {
    const first: CliUiPart = { type: "proposed-plan", itemId: "p1", turnId: "t1", text: "# Earlier plan", state: "completed" };
    const second: CliUiPart = { ...first, itemId: "p2", text: "# Latest plan" };
    const message = createMessage([first, second]);
    const source = { messageId: "msg_1" as Id<"cliMessages">, itemId: "p2", turnId: "t1" };
    render(<>{message.parts.map((part, partIndex) => <div key={partIndex}>{renderCliUiMessagePart({ part, context: { partIndex, message, cliType: "codex", showPlanDecisions: true, pendingProposedPlan: source, onPlanDecision: vi.fn() } })}</div>)}</>);
    expect(screen.getAllByRole("button", { name: "Approve & continue in Sandboxed" })).toHaveLength(1);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("renders sleep countdown expiry as pending until completion, then stops ticking", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const message = createMessage([{ type: "sleep", state: "sleeping", startedAt: 10_000, durationMs: 30_000 }]);
    const view = render(<>{renderCliUiMessagePart({ part: message.parts[0], context: { partIndex: 0, message } })}</>);
    expect(screen.getByText("~30s left")).toBeTruthy();
    act(() => vi.advanceTimersByTime(31_000));
    expect(screen.getByText("Waiting to resume")).toBeTruthy();
    expect(screen.queryByText(/Slept for/)).toBeNull();
    view.rerender(<>{renderCliUiMessagePart({
      part: { type: "sleep", state: "completed", startedAt: 10_000, completedAt: 41_000, durationMs: 30_000 },
      context: { partIndex: 0, message },
    })}</>);
    expect(screen.getByText("Slept for 31s")).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    { type: "sleep", state: "completed", durationMs: 20_000, completedAt: 30_000 },
    { type: "sleep", state: "completed", startedAt: 40_000, completedAt: 30_000 },
  ] satisfies CliUiPart[])("does not invent actual elapsed duration for incomplete or reversed timing", (part) => {
    const message = createMessage([part]);
    render(<>{renderCliUiMessagePart({ part, context: { partIndex: 0, message } })}</>);
    expect(screen.getByText("Sleep completed")).toBeTruthy();
    expect(screen.queryByText(/Slept for/)).toBeNull();
  });

  test("renders a durationless sleep and cleans up a live timer on unmount", () => {
    vi.useFakeTimers();
    const part: CliUiPart = { type: "sleep", state: "sleeping", startedAt: 0 };
    const message = createMessage([part]);
    const view = render(<>{renderCliUiMessagePart({ part, context: { partIndex: 0, message } })}</>);
    expect(screen.getByText("Sleeping")).toBeTruthy();
    expect(screen.queryByText(/left$/)).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("renders text parts", () => {
    const message = createMessage([{ type: "text", text: "Hello markdown" }]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    expect(screen.getByText("Hello markdown")).toBeDefined();
  });

  test("renders reasoning parts collapsed by default", () => {
    const message = createMessage([{ type: "reasoning", text: "Think first" }]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    const trigger = screen.getByRole("button", { name: /Reasoning/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Think first")).toBeDefined();
  });

  test("renders dynamic-tool summary trigger and expanded JSON payload", () => {
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "CustomTool",
        toolCallId: "tool_1",
        state: "output-available",
        input: { pattern: "foo" },
        output: { content: "match" },
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    const trigger = screen.getByRole("button", { name: /CustomTool 'foo'/i });
    expect(trigger).toBeDefined();
    fireEvent.click(trigger);
    expect(screen.getByText("Input")).toBeDefined();
    expect(screen.getByText(/"pattern": "foo"/)).toBeDefined();
    expect(screen.getByText(/"content": "match"/)).toBeDefined();
    expect(screen.queryByText(/"state": "output-available"/)).toBeNull();
  });

  test("renders Grep tool as searchable result output instead of raw JSON", () => {
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "Grep",
        toolCallId: "tool_grep_1",
        state: "output-available",
        input: {
          pattern: "taskByClientId",
          path: "/workspace/apps/web/components/blocks/tasks/task-table/hooks/use-task-table-controller.ts",
          output_mode: "content",
          "-n": true,
          "-C": 3,
        },
        output:
          "258:  const taskByClientId = useMemo(\n259-    () => new Map(allTasks.map((task) => [task.clientId, task])),\n260-    [allTasks]\n261-  );",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    const trigger = screen.getByRole("button", {
      name: /Search "taskByClientId" in use-task-table-controller\.ts/i,
    });
    expect(trigger).toBeDefined();
    fireEvent.click(trigger);

    expect(
      screen.getAllByText((_, node) =>
        Boolean(
          node?.textContent?.includes("258:  const taskByClientId = useMemo")
        )
      ).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/"toolName": "Grep"/)).toBeNull();
  });

  test("renders Glob tool as file search output instead of raw JSON", () => {
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "Glob",
        toolCallId: "toolu_bdrk_011LRYJmPZtcQStpeFPNNnYa",
        state: "output-available",
        input: {
          pattern: "**/ui/button-group*",
          path: "/workspace/apps/web",
        },
        output: "/workspace/apps/web/components/ui/button-group.tsx",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    const trigger = screen.getByRole("button", {
      name: /Find "\*\*\/ui\/button-group\*" in web · 1 file/i,
    });
    expect(trigger).toBeDefined();
    fireEvent.click(trigger);

    expect(
      screen.getAllByText((_, node) =>
        Boolean(
          node?.textContent?.includes(
            "/workspace/apps/web/components/ui/button-group.tsx"
          )
        )
      ).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/"toolName": "Glob"/)).toBeNull();
  });

  test("renders dynamic-tool output-error payload", () => {
    const readPath = "/Users/dev/convoy/README.md";
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "Read",
        toolCallId: "tool_2",
        state: "output-error",
        input: { file_path: readPath },
        errorText: "File not found",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    // A failed read has nothing to disclose: the row is plain text and its
    // alert icon carries the error message (OS-1769).
    expect(screen.getByText(/Read README\.md/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Read README\.md/ })).toBeNull();
    expect(screen.getByLabelText("File not found")).toBeDefined();
  });

  test("renders Edit tool fallback as a replacement diff when only old/new strings are available", () => {
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "Edit",
        toolCallId: "toolu_edit_1",
        state: "output-available",
        input: {
          replace_all: false,
          file_path: "/workspace/apps/web/package.json",
          old_string: "\"dev\": \"next dev\",",
          new_string: "\"dev\": \"portless run --name app.convoy next dev\",",
        },
        output: "The file /workspace/apps/web/package.json has been updated successfully.",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    const trigger = screen.getByRole("button", { name: /Edit package\.json/i });
    expect(trigger.textContent).toContain("+1 -1");
    expect(screen.getByText("+1").className).toContain("text-success");
    expect(screen.getByText("-1").className).toContain("text-destructive");
    fireEvent.click(trigger);

    expect(document.body.textContent).toContain('"dev": "next dev",');
    expect(document.body.textContent).toContain(
      '"dev": "portless run --name app.convoy next dev",'
    );
    expect(screen.queryByText(/"oldString"/)).toBeNull();
    expect(screen.queryByText(/"newString"/)).toBeNull();
    expect(
      screen.queryByText(
        /The file \/workspace\/apps\/web\/package\.json has been updated successfully\./
      )
    ).toBeNull();
  });

  test("renders Edit tool structured output as a diff and uses output filePath", () => {
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "Edit",
        toolCallId: "toolu_edit_2",
        state: "output-available",
        input: {
          file_path: "/workspace/apps/web/package.json",
          old_string: "\"dev\": \"next dev\",",
          new_string: "\"dev\": \"next dev --turbo\",",
        },
        output: {
          filePath: "/workspace/apps/web/package-lock.json",
          oldString: "\"dev\": \"next dev\",",
          newString: "\"dev\": \"next dev --turbo\",",
          message:
            "The file /workspace/apps/web/package-lock.json has been updated successfully.",
          structuredPatch: [
            {
              oldStart: 4,
              oldLines: 3,
              newStart: 4,
              newLines: 3,
              lines: [
                "  \"scripts\": {",
                "-    \"dev\": \"next dev\",",
                "+    \"dev\": \"next dev --turbo\",",
                "  }",
              ],
            },
          ],
        },
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    const trigger = screen.getByRole("button", {
      name: /Edit package-lock\.json/i,
    });
    expect(trigger.textContent).toContain("+1 -1");
    fireEvent.click(trigger);

    expect(document.body.textContent).toContain('"dev": "next dev",');
    expect(document.body.textContent).toContain('"dev": "next dev --turbo",');
    expect(screen.queryByText(/"structuredPatch"/)).toBeNull();
  });

  test("renders flattened Edit payload as a replacement diff", () => {
    render(
      <FileChangeToolPart
        payload={{
          toolName: "Edit",
          toolCallId: "toolu_bdrk_014o1fWMJgmjeGJXKD6fA5ov",
          state: "output-available",
          filePath:
            "/workspace/apps/web/components/blocks/project/agent-thread-launcher.tsx",
          oldString:
            "      </Button>\n      <ButtonGroupSeparator />\n      <Popover open={open} onOpenChange={setOpen}>",
          newString:
            "      </Button>\n      <Popover open={open} onOpenChange={setOpen}>",
          outputText:
            "The file /workspace/apps/web/components/blocks/project/agent-thread-launcher.tsx has been updated successfully.",
        }}
      />
    );

    const trigger = screen.getByRole("button", {
      name: /Edit agent-thread-launcher\.tsx/i,
    });
    expect(trigger.textContent).toContain("+0 -1");
    fireEvent.click(trigger);

    expect(document.body.textContent).toContain("<ButtonGroupSeparator />");
    expect(document.body.textContent).toContain(
      "<Popover open={open} onOpenChange={setOpen}>"
    );
    expect(screen.queryByText(/"oldString"/)).toBeNull();
  });

  test("renders runtime notice parts with inspectable details", () => {
    const message = createMessage([
      {
        type: "runtime-notice",
        code: "claude-status",
        title: "Claude status",
        message: "Permission mode: plan",
        detailsJson: JSON.stringify({
          subtype: "status",
          payload: {
            permissionMode: "plan",
          },
        }),
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    const trigger = screen.getByRole("button", {
      name: "Claude status: Permission mode: plan",
    });
    expect(trigger).toBeDefined();
    fireEvent.click(trigger);
    expect(screen.getByText(/"permissionMode": "plan"/)).toBeDefined();
  });

  test("renders context compaction parts as a separator marker", () => {
    const message = createMessage([
      {
        type: "runtime-notice",
        code: "context-compaction",
        title: "Context compacted",
        message: "Conversation compacted",
        detailsJson: JSON.stringify({
          subtype: "compact_boundary",
          payload: {
            subtype: "compact_boundary",
          },
        }),
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    expect(screen.getByText("Conversation compacted")).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("renders a pending context compaction as shimmer text", () => {
    const message = createMessage([
      {
        type: "runtime-notice",
        code: "context-compaction",
        title: "Context compacted",
        message: "Compacting…",
        pending: true,
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    expect(screen.getByText("Compacting…")).toBeDefined();
  });

  test("copies debug info for runtime notice parts", async () => {
    window.localStorage.setItem("convoy.dev-setting.tool-call-debug", "1");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const debugJson = JSON.stringify(
      {
        rawType: "user",
        reason: "no-recognized-content-blocks",
        rawData: "{\"type\":\"user\"}",
      },
      null,
      2
    );
    const message = createMessage([
      {
        type: "runtime-notice",
        code: "unknown-event",
        title: "Unsupported CLI event",
        message: "Received no-recognized-content-blocks (user).",
        debugJson,
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Unsupported CLI event: Received no-recognized-content-blocks (user).",
      })
    );
    fireEvent.click(screen.getByLabelText("Copy raw tool call JSON"));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(debugJson);
    });
  });

  test("renders debugJson in runtime notice accordion when detailsJson is absent", () => {
    const debugJson = JSON.stringify(
      {
        rawType: "user",
        reason: "no-recognized-content-blocks",
        rawData: "{\"type\":\"user\"}",
      },
      null,
      2
    );
    const message = createMessage([
      {
        type: "runtime-notice",
        code: "unknown-event",
        title: "Unsupported CLI event",
        message: "Received no-recognized-content-blocks (user).",
        debugJson,
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Unsupported CLI event: Received no-recognized-content-blocks (user).",
      })
    );

    expect(screen.getByText(/"rawType": "user"/)).toBeDefined();
    expect(screen.getByText(/"reason": "no-recognized-content-blocks"/)).toBeDefined();
  });

  test("renders grouped task notices with prompt, stats row, grouped child tool calls, and collapsed raw data", () => {
    const message = createMessage([
      {
        type: "task-notice-group",
        groupKey: "task-1::tool-1",
        parentToolUseId: "tool-1",
        taskTool: {
          type: "dynamic-tool",
          toolName: "Task",
          toolCallId: "tool-1",
          state: "output-available",
          input: {
            description: "Explore thread mark-as-read",
            prompt: "Find the read-state flow",
          },
          output: [{ type: "text", text: "Done." }],
        },
        notices: [
          {
            code: "claude-system-task_started",
            title: "Claude runtime notice",
            message: "Claude reported task_started.",
            detailsJson: JSON.stringify({
              subtype: "task_started",
              payload: {
                task_id: "task-1",
                tool_use_id: "tool-1",
                description: "Explore thread mark-as-read",
                prompt: "Find the read-state flow",
              },
            }),
          },
          {
            code: "claude-system-task_progress",
            title: "Claude runtime notice",
            message: "Claude reported task_progress.",
            detailsJson: JSON.stringify({
              subtype: "task_progress",
              payload: {
                task_id: "task-1",
                tool_use_id: "tool-1",
                last_tool_name: "Read",
                usage: {
                  total_tokens: 23313,
                  tool_uses: 1,
                  duration_ms: 2346,
                },
              },
            }),
          },
          {
            code: "claude-system-task_notification",
            title: "Claude runtime notice",
            message: "Claude reported task_notification.",
            detailsJson: JSON.stringify({
              subtype: "task_notification",
              payload: {
                task_id: "task-1",
                tool_use_id: "tool-1",
                status: "completed",
                summary: "Explore thread mark-as-read",
                output_file: "report.md",
              },
            }),
          },
        ],
        childToolEvents: [
          {
            kind: "tool-input",
            toolCallId: "tool-child-1",
            toolName: "Read",
            inputJson: JSON.stringify({ file_path: "/tmp/example.ts" }),
            parentToolUseId: "tool-1",
          },
        ],
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Explore thread mark-as-read (completed)",
      })
    );

    expect(screen.getByText("Prompt")).toBeDefined();
    expect(screen.getByText("Find the read-state flow")).toBeDefined();
    expect(screen.getByText("Total tokens")).toBeDefined();
    expect(screen.getByText("23313")).toBeDefined();
    expect(screen.getByText("Tool uses")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("Duration")).toBeDefined();
    expect(screen.getByText("2.3s")).toBeDefined();
    expect(screen.getByText("Tool calls")).toBeDefined();
    // Still running, so the child row is a plain spinner row, not an expander.
    expect(screen.getByText(/Read example\.ts/i)).toBeDefined();
    expect(screen.queryByText("Last tool")).toBeNull();
    expect(screen.queryByText(/"output_file": "report.md"/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Show raw data/i }));
    expect(screen.getByText(/"output_file": "report.md"/)).toBeDefined();
    expect(screen.getByText(/"childToolEvents"/)).toBeDefined();
    expect(screen.getByText(/"tool-child-1"/)).toBeDefined();
  });

  test("renders nested child task groups instead of duplicate raw child tool rows", () => {
    const message = createMessage([
      {
        type: "task-notice-group",
        groupKey: "task-parent::tool-parent",
        parentToolUseId: "tool-parent",
        notices: [
          {
            code: "claude-system-task_started",
            title: "Claude runtime notice",
            message: "Claude reported task_started.",
            detailsJson: JSON.stringify({
              subtype: "task_started",
              payload: {
                task_id: "task-parent",
                tool_use_id: "tool-parent",
                description: "Explore thread handling",
              },
            }),
          },
        ],
        childToolEvents: [
          {
            kind: "tool-input",
            toolCallId: "tool-child-bash",
            toolName: "Bash",
            inputJson: JSON.stringify({
              command: 'find /workspace -type f -name "schema.ts" | head -20',
            }),
            parentToolUseId: "tool-parent",
          },
        ],
        childTaskNoticeGroups: [
          {
            type: "task-notice-group",
            groupKey: "task-child::tool-child-bash",
            parentToolUseId: "tool-child-bash",
            notices: [
              {
                code: "claude-system-task_notification",
                title: "Claude runtime notice",
                message: "Claude reported task_notification.",
                detailsJson: JSON.stringify({
                  subtype: "task_notification",
                  payload: {
                    task_id: "task-child",
                    tool_use_id: "tool-child-bash",
                    status: "completed",
                    summary: 'find /workspace -type f -name "schema.ts" | head -20',
                  },
                }),
              },
            ],
            taskTool: {
              type: "dynamic-tool",
              toolName: "Bash",
              toolCallId: "tool-child-bash",
              state: "output-available",
              input: {
                command: 'find /workspace -type f -name "schema.ts" | head -20',
              },
              output: "/workspace/apps/web/convex/schema.ts",
            },
            childToolEvents: [],
          },
        ],
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Explore thread handling/i,
      })
    );

    expect(
      screen.getByRole("button", {
        name: /find \/workspace -type f -name "schema\.ts" \| head -20 \(completed\)/i,
      })
    ).toBeDefined();
    expect(
      screen.queryByRole("button", {
        name: /^Bash '/i,
      })
    ).toBeNull();
  });

  test("renders AskUserQuestion tool as inline questionnaire", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "AskUserQuestion",
        toolCallId: "toolu_ask_1",
        state: "output-error",
        input: {
          questions: [
            {
              question: "Which testing frameworks do you prefer?",
              header: "Testing",
              multiSelect: true,
              options: [
                { label: "Vitest", description: "Fast Vite-native tests" },
                { label: "Jest", description: "Popular ecosystem" },
              ],
            },
          ],
        },
        errorText: "Answer questions?",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: {
            partIndex: 0,
            message,
            onSubmitAskUserQuestion: onSubmit,
          },
        })}
      </div>
    );

    fireEvent.click(screen.getByLabelText("Vitest"));
    fireEvent.change(screen.getByPlaceholderText("Other"), {
      target: { value: "Also contract tests with Pact" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "AskUserQuestion",
        toolCallId: "toolu_ask_1",
      })
    );
  });

  test("renders ExitPlanMode as dedicated plan panel and toggles raw markdown", () => {
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "ExitPlanMode",
        toolCallId: "toolu_exit_1",
        state: "output-error",
        input: {
          plan: "# Plan title\n\n## Summary\nRendered markdown body",
        },
        errorText: "Exit plan mode?",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message, showPlanDecisions: true },
        })}
      </div>
    );

    expect(screen.getByText("Plan")).toBeDefined();
    expect(screen.getByText("Plan title")).toBeDefined();
    expect(screen.getByRole("button", { name: "Show raw markdown" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Show raw markdown" }));
    expect(screen.getByText(/# Plan title/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Show rendered plan" })).toBeDefined();
  });

  test("ExitPlanMode copy and download actions are functional", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const createObjectURL = vi.fn(() => "blob:plan");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
    });

    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "ExitPlanMode",
        toolCallId: "toolu_exit_copy_download",
        state: "output-error",
        input: {
          plan: "# Download me",
        },
        errorText: "Exit plan mode?",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message, showPlanDecisions: true },
        })}
      </div>
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy markdown" }));
    expect(writeText).toHaveBeenCalledWith("# Download me");

    fireEvent.click(screen.getByRole("button", { name: "Download markdown" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:plan");
  });

  test("ExitPlanMode decision buttons trigger the callback when visible", () => {
    const onPlanDecision = vi.fn().mockResolvedValue(undefined);
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "ExitPlanMode",
        toolCallId: "toolu_exit_execute",
        state: "output-error",
        input: {
          plan: "# Execute me",
        },
        errorText: "Exit plan mode?",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: {
            partIndex: 0,
            message,
            onPlanDecision,
            showPlanDecisions: true,
          },
        })}
      </div>
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Approve, ask per tool/ })
    );
    expect(onPlanDecision).toHaveBeenCalledWith({ nextMode: "default" });
  });

  test("ExitPlanMode hides decisions when showPlanDecisions is false", () => {
    const onPlanDecision = vi.fn().mockResolvedValue(undefined);
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "ExitPlanMode",
        toolCallId: "toolu_exit_hidden",
        state: "output-error",
        input: {
          plan: "# Hidden execute",
        },
        errorText: "Exit plan mode?",
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: {
            partIndex: 0,
            message,
            onPlanDecision,
            showPlanDecisions: false,
          },
        })}
      </div>
    );

    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  test("renders a pending ExitPlanMode plan with decision buttons", () => {
    const onPlanDecision = vi.fn().mockResolvedValue(undefined);
    const message = createMessage([
      {
        type: "dynamic-tool",
        toolName: "ExitPlanMode",
        toolCallId: "toolu_exit_pending",
        state: "input-available",
        input: {
          plan: "# Awaiting approval",
        },
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: {
            partIndex: 0,
            message,
            onPlanDecision,
            showPlanDecisions: true,
          },
        })}
      </div>
    );

    expect(screen.getByText("Awaiting approval")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Approve & continue in auto/i })
    ).toBeDefined();
  });

  test("renders a file memory-recall part as a marker with a collapsed list", () => {
    const message = createMessage([
      {
        type: "memory-recall",
        mode: "files",
        memories: [
          { path: "/repo/.claude/memory/rules.md", scope: "team" },
          { path: "/home/u/.claude/memory/prefs.md", scope: "personal" },
        ],
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    expect(screen.getByText("Recalled 2 memories")).toBeDefined();
    // Paths live behind the disclosure, so they are not in the DOM until opened.
    expect(screen.queryByText("/repo/.claude/memory/rules.md")).toBeNull();

    fireEvent.click(screen.getByText("rules.md, prefs.md"));

    expect(screen.getByText("/repo/.claude/memory/rules.md")).toBeDefined();
    expect(screen.getByText("team")).toBeDefined();
    expect(screen.getByText("personal")).toBeDefined();
  });

  test("renders a synthesized memory-recall part with its paragraph", () => {
    const message = createMessage([
      {
        type: "memory-recall",
        mode: "synthesis",
        memories: [
          { scope: "team", content: "The reviewer wants specs updated in the same change." },
        ],
      },
    ]);
    const part = message.parts[0]!;

    render(
      <div>
        {renderCliUiMessagePart({
          part,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    expect(screen.getByText("Recalled from memory")).toBeDefined();

    fireEvent.click(screen.getByText("Memory synthesis"));

    expect(
      screen.getByText("The reviewer wants specs updated in the same change.")
    ).toBeDefined();
  });

  test("routes unknown parts to JSON fallback renderer", () => {
    const unknownPart: CliUiPart = {
      type: "source-url",
      sourceId: "src_1",
      url: "https://example.com",
    } as CliUiPart;
    const message = createMessage([unknownPart]);

    render(
      <div>
        {renderCliUiMessagePart({
          part: unknownPart,
          context: { partIndex: 0, message },
        })}
      </div>
    );

    expect(screen.getByText("Unsupported part type")).toBeDefined();
    expect(screen.getByText("source-url")).toBeDefined();
  });
});
