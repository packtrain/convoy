import { describe, expect, test } from "vitest";
import {
  isClaudeCodeEphemeralChunk,
  normalizeClaudeCodeChunk,
} from "./normalizeChunk";
import { expandCliNormalizedEvent } from "../../chunks/normalizedEvents";

describe("Claude account usage reports", () => {
  const usage = { provider: "claude-code", source: "reported", account: "user@example.com", refreshedAt: 123,
    buckets: [{ id: "five_hour", windows: [{ name: "five_hour", label: "5-hour limit", usedPercent: 25 }] }],
    extraUsage: { enabled: true, usedPercent: 15, currency: "USD", monthlyLimit: 5000, usedCredits: 750 },
  };
  test("normalizes a durable quota report without dropping optional fields", () => {
    const chunk = { type: "convoy.account_usage", data: JSON.stringify(usage) };
    expect(normalizeClaudeCodeChunk(chunk)).toEqual({ kind: "account-usage", usage });
    expect(isClaudeCodeEphemeralChunk(chunk)).toBe(false);
  });
  test.each([
    { refreshedAt: -1 }, { source: "fresh" }, { provider: "codex" },
    { extraUsage: { enabled: true, usedCredits: -1 } },
    { buckets: [{ id: "invalid", windows: [{ name: "five_hour", usedPercent: 101 }] }] },
  ])("rejects malformed bridge values %j", invalid => {
    expect(normalizeClaudeCodeChunk({ type: "convoy.account_usage", data: JSON.stringify({ ...usage, ...invalid }) }).kind).toBe("unknown");
  });
});

describe("background task snapshots", () => {
  const normalize = (extra: Record<string, unknown>) => normalizeClaudeCodeChunk({
    type: "system",
    data: JSON.stringify({ type: "system", subtype: "background_tasks_changed", ...extra }),
  });

  test("keeps all task types and deduplicates IDs without rendering a notice", () => {
    expect(normalize({ tasks: [
      { task_id: "bash", task_type: "local_bash", description: "Tests" },
      { task_id: "bash", task_type: "local_bash", description: "Duplicate" },
      { task_id: "remote", task_type: "remote_agent", description: "Remote review" },
      { task_id: "new", task_type: "future_type" },
      null,
    ] })).toMatchObject({ kind: "metadata", backgroundTasks: {
      totalCount: 3,
      tasks: [
        { id: "bash", type: "local_bash", description: "Tests" },
        { id: "remote", type: "remote_agent", description: "Remote review" },
        { id: "new", type: "future_type", description: "" },
      ],
    } });
  });

  test("bounds stored descriptions and list size while retaining the total count", () => {
    const event = normalize({ tasks: Array.from({ length: 205 }, (_, i) => ({
      task_id: `task-${i}`, task_type: "local_agent", description: "a".repeat(2100),
    })) });
    if (event.kind !== "metadata") throw new Error("expected metadata");
    expect(event.backgroundTasks?.tasks).toHaveLength(200);
    expect(event.backgroundTasks?.totalCount).toBe(205);
    expect(event.backgroundTasks?.tasks[0].description).toHaveLength(2000);
  });

  test("malformed and child-process snapshots do not replace root membership", () => {
    for (const extra of [{ tasks: null }, { tasks: [null, {}] }, { parent_tool_use_id: "child", tasks: [] }]) {
      expect(normalize(extra)).toMatchObject({ kind: "metadata", backgroundTasks: undefined });
    }
  });

  test("does not split a Unicode character when bounding descriptions", () => {
    const description = "a".repeat(1999) + "😀";
    const event = normalize({ tasks: [{ task_id: "unicode", description }] });
    if (event.kind !== "metadata") throw new Error("expected metadata");
    expect(event.backgroundTasks?.tasks[0].description).toBe("a".repeat(1999));
  });
});

describe("isClaudeCodeEphemeralChunk", () => {
  test("stream_event chunks are ephemeral", () => {
    expect(isClaudeCodeEphemeralChunk({ type: "stream_event", data: "{}" })).toBe(
      true
    );
  });

  test("pure-telemetry system chunks are ephemeral", () => {
    for (const subtype of [
      "thinking_tokens",
      "hook_started",
      "hook_progress",
      "status",
      "commands_changed",
      "vcs_state_changed",
      "background_tasks_changed",
      "task_updated",
    ]) {
      expect(
        isClaudeCodeEphemeralChunk({
          type: "system",
          data: JSON.stringify({ type: "system", subtype }),
        })
      ).toBe(true);
    }
  });

  test("meaningful system chunks are kept", () => {
    for (const subtype of ["init", "hook_response", "compact_boundary", "api_retry"]) {
      expect(
        isClaudeCodeEphemeralChunk({
          type: "system",
          data: JSON.stringify({ type: "system", subtype }),
        })
      ).toBe(false);
    }
  });

  test("unparseable system chunks are kept", () => {
    expect(
      isClaudeCodeEphemeralChunk({ type: "system", data: "not json" })
    ).toBe(false);
  });

  test("assistant and result chunks are kept", () => {
    expect(isClaudeCodeEphemeralChunk({ type: "assistant", data: "{}" })).toBe(
      false
    );
    expect(isClaudeCodeEphemeralChunk({ type: "result", data: "{}" })).toBe(false);
  });
});

describe("normalizeClaudeCodeChunk task_updated (OS-1597)", () => {
  const taskUpdatedChunk = (patch: Record<string, unknown>) => ({
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype: "task_updated",
      task_id: "abebd775c3a9552f7",
      patch,
      session_id: "session-1",
    }),
  });

  test("normalizes to a task-updated notice carrying the patch, not a generic system notice", () => {
    const event = normalizeClaudeCodeChunk(
      taskUpdatedChunk({ status: "completed", end_time: 1785872870546 })
    );

    expect(event.kind).toBe("runtime-notice");
    if (event.kind !== "runtime-notice") throw new Error("expected runtime-notice");
    expect(event.code).toBe("claude-task-updated");
    expect(event.message).not.toContain("Claude reported task_updated");
    expect(event.sessionId).toBe("session-1");
    expect(JSON.parse(event.detailsJson ?? "{}")).toMatchObject({
      subtype: "task_updated",
      payload: { task_id: "abebd775c3a9552f7", patch: { status: "completed" } },
    });
  });

  test("patches carrying error or is_backgrounded survive ephemeral cleanup", () => {
    expect(
      isClaudeCodeEphemeralChunk(taskUpdatedChunk({ status: "running" }))
    ).toBe(true);
    expect(
      isClaudeCodeEphemeralChunk(taskUpdatedChunk({ error: "boom" }))
    ).toBe(false);
    expect(
      isClaudeCodeEphemeralChunk(taskUpdatedChunk({ is_backgrounded: true }))
    ).toBe(false);
  });
});

describe("normalizeClaudeCodeChunk skip_transcript task events", () => {
  const lifecycleChunk = (
    subtype: string,
    extra: Record<string, unknown> = {}
  ) => ({
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype,
      task_id: "task-1",
      tool_use_id: "toolu_1",
      description: "Ambient housekeeping",
      session_id: "session-1",
      ...extra,
    }),
  });

  test("ambient tasks stay out of the transcript", () => {
    for (const subtype of ["task_started", "task_progress", "task_notification"]) {
      const event = normalizeClaudeCodeChunk(
        lifecycleChunk(subtype, { skip_transcript: true })
      );
      expect(event.kind).toBe("metadata");
    }
  });

  test("normal tasks still render as grouped lifecycle notices", () => {
    for (const subtype of ["task_started", "task_progress", "task_notification"]) {
      const event = normalizeClaudeCodeChunk(lifecycleChunk(subtype));
      expect(event.kind).toBe("runtime-notice");
    }
  });
});

describe("normalizeClaudeCodeChunk vcs system events", () => {
  test("vcs_state_changed normalizes to silent metadata (OS-1386)", () => {
    expect(
      normalizeClaudeCodeChunk({
        type: "system",
        data: JSON.stringify({
          type: "system",
          subtype: "vcs_state_changed",
          kind: "commit",
          cwd: "/workspace/sandbox/playground",
          session_id: "s-1",
        }),
      })
    ).toMatchObject({ kind: "metadata", sessionId: "s-1" });
  });

  test("background_tasks_changed normalizes to silent metadata (OS-1399)", () => {
    expect(
      normalizeClaudeCodeChunk({
        type: "system",
        data: JSON.stringify({
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [
            {
              task_id: "bmgmx3k7b",
              task_type: "local_bash",
              description: "Loop from 1 to 10",
            },
          ],
          session_id: "s-1",
        }),
      })
    ).toMatchObject({ kind: "metadata", sessionId: "s-1" });
  });

  test("code_change_published normalizes to a published notice (OS-1387)", () => {
    expect(
      normalizeClaudeCodeChunk({
        type: "system",
        data: JSON.stringify({
          type: "system",
          subtype: "code_change_published",
          provider: "github",
          url: "https://github.com/contoso/convoy-sandbox/pull/1",
          repo: "contoso/convoy-sandbox",
          identifier: "1",
          session_id: "s-1",
        }),
      })
    ).toMatchObject({
      kind: "runtime-notice",
      code: "claude-code-change-published",
      title: "Code change published",
      message: "Published contoso/convoy-sandbox#1.",
      sessionId: "s-1",
    });
  });

  test("code_change_published without repo metadata falls back to the url", () => {
    expect(
      normalizeClaudeCodeChunk({
        type: "system",
        data: JSON.stringify({
          type: "system",
          subtype: "code_change_published",
          url: "https://github.com/contoso/convoy-sandbox/pull/1",
        }),
      })
    ).toMatchObject({
      kind: "runtime-notice",
      message: "Published https://github.com/contoso/convoy-sandbox/pull/1.",
    });
  });
});

describe("normalizeClaudeCodeChunk status system events", () => {
  const statusChunk = (payload: Record<string, unknown>) => ({
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype: "status",
      session_id: "s-1",
      ...payload,
    }),
  });

  test("status compacting normalizes to a pending compaction (OS-1593)", () => {
    expect(normalizeClaudeCodeChunk(statusChunk({ status: "compacting" }))).toMatchObject({
      kind: "context-compaction",
      message: "Compacting…",
      inProgress: true,
      sessionId: "s-1",
    });
  });

  test("status requesting stays silent metadata", () => {
    expect(normalizeClaudeCodeChunk(statusChunk({ status: "requesting" }))).toMatchObject({
      kind: "metadata",
      sessionId: "s-1",
    });
  });

  test("a cleared status without a compaction result stays silent metadata", () => {
    expect(normalizeClaudeCodeChunk(statusChunk({ status: null }))).toMatchObject({
      kind: "metadata",
      sessionId: "s-1",
    });
  });

  test("a successful compaction result stays silent — compact_boundary carries it", () => {
    expect(
      normalizeClaudeCodeChunk(statusChunk({ status: null, compact_result: "success" }))
    ).toMatchObject({ kind: "metadata", sessionId: "s-1" });
  });

  test("a failed compaction result resolves the pending compaction (OS-1593)", () => {
    expect(
      normalizeClaudeCodeChunk(
        statusChunk({
          status: null,
          compact_result: "failed",
          compact_error: "Context low",
        })
      )
    ).toMatchObject({
      kind: "context-compaction",
      message: "Compaction failed: Context low.",
      sessionId: "s-1",
    });
  });

  test("an already-punctuated compaction error is not double-punctuated", () => {
    expect(
      normalizeClaudeCodeChunk(
        statusChunk({
          status: null,
          compact_result: "failed",
          compact_error: "Compaction canceled.",
        })
      )
    ).toMatchObject({
      kind: "context-compaction",
      message: "Compaction failed: Compaction canceled.",
    });
  });

  test("a failed compaction without an error message still resolves the pending part", () => {
    const event = normalizeClaudeCodeChunk(
      statusChunk({ status: null, compact_result: "failed" })
    );
    expect(event).toMatchObject({
      kind: "context-compaction",
      message: "Compaction failed.",
    });
    expect(event).not.toHaveProperty("inProgress", true);
  });

  test("compacting status rows stay ephemeral, failed-compaction rows are kept", () => {
    expect(isClaudeCodeEphemeralChunk(statusChunk({ status: "compacting" }))).toBe(true);
    expect(
      isClaudeCodeEphemeralChunk(statusChunk({ status: null, compact_result: "failed" }))
    ).toBe(false);
  });
});

describe("normalizeClaudeCodeChunk user chunks", () => {
  test("string-content user messages (compaction bookkeeping) normalize to silent metadata", () => {
    const event = normalizeClaudeCodeChunk({
      type: "user",
      data: JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: "<local-command-stdout>Compacted </local-command-stdout>",
        },
        session_id: "sess-1",
        isReplay: true,
      }),
    });

    expect(event.kind).toBe("metadata");
    if (event.kind === "metadata") {
      expect(event.sessionId).toBe("sess-1");
    }
  });

  test("text-only user messages (interrupt notices) normalize to silent metadata (OS-1463)", () => {
    // Gracefully interrupting a turn parked on a tool call makes the CLI
    // inject a synthetic user message with text blocks only — SDK
    // bookkeeping, not conversation input worth an "unsupported event" box.
    const event = normalizeClaudeCodeChunk({
      type: "user",
      data: JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "[Request interrupted by user for tool use]" },
          ],
        },
        session_id: "sess-1",
      }),
    });

    expect(event.kind).toBe("metadata");
    if (event.kind === "metadata") {
      expect(event.sessionId).toBe("sess-1");
    }
  });

  test("user messages with unrecognized non-text blocks stay unknown", () => {
    const event = normalizeClaudeCodeChunk({
      type: "user",
      data: JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "mystery_block", payload: "?" }],
        },
      }),
    });

    expect(event.kind).toBe("unknown");
  });

  test("user messages without any content stay unknown", () => {
    const event = normalizeClaudeCodeChunk({
      type: "user",
      data: JSON.stringify({
        type: "user",
        message: { role: "user" },
      }),
    });

    expect(event.kind).toBe("unknown");
  });

  test("tool-result array content still normalizes", () => {
    const event = normalizeClaudeCodeChunk({
      type: "user",
      data: JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "ok",
            },
          ],
        },
      }),
    });

    expect(event.kind).not.toBe("unknown");
  });
});

describe("normalizeClaudeCodeChunk TodoWrite", () => {
  function assistantChunk(block: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
      type: "assistant",
      data: JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [block] },
        ...extra,
      }),
    };
  }

  const todoWriteBlock = {
    type: "tool_use",
    id: "tool_1",
    name: "TodoWrite",
    input: {
      todos: [
        { content: "Investigate", status: "completed", activeForm: "Investigating" },
        { content: "Implement", status: "in_progress", activeForm: "Implementing" },
        { content: "", status: "pending" },
        { content: "Test", status: "pending" },
      ],
    },
  };

  test("TodoWrite becomes a plan-progress snapshot instead of a tool call", () => {
    expect(normalizeClaudeCodeChunk(assistantChunk(todoWriteBlock))).toEqual({
      kind: "plan-progress",
      steps: [
        { text: "Investigate", status: "completed" },
        { text: "Implement", status: "in-progress" },
        { text: "Test", status: "pending" },
      ],
    });
  });

  test("subagent TodoWrite stays a plain tool call", () => {
    expect(
      normalizeClaudeCodeChunk(
        assistantChunk(todoWriteBlock, { parent_tool_use_id: "task_1" })
      )
    ).toMatchObject({ kind: "tool-input", toolName: "TodoWrite" });
  });

  test("an empty TodoWrite list falls back to the tool call", () => {
    expect(
      normalizeClaudeCodeChunk(
        assistantChunk({ ...todoWriteBlock, input: { todos: [] } })
      )
    ).toMatchObject({ kind: "tool-input", toolName: "TodoWrite" });
  });
});

describe("normalizeClaudeCodeChunk live context window", () => {
  // Prompt size of the API call that produced the message (OS-1900).
  const usage = {
    input_tokens: 10,
    cache_creation_input_tokens: 2_000,
    cache_read_input_tokens: 80_000,
    output_tokens: 300,
  };

  function assistantChunk(extra: Record<string, unknown> = {}) {
    return {
      type: "assistant",
      data: JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "hi" }], usage },
        ...extra,
      }),
    };
  }

  test("a top-level assistant message bundles a max-less context-window event", () => {
    const event = normalizeClaudeCodeChunk(assistantChunk());
    expect(event.kind).toBe("metadata");
    const { events } = JSON.parse(event.kind === "metadata" ? event.otherJson ?? "{}" : "{}");
    expect(events).toEqual([
      { kind: "text", text: "hi" },
      { kind: "context-window", usedTokens: 82_010 },
    ]);
  });

  test("subagent assistant messages report no context size", () => {
    expect(
      normalizeClaudeCodeChunk(assistantChunk({ parent_tool_use_id: "task_1" }))
    ).toEqual({ kind: "text", text: "hi", source: { parentToolUseId: "task_1", scope: "child" } });
  });
});

describe("normalizeClaudeCodeChunk task tools", () => {
  function assistantChunk(block: Record<string, unknown>) {
    return {
      type: "assistant",
      data: JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [block] },
      }),
    };
  }

  function userChunk(payload: Record<string, unknown>) {
    return { type: "user", data: JSON.stringify({ type: "user", ...payload }) };
  }

  test("TaskUpdate maps its input straight to a step patch", () => {
    expect(
      normalizeClaudeCodeChunk(
        assistantChunk({
          type: "tool_use",
          id: "tool_1",
          name: "TaskUpdate",
          input: { taskId: "1", status: "in_progress" },
        })
      )
    ).toEqual({
      kind: "plan-step-update",
      steps: [{ id: "1", status: "in-progress" }],
    });
  });

  test("TaskCreate and TaskList calls are silenced — the plan comes with the result", () => {
    for (const name of ["TaskCreate", "TaskList"]) {
      expect(
        normalizeClaudeCodeChunk(
          assistantChunk({ type: "tool_use", id: "tool_1", name, input: { subject: "Count files" } })
        ).kind
      ).toBe("metadata");
    }
  });

  test("a TaskCreate result carries the id the call did not have", () => {
    expect(
      normalizeClaudeCodeChunk(
        userChunk({
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool_1", content: "ok" }],
          },
          tool_use_result: { task: { id: "3", subject: "Count files", status: "pending" } },
        })
      )
    ).toEqual({
      kind: "plan-step-update",
      steps: [{ id: "3", text: "Count files", status: "pending" }],
    });
  });

  test("a TaskCreate result falls back to the result text when tool_use_result is missing", () => {
    expect(
      normalizeClaudeCodeChunk(
        userChunk({
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool_1",
                content: "Task #4 created successfully: Print the branch",
              },
            ],
          },
        })
      )
    ).toEqual({
      kind: "plan-step-update",
      steps: [{ id: "4", text: "Print the branch", status: "pending" }],
    });
  });

  test("a TaskList result is a full snapshot", () => {
    expect(
      normalizeClaudeCodeChunk(
        userChunk({
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool_1", content: "ok" }],
          },
          tool_use_result: {
            tasks: [
              { id: "1", subject: "Alpha", status: "completed" },
              { id: "2", subject: "Beta", status: "in_progress" },
            ],
          },
        })
      )
    ).toEqual({
      kind: "plan-progress",
      steps: [
        { id: "1", text: "Alpha", status: "completed" },
        { id: "2", text: "Beta", status: "in-progress" },
      ],
    });
  });

  test("a sibling tool result in the same chunk still normalizes", () => {
    const event = normalizeClaudeCodeChunk(
      userChunk({
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "Task #1 created successfully: Count files",
            },
            { type: "tool_result", tool_use_id: "tool_2", content: "file contents" },
          ],
        },
      })
    );

    // Bundled: the plan step and the sibling's output both survive.
    expect(event.kind).toBe("metadata");
    const bundled = event.kind === "metadata" ? JSON.parse(event.otherJson ?? "{}") : {};
    expect(bundled.events).toEqual([
      { kind: "plan-step-update", steps: [{ id: "1", text: "Count files", status: "pending" }] },
      { kind: "tool-output", toolCallId: "tool_2", outputJson: "file contents" },
    ]);
  });

  test("batched TaskCreate results each yield their own step", () => {
    const event = normalizeClaudeCodeChunk(
      userChunk({
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: "Task #1 created successfully: Count files",
            },
            {
              type: "tool_result",
              tool_use_id: "tool_2",
              content: "Task #2 created successfully: Print the branch",
            },
          ],
        },
        // Singular and unattributable across batched results: ignored here.
        tool_use_result: { task: { id: "1", subject: "Count files" } },
      })
    );

    const bundled = event.kind === "metadata" ? JSON.parse(event.otherJson ?? "{}") : {};
    expect(bundled.events).toEqual([
      { kind: "plan-step-update", steps: [{ id: "1", text: "Count files", status: "pending" }] },
      {
        kind: "plan-step-update",
        steps: [{ id: "2", text: "Print the branch", status: "pending" }],
      },
    ]);
  });

  test("ordinary tool results are untouched", () => {
    expect(
      normalizeClaudeCodeChunk(
        userChunk({
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tool_1", content: "file contents" }],
          },
        })
      )
    ).toMatchObject({ kind: "tool-output", toolCallId: "tool_1" });
  });
});

describe("normalizeClaudeCodeChunk memory_recall (OS-1598)", () => {
  const memoryChunk = (payload: Record<string, unknown>) => ({
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype: "memory_recall",
      session_id: "s-1",
      ...payload,
    }),
  });

  test("select mode becomes a files recall carrying paths and scope", () => {
    expect(
      normalizeClaudeCodeChunk(
        memoryChunk({
          mode: "select",
          memories: [
            { path: "/home/u/.claude/memory/prefs.md", scope: "personal" },
            { path: "/repo/.claude/memory/rules.md", scope: "team" },
          ],
        })
      )
    ).toMatchObject({
      kind: "memory-recall",
      mode: "files",
      memories: [
        { path: "/home/u/.claude/memory/prefs.md", scope: "personal" },
        { path: "/repo/.claude/memory/rules.md", scope: "team" },
      ],
      sessionId: "s-1",
    });
  });

  test("synthesize mode keeps the content and drops the synthesis path sentinel", () => {
    const event = normalizeClaudeCodeChunk(
      memoryChunk({
        mode: "synthesize",
        memories: [
          {
            path: "<synthesis:/repo/.claude/memory>",
            scope: "team",
            content: "The reviewer treats transcript noise as a correctness bug.",
          },
        ],
      })
    );

    expect(event).toMatchObject({
      kind: "memory-recall",
      mode: "synthesis",
      memories: [
        {
          scope: "team",
          content: "The reviewer treats transcript noise as a correctness bug.",
        },
      ],
    });
    expect(event.kind === "memory-recall" && event.memories[0].path).toBeUndefined();
  });

  test("a recall that matched nothing stays silent metadata", () => {
    expect(
      normalizeClaudeCodeChunk(memoryChunk({ mode: "select", memories: [] }))
    ).toMatchObject({ kind: "metadata", sessionId: "s-1" });
  });

  test("entries with neither a path nor content are dropped", () => {
    expect(
      normalizeClaudeCodeChunk(
        memoryChunk({
          mode: "select",
          memories: [{ scope: "team" }, { path: "/repo/m.md", scope: "team" }],
        })
      )
    ).toMatchObject({
      kind: "memory-recall",
      memories: [{ path: "/repo/m.md", scope: "team" }],
    });
  });

  test("memory recall rows are kept in storage", () => {
    expect(
      isClaudeCodeEphemeralChunk(
        memoryChunk({ mode: "select", memories: [{ path: "/repo/m.md" }] })
      )
    ).toBe(false);
  });
});

describe("normalizeClaudeCodeChunk local_command_output (OS-1598)", () => {
  const localCommandChunk = (content: unknown) => ({
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype: "local_command_output",
      session_id: "s-1",
      content,
    }),
  });

  test("renders as assistant text, as the SDK instructs", () => {
    expect(
      normalizeClaudeCodeChunk(localCommandChunk("Total cost: $0.42\nTotal duration: 3m"))
    ).toEqual({ kind: "text", text: "Total cost: $0.42\nTotal duration: 3m" });
  });

  test("blank output stays silent instead of an empty text part", () => {
    expect(normalizeClaudeCodeChunk(localCommandChunk("   "))).toMatchObject({
      kind: "metadata",
      sessionId: "s-1",
    });
  });
});

describe("normalizeClaudeCodeChunk plugin_install (OS-1598)", () => {
  const pluginChunk = (payload: Record<string, unknown>) => ({
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype: "plugin_install",
      session_id: "s-1",
      ...payload,
    }),
  });

  test("the clean install bracket is silent and ephemeral", () => {
    for (const status of ["started", "installed", "completed"]) {
      const chunk = pluginChunk({ status, name: "anthropic/dataviz" });
      expect(normalizeClaudeCodeChunk(chunk)).toMatchObject({ kind: "metadata" });
      expect(isClaudeCodeEphemeralChunk(chunk)).toBe(true);
    }
  });

  test("a failure renders inline with its error and outlives cleanup", () => {
    const chunk = pluginChunk({
      status: "failed",
      name: "acme/legacy-linter",
      error: "marketplace manifest not found (404)",
    });

    expect(normalizeClaudeCodeChunk(chunk)).toMatchObject({
      kind: "runtime-notice",
      code: "claude-plugin-install-failed",
      title: "Plugin install failed",
      message: "acme/legacy-linter: marketplace manifest not found (404)",
      sessionId: "s-1",
    });
    expect(isClaudeCodeEphemeralChunk(chunk)).toBe(false);
  });

  test("a failure without error text still names the plugin", () => {
    expect(
      normalizeClaudeCodeChunk(pluginChunk({ status: "failed", name: "acme/x" }))
    ).toMatchObject({ message: "acme/x did not install." });
  });
});

describe("normalizeClaudeCodeChunk notification (OS-1598)", () => {
  const notificationChunk = (payload: Record<string, unknown>) => ({
    type: "system",
    data: JSON.stringify({
      type: "system",
      subtype: "notification",
      session_id: "s-1",
      key: "tool_permission_reminder",
      ...payload,
    }),
  });

  test("high and immediate priorities render the payload's own sentence", () => {
    for (const priority of ["high", "immediate"]) {
      const chunk = notificationChunk({
        priority,
        text: "Claude needs your approval to run Bash.",
        timeout_ms: 8000,
      });

      expect(normalizeClaudeCodeChunk(chunk)).toMatchObject({
        kind: "runtime-notice",
        code: "claude-notification",
        title: "Claude notification",
        message: "Claude needs your approval to run Bash.",
        sessionId: "s-1",
      });
      expect(isClaudeCodeEphemeralChunk(chunk)).toBe(false);
    }
  });

  test("low and medium priorities stay silent and ephemeral", () => {
    for (const priority of ["low", "medium"]) {
      const chunk = notificationChunk({ priority, text: "Tip: try /cost." });
      expect(normalizeClaudeCodeChunk(chunk)).toMatchObject({ kind: "metadata" });
      expect(isClaudeCodeEphemeralChunk(chunk)).toBe(true);
    }
  });

  test("a high-priority notification with no text has nothing to render", () => {
    expect(
      normalizeClaudeCodeChunk(notificationChunk({ priority: "high", text: "  " }))
    ).toMatchObject({ kind: "metadata" });
  });
});

describe("normalizeClaudeCodeChunk silent subtypes (OS-1598)", () => {
  const systemChunk = (payload: Record<string, unknown>) => ({
    type: "system",
    data: JSON.stringify({ type: "system", session_id: "s-1", ...payload }),
  });

  test("session_state_changed is level state we already track", () => {
    for (const state of ["running", "requires_action", "idle"]) {
      const chunk = systemChunk({ subtype: "session_state_changed", state });
      expect(normalizeClaudeCodeChunk(chunk)).toMatchObject({ kind: "metadata" });
      expect(isClaudeCodeEphemeralChunk(chunk)).toBe(true);
    }
  });

  test("elicitation_complete carries no renderable outcome", () => {
    const chunk = systemChunk({
      subtype: "elicitation_complete",
      mcp_server_name: "contoso",
      elicitation_id: "elc_1",
    });
    expect(normalizeClaudeCodeChunk(chunk)).toMatchObject({ kind: "metadata" });
    expect(isClaudeCodeEphemeralChunk(chunk)).toBe(true);
  });

  test("post_turn_summary is silent until the SDK actually yields it (OS-1610)", () => {
    expect(
      normalizeClaudeCodeChunk(
        systemChunk({
          subtype: "post_turn_summary",
          status_category: "review_ready",
          title: "Normalize unmapped subtypes",
        })
      )
    ).toMatchObject({ kind: "metadata", sessionId: "s-1" });
  });

  test("prompt_suggestion is a composer affordance, not an unsupported event (OS-1609)", () => {
    const event = normalizeClaudeCodeChunk({
      type: "prompt_suggestion",
      data: JSON.stringify({
        type: "prompt_suggestion",
        suggestion: "Now update the spec.",
        session_id: "s-1",
      }),
    });

    expect(event).toMatchObject({ kind: "metadata", sessionId: "s-1" });
    expect(event.kind === "metadata" && JSON.parse(event.otherJson ?? "{}")).toEqual({
      promptSuggestion: "Now update the spec.",
    });
  });

  test("command_lifecycle is silent queue bookkeeping, not an unsupported event", () => {
    const event = normalizeClaudeCodeChunk({
      type: "command_lifecycle",
      data: JSON.stringify({
        type: "command_lifecycle",
        command_uuid: "c-1",
        state: "queued",
        session_id: "s-1",
      }),
    });

    expect(event).toMatchObject({ kind: "metadata", sessionId: "s-1" });
  });

  test("an unmapped subtype still renders the generic discovery card", () => {
    expect(
      normalizeClaudeCodeChunk(
        systemChunk({ subtype: "sandbox_policy_changed", policy: "workspace-write" })
      )
    ).toMatchObject({
      kind: "runtime-notice",
      code: "claude-system-sandbox_policy_changed",
      title: "Claude runtime notice",
      message: "Claude reported sandbox_policy_changed.",
    });
  });
});

// OS-1806: the runner reports the slash-command inventory as a synthetic chunk;
// it is discovery metadata, so nothing may render for it.
describe("normalizeClaudeCodeChunk convoy.commands", () => {
  test("normalizes the inventory chunk to silent metadata", () => {
    expect(
      normalizeClaudeCodeChunk({
        type: "convoy.commands",
        data: JSON.stringify({ commands: [{ name: "compact" }] }),
      })
    ).toEqual({ kind: "metadata", otherJson: JSON.stringify({ event: "convoy.commands" }) });
  });
});

test("shell wait timeout identifies shell jobs and their shorter ceiling", () => {
  const event = normalizeClaudeCodeChunk({ type: "convoy.background_wait_timeout", data: JSON.stringify({ taskKind: "shell", taskCount: 1, waitedMs: 120000 }) });
  expect(event).toMatchObject({ kind: "runtime-notice", title: "Background shell jobs stopped", message: expect.stringContaining("1 background shell job") });
});

// Shapes from the Claude Code 2.1.318 traces L1–L6 on OS-2270.
describe("normalizeClaudeCodeChunk /goal (OS-2276)", () => {
  const events = (chunk: { type: string; data: string }) =>
    expandCliNormalizedEvent(normalizeClaudeCodeChunk(chunk));
  const goalEvents = (chunk: { type: string; data: string }) =>
    events(chunk).filter((event) => event.kind === "goal");
  const goalReply = (text: string, command = "goal") => ({
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
      session_id: "s-1",
      local_command_source: `<local-command-stdout>${text}</local-command-stdout>`,
      local_command_run: { command, args: "" },
    }),
  });
  const userText = (text: string, parentToolUseId: string | null = null) => ({
    type: "user",
    data: JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: parentToolUseId,
      session_id: "s-1",
    }),
  });
  const result = (fields: Record<string, unknown>) => ({
    type: "result",
    data: JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "s-1", ...fields }),
  });

  const notices = (chunk: { type: string; data: string }) =>
    events(chunk).filter((event) => event.kind === "runtime-notice");

  test("a set reply renders as a goal notice instead of text", () => {
    const chunk = goalReply("Goal set: count.txt contains the number 3");
    expect(events(chunk).some((event) => event.kind === "text")).toBe(false);
    expect(goalEvents(chunk)).toEqual([
      { kind: "goal", source: "set", objective: "count.txt contains the number 3", sessionId: "s-1" },
    ]);
    expect(notices(chunk)).toEqual([{
      kind: "runtime-notice", code: "goal-set", title: "Goal set", message: "count.txt contains the number 3", sessionId: "s-1",
    }]);
  });

  test("a status reply reports the active goal, its turn count and last check", () => {
    const chunk = goalReply(
      "Goal active: count.txt contains the number 5 (2 turns)\nLast check: count.txt contains 1, not 5."
    );
    expect(goalEvents(chunk)).toEqual([{
      kind: "goal", source: "report", status: "active", objective: "count.txt contains the number 5",
      iterations: 2, lastReason: "count.txt contains 1, not 5.", sessionId: "s-1",
    }]);
    expect(notices(chunk)).toEqual([expect.objectContaining({
      code: "goal-status", title: "Goal active",
      message: "count.txt contains the number 5 (2 checks). Last check: count.txt contains 1, not 5.",
    })]);
  });

  test("a status reply before the first check reports zero turns", () => {
    const chunk = goalReply("Goal active: count.txt contains the number 5 (not yet evaluated)");
    expect(goalEvents(chunk)).toEqual([{
      kind: "goal", source: "report", status: "active", objective: "count.txt contains the number 5",
      iterations: 0, sessionId: "s-1",
    }]);
    expect(notices(chunk)).toEqual([expect.objectContaining({
      code: "goal-status", title: "Goal active", message: "count.txt contains the number 5 (not checked yet)",
    })]);
  });

  test("a clear reply clears the goal", () => {
    const chunk = goalReply("Goal cleared: count.txt contains the number 5");
    expect(goalEvents(chunk)).toEqual([
      { kind: "goal", source: "cleared", objective: "count.txt contains the number 5", sessionId: "s-1" },
    ]);
    expect(notices(chunk)).toEqual([expect.objectContaining({
      code: "goal-cleared", title: "Goal cleared", message: "count.txt contains the number 5",
    })]);
  });

  test.each(["No goal set. Usage: `/goal <condition>`", "No goal set"])("%j reports no goal", (text) => {
    const chunk = goalReply(text);
    expect(goalEvents(chunk)).toEqual([
      { kind: "goal", source: "report", status: "none", sessionId: "s-1" },
    ]);
    expect(notices(chunk)).toEqual([expect.objectContaining({ code: "goal-status", title: "Goal", message: "No goal set" })]);
  });

  test("goal-shaped text without goal command provenance is plain text", () => {
    expect(goalEvents(goalReply("Goal set: X", "cost"))).toEqual([]);
    const modelText = {
      type: "assistant",
      data: JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Goal set: X" }] } }),
    };
    expect(goalEvents(modelText)).toEqual([]);
  });

  test("an unrecognized goal reply stays plain text", () => {
    const chunk = goalReply("Goal condition is limited to 4000 characters (got 4100)");
    expect(goalEvents(chunk)).toEqual([]);
    expect(events(chunk)).toContainEqual({ kind: "text", text: "Goal condition is limited to 4000 characters (got 4100)" });
  });

  test("goal Stop hook feedback becomes a check and a visible notice", () => {
    const chunk = userText(
      "Stop hook feedback:\n[count.txt contains the number 3]: count.txt contains 1, not 3."
    );
    expect(goalEvents(chunk)).toEqual([{
      kind: "goal", source: "check", objective: "count.txt contains the number 3",
      lastReason: "count.txt contains 1, not 3.", sessionId: "s-1",
    }]);
    expect(events(chunk)).toContainEqual(expect.objectContaining({
      kind: "runtime-notice", code: "goal-check", title: "Goal not met yet", message: "count.txt contains 1, not 3.",
    }));
  });

  test("a reason containing `]: ` stays whole", () => {
    expect(goalEvents(userText("Stop hook feedback:\n[a.txt exists]: Missing [see]: line 3."))).toEqual([{
      kind: "goal", source: "check", objective: "a.txt exists", lastReason: "Missing [see]: line 3.", sessionId: "s-1",
    }]);
  });

  test("Stop hook feedback without a goal prefix is a user hook notice only", () => {
    const chunk = userText("Stop hook feedback:\nRun the tests before you stop.");
    expect(goalEvents(chunk)).toEqual([]);
    expect(events(chunk)).toContainEqual(expect.objectContaining({
      kind: "runtime-notice", code: "stop-hook-feedback", title: "Stop hook feedback", message: "Run the tests before you stop.",
    }));
  });

  test("subagent Stop hook feedback echoes are not goal checks", () => {
    expect(goalEvents(userText("Stop hook feedback:\n[X]: not yet", "toolu_child"))).toEqual([]);
  });

  test("a completed run reports run-completed", () => {
    expect(goalEvents(result({ terminal_reason: "completed" }))).toEqual([
      { kind: "goal", source: "run-completed", sessionId: "s-1" },
    ]);
  });

  test.each([
    { terminal_reason: "aborted_streaming" },
    { terminal_reason: "max_turns" },
    { terminal_reason: "completed", is_error: true },
    {},
  ])("a run ending %j does not report run-completed", (fields) => {
    expect(goalEvents(result(fields))).toEqual([]);
  });
});
