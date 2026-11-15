import { describe, expect, test } from "vitest";
import { getCodexContinuationIdFromIncomingChunks, normalizeCodexChunk } from "./normalizeChunk";
import { getCodexSlashCommandsFromIncomingChunks } from "./slashCommands";

function chunk(payload: Record<string, unknown>) {
  const type = typeof payload.type === "string" ? payload.type : "unknown";
  return { type, data: JSON.stringify(payload) };
}

describe("normalizeCodexChunk", () => {
  test("thread.started carries the thread id as sessionId metadata", () => {
    const event = normalizeCodexChunk(chunk({ type: "thread.started", thread_id: "thread-42" }));
    expect(event).toMatchObject({ kind: "metadata", sessionId: "thread-42" });
  });

  test("turn lifecycle events are silent metadata", () => {
    expect(normalizeCodexChunk(chunk({ type: "turn.started" }))).toMatchObject({
      kind: "metadata",
    });

    const completed = normalizeCodexChunk(
      chunk({
        type: "turn.completed",
        usage: { input_tokens: 10, output_tokens: 2 },
      })
    );
    expect(completed.kind).toBe("metadata");
    if (completed.kind === "metadata") {
      expect(JSON.parse(completed.otherJson ?? "{}")).toMatchObject({
        event: "turn.completed",
        usage: { input_tokens: 10 },
      });
    }
  });

  test("agent_message completion becomes a text event", () => {
    expect(
      normalizeCodexChunk(
        chunk({
          type: "item.completed",
          item: { id: "item_0", type: "agent_message", text: "hello" },
        })
      )
    ).toEqual({ kind: "text", text: "hello" });
  });

  test("reasoning completion becomes a reasoning event", () => {
    expect(
      normalizeCodexChunk(
        chunk({
          type: "item.completed",
          item: { id: "item_1", type: "reasoning", text: "thinking..." },
        })
      )
    ).toEqual({ kind: "reasoning", text: "thinking..." });
  });

  test("command execution maps to tool-input then tool-output", () => {
    expect(
      normalizeCodexChunk(
        chunk({
          type: "item.started",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "/bin/zsh -lc 'ls -la'",
            status: "in_progress",
          },
        })
      )
    ).toEqual({
      kind: "tool-input",
      toolCallId: "item_1",
      toolName: "Shell",
      inputJson: JSON.stringify({ command: "/bin/zsh -lc 'ls -la'" }),
    });

    const completed = normalizeCodexChunk(
      chunk({
        type: "item.completed",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "/bin/zsh -lc 'ls -la'",
          aggregated_output: "total 32\n",
          exit_code: 0,
          status: "completed",
        },
      })
    );
    expect(completed).toEqual({
      kind: "tool-output",
      toolCallId: "item_1",
      outputJson: JSON.stringify({ output: "total 32\n", exitCode: 0 }),
    });
  });

  test("failed command execution maps to tool-error", () => {
    const event = normalizeCodexChunk(
      chunk({
        type: "item.completed",
        item: {
          id: "item_2",
          type: "command_execution",
          command: "false",
          aggregated_output: "boom",
          exit_code: 1,
          status: "failed",
        },
      })
    );
    expect(event).toMatchObject({
      kind: "tool-error",
      toolCallId: "item_2",
    });
    if (event.kind === "tool-error") {
      expect(event.errorText).toContain("exit code 1");
      expect(event.errorText).toContain("boom");
    }
  });

  test("file change maps to tool-input then tool-output", () => {
    const changes = [{ path: "/repo/hello.txt", kind: "add" }];
    expect(
      normalizeCodexChunk(
        chunk({
          type: "item.started",
          item: {
            id: "item_3",
            type: "file_change",
            changes,
            status: "in_progress",
          },
        })
      )
    ).toEqual({
      kind: "tool-input",
      toolCallId: "item_3",
      toolName: "Apply changes",
      inputJson: JSON.stringify({ changes }),
    });

    expect(
      normalizeCodexChunk(
        chunk({
          type: "item.completed",
          item: {
            id: "item_3",
            type: "file_change",
            changes,
            status: "completed",
          },
        })
      )
    ).toEqual({
      kind: "tool-output",
      toolCallId: "item_3",
      outputJson: JSON.stringify({ changes, status: "completed" }),
    });
  });

  test("mcp tool calls use the server.tool name", () => {
    const event = normalizeCodexChunk(
      chunk({
        type: "item.started",
        item: {
          id: "item_4",
          type: "mcp_tool_call",
          server: "contoso",
          tool: "list_tasks",
          status: "in_progress",
        },
      })
    );
    expect(event).toMatchObject({
      kind: "tool-input",
      toolCallId: "item_4",
      toolName: "contoso.list_tasks",
    });
  });

  test("empty todo_list items stay silent metadata", () => {
    expect(
      normalizeCodexChunk(
        chunk({
          type: "item.completed",
          item: { id: "item_5", type: "todo_list", items: [] },
        })
      ).kind
    ).toBe("metadata");
  });

  test("todo_list snapshots become plan-progress with completed/pending only", () => {
    expect(
      normalizeCodexChunk(
        chunk({
          type: "item.updated",
          item: {
            id: "item_5",
            type: "todo_list",
            items: [
              { text: "Investigate", completed: true },
              { text: "  ", completed: false },
              { text: "Implement", completed: false },
            ],
          },
        })
      )
    ).toEqual({
      kind: "plan-progress",
      steps: [
        { text: "Investigate", status: "completed" },
        // Exec JSON has no in-progress status: never guessed.
        { text: "Implement", status: "pending" },
      ],
    });
  });

  test("turn.failed becomes a runtime-notice", () => {
    const event = normalizeCodexChunk(
      chunk({
        type: "turn.failed",
        error: { message: "stream disconnected" },
      })
    );
    expect(event).toMatchObject({
      kind: "runtime-notice",
      code: "codex-turn-failed",
      message: "stream disconnected",
    });
  });

  test("error events become warnings", () => {
    expect(normalizeCodexChunk(chunk({ type: "error", message: "quota exceeded" }))).toEqual({
      kind: "warning",
      code: "codex-error",
      message: "quota exceeded",
    });
  });

  test("unknown events and items fall back to unknown", () => {
    expect(normalizeCodexChunk(chunk({ type: "something.new" })).kind).toBe("unknown");
    expect(
      normalizeCodexChunk(
        chunk({
          type: "item.completed",
          item: { id: "item_6", type: "hologram" },
        })
      ).kind
    ).toBe("unknown");
    expect(normalizeCodexChunk({ type: "item.completed", data: "not json" }).kind).toBe("unknown");
  });
});

describe("codex slash-command inventory chunk (OS-1582)", () => {
  test("the synthetic inventory chunk normalizes to silent metadata", () => {
    // The chunk type has no slash, so it dispatches through the exec
    // normalizer even though only the app-server runner emits it.
    const event = normalizeCodexChunk({
      type: "convoy.commands",
      data: JSON.stringify({ commands: ["compact"] }),
    });

    expect(event.kind).toBe("metadata");
    expect(event).not.toMatchObject({ kind: "unknown" });
  });

  test("the extractor reads the advertised commands", () => {
    expect(
      getCodexSlashCommandsFromIncomingChunks([
        { type: "turn.started", data: JSON.stringify({ type: "turn.started" }) },
        { type: "convoy.commands", data: JSON.stringify({ commands: ["compact"] }) },
      ])
      // Names-only entries normalize to the same shape as a rich inventory (OS-1806).
    ).toEqual([{ name: "compact" }]);
  });

  test("returns null when no inventory chunk is present", () => {
    expect(
      getCodexSlashCommandsFromIncomingChunks([
        { type: "turn.started", data: JSON.stringify({ type: "turn.started" }) },
      ])
    ).toBeNull();
  });

  test("an empty inventory (exec transport) advertises nothing", () => {
    expect(
      getCodexSlashCommandsFromIncomingChunks([
        { type: "convoy.commands", data: JSON.stringify({ commands: [] }) },
      ])
    ).toEqual([]);
  });
});

describe("getCodexContinuationIdFromIncomingChunks", () => {
  test("finds the thread id from thread.started chunks", () => {
    expect(
      getCodexContinuationIdFromIncomingChunks([
        { type: "turn.started", data: JSON.stringify({ type: "turn.started" }) },
        {
          type: "thread.started",
          data: JSON.stringify({ type: "thread.started", thread_id: "t-1" }),
        },
      ])
    ).toBe("t-1");
  });

  test("returns null when absent", () => {
    expect(getCodexContinuationIdFromIncomingChunks([{ type: "turn.started", data: JSON.stringify({ type: "turn.started" }) }])).toBeNull();
  });
});
