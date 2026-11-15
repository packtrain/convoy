import { describe, expect, test } from "vitest";
import { normalizeCliChunkToEvent, resolveChunkReadEvent } from "./normalizedEvents";

test("re-normalizes historical unsupported Codex sleep events", () => {
  expect(resolveChunkReadEvent({
    type: "item/started",
    data: JSON.stringify({ item: { type: "sleep", id: "old-sleep", durationMs: 20_000 } }),
    normalizedEvent: { kind: "unknown", reason: "unrecognized-codex-app-server-item:sleep", rawType: "item/started" },
  }, "codex")).toMatchObject({ kind: "sleep", phase: "started", itemId: "old-sleep", durationMs: 20_000 });
});

function chunk(type: string, payload: Record<string, unknown>) {
  return { type, data: JSON.stringify(payload) };
}

describe("normalizeCliChunkToEvent", () => {
  // A Workflow bash step's output is plain text whatever runtime the thread runs (OS-1886).
  test("renders script output as text for any runtime", () => {
    const chunk = { type: "convoy_script_output", data: "src/a.ts: unused import\n" };
    expect(normalizeCliChunkToEvent(chunk, "codex")).toEqual({ kind: "text", text: "src/a.ts: unused import\n" });
    expect(normalizeCliChunkToEvent(chunk)).toEqual({ kind: "text", text: "src/a.ts: unused import\n" });
  });

  // ── assistant: text ──────────────────────────────────────────────
  test("extracts text from assistant message", () => {
    const result = normalizeCliChunkToEvent(
      chunk("assistant", {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
        },
      })
    );
    expect(result).toEqual({ kind: "text", text: "Hello world" });
  });

  // ── assistant: reasoning ─────────────────────────────────────────
  test("extracts reasoning from assistant thinking block", () => {
    const result = normalizeCliChunkToEvent(
      chunk("assistant", {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Let me consider..." }],
        },
      })
    );
    expect(result).toEqual({ kind: "reasoning", text: "Let me consider..." });
  });

  // ── assistant: tool-input ────────────────────────────────────────
  test("extracts tool-input from assistant tool_use block", () => {
    const result = normalizeCliChunkToEvent(
      chunk("assistant", {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "Grep",
              input: { pattern: "foo" },
            },
          ],
        },
      })
    );
    expect(result).toEqual({
      kind: "tool-input",
      toolCallId: "toolu_123",
      toolName: "Grep",
      inputJson: JSON.stringify({ pattern: "foo" }),
    });
  });

  test("preserves parent_tool_use_id on assistant tool_use blocks", () => {
    const result = normalizeCliChunkToEvent(
      chunk("assistant", {
        type: "assistant",
        parent_tool_use_id: "toolu_parent_1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_123",
              name: "Glob",
              input: { pattern: "apps/web/**/*.tsx" },
            },
          ],
        },
      })
    );

    expect(result).toEqual({
      kind: "tool-input",
      toolCallId: "toolu_123",
      toolName: "Glob",
      inputJson: JSON.stringify({ pattern: "apps/web/**/*.tsx" }),
      parentToolUseId: "toolu_parent_1",
    });
  });

  // ── user: tool-output ────────────────────────────────────────────
  test("extracts tool-output from user tool_result", () => {
    const result = normalizeCliChunkToEvent(
      chunk("user", {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "file.ts:42",
              is_error: false,
            },
          ],
        },
      })
    );
    expect(result).toEqual({
      kind: "tool-output",
      toolCallId: "toolu_123",
      outputJson: "file.ts:42",
    });
  });

  test("preserves parent_tool_use_id on user tool_result blocks", () => {
    const result = normalizeCliChunkToEvent(
      chunk("user", {
        type: "user",
        parent_tool_use_id: "toolu_parent_1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_123",
              content: "file.ts:42",
              is_error: false,
            },
          ],
        },
      })
    );

    expect(result).toEqual({
      kind: "tool-output",
      toolCallId: "toolu_123",
      outputJson: "file.ts:42",
      parentToolUseId: "toolu_parent_1",
    });
  });

  // ── user: tool-error ─────────────────────────────────────────────
  test("extracts tool-error from user tool_result with is_error", () => {
    const result = normalizeCliChunkToEvent(
      chunk("user", {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_456",
              content: "Permission denied",
              is_error: true,
            },
          ],
        },
      })
    );
    expect(result).toEqual({
      kind: "tool-error",
      toolCallId: "toolu_456",
      errorText: "Permission denied",
    });
  });

  test("preserves parent_tool_use_id on errored user tool_result blocks", () => {
    const result = normalizeCliChunkToEvent(
      chunk("user", {
        type: "user",
        parent_tool_use_id: "toolu_parent_1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_456",
              content: "Permission denied",
              is_error: true,
            },
          ],
        },
      })
    );

    expect(result).toEqual({
      kind: "tool-error",
      toolCallId: "toolu_456",
      errorText: "Permission denied",
      parentToolUseId: "toolu_parent_1",
    });
  });

  // ── result: metadata only (context usage comes from the synthetic chunk) ──
  test("maps result event to metadata without a context-window event", () => {
    const result = normalizeCliChunkToEvent(
      chunk("result", {
        type: "result",
        subtype: "success",
        session_id: "session-1",
        total_cost_usd: 0.05,
        duration_ms: 3000,
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 900,
          output_tokens: 200,
          total_tokens: 848_870,
        },
        modelUsage: {
          "claude-opus-4-6": {
            inputTokens: 100,
            outputTokens: 200,
            contextWindow: 300000,
          },
        },
      })
    );

    // result.usage is cumulative API usage, never the live context size; it
    // stays in metadata (cost pipeline, cache tokens included) and must not
    // produce a context-window event.
    expect(result).toEqual({
      kind: "metadata",
      sessionId: "session-1",
      otherJson: JSON.stringify({
        resultSubtype: "success",
        totalCostUsd: 0.05,
        durationMs: 3000,
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 900,
          output_tokens: 200,
          total_tokens: 848_870,
        },
        modelUsage: {
          "claude-opus-4-6": {
            inputTokens: 100,
            outputTokens: 200,
            contextWindow: 300000,
          },
        },
      }),
    });
  });

  // ── convoy.context_usage: context-window ───────────────────────
  test("maps the synthetic context usage chunk to a context-window event", () => {
    const result = normalizeCliChunkToEvent(
      chunk("convoy.context_usage", {
        type: "convoy.context_usage",
        usedTokens: 33_729,
        maxTokens: 1_000_000,
      })
    );

    expect(result).toEqual({
      kind: "context-window",
      usedTokens: 33_729,
      maxTokens: 1_000_000,
    });
  });

  test("maps malformed synthetic context usage chunks to silent metadata", () => {
    const missingMax = normalizeCliChunkToEvent(
      chunk("convoy.context_usage", {
        type: "convoy.context_usage",
        usedTokens: 33_729,
      })
    );
    expect(missingMax.kind).toBe("metadata");

    const nonPositive = normalizeCliChunkToEvent(
      chunk("convoy.context_usage", {
        type: "convoy.context_usage",
        usedTokens: 0,
        maxTokens: -1,
      })
    );
    expect(nonPositive.kind).toBe("metadata");
  });

  // ── convoy.background_wait_timeout: Convoy-authored notice (OS-1661) ──
  test("renders the background wait timeout with its own text, not generic boilerplate", () => {
    const result = normalizeCliChunkToEvent(
      chunk("convoy.background_wait_timeout", {
        type: "convoy.background_wait_timeout",
        waitedMs: 1_800_000,
        taskCount: 2,
      })
    );

    expect(result).toMatchObject({
      kind: "runtime-notice",
      code: "convoy-background-wait-timeout",
      title: "Background agents stopped",
    });
    // The whole point of the dedicated chunk type: the reason survives to the user.
    expect(result.kind === "runtime-notice" && result.message).toBe(
      "Stopped waiting after 30 minutes with 2 background agents still running. They were ended with this turn and did not report back."
    );
  });

  test("keeps result metadata-only for minimal usage payloads", () => {
    const result = normalizeCliChunkToEvent(
      chunk("result", {
        type: "result",
        session_id: "session-1",
        usage: { input_tokens: 100, output_tokens: 200 },
      })
    );

    expect(result).toEqual({
      kind: "metadata",
      sessionId: "session-1",
      otherJson: JSON.stringify({
        resultSubtype: undefined,
        totalCostUsd: undefined,
        durationMs: undefined,
        usage: { input_tokens: 100, output_tokens: 200 },
        modelUsage: undefined,
      }),
    });
  });

  // ── system: metadata ─────────────────────────────────────────────
  test("maps system event to metadata with system init details", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "init",
        session_id: "session-1",
        model: "claude-opus-4-6",
        claude_code_version: "2.1.34",
        permissionMode: "default",
        tools: ["Bash", "Read"],
      })
    );
    expect(result).toEqual({
      kind: "metadata",
      sessionId: "session-1",
      backgroundTasks: { sessionId: "session-1", tasks: [], totalCount: 0 },
      otherJson: JSON.stringify({
        systemInit: {
          model: "claude-opus-4-6",
          claudeCodeVersion: "2.1.34",
          permissionMode: "default",
          tools: ["Bash", "Read"],
        },
      }),
    });
  });

  test("maps Claude api_retry system events to runtime notices", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "api_retry",
        session_id: "session-1",
        attempt: 2,
        max_retries: 10,
        retry_delay_ms: 1231.402127403761,
        error_status: null,
        error: "unknown",
      })
    );

    expect(result).toEqual({
      kind: "runtime-notice",
      code: "claude-api-retry",
      title: "Claude API retry",
      message: "Attempt 2 of 10. Retrying in 1.2s.",
      sessionId: "session-1",
      detailsJson: JSON.stringify({
        subtype: "api_retry",
        attempt: 2,
        maxRetries: 10,
        retryDelayMs: 1231.402127403761,
        errorStatus: null,
        error: "unknown",
      }),
    });
  });

  test("maps unknown system subtypes to generic runtime notices", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "rate_limit",
        session_id: "session-1",
      })
    );

    expect(result).toEqual({
      kind: "runtime-notice",
      code: "claude-system-rate_limit",
      title: "Claude runtime notice",
      message: "Claude reported rate_limit.",
      sessionId: "session-1",
      detailsJson: JSON.stringify({
        subtype: "rate_limit",
        payload: {
          type: "system",
          subtype: "rate_limit",
          session_id: "session-1",
        },
      }),
    });
  });

  test("Claude status system events are silent metadata", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "status",
        status: "requesting",
        permissionMode: "plan",
        uuid: "ebe19d18-9b5e-4543-bdd6-7f0b0966bb16",
        session_id: "session-1",
      })
    );

    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata") {
      expect(result.sessionId).toBe("session-1");
      expect(result.otherJson).toContain('"requesting"');
    }
  });

  test("Claude commands_changed system events are silent metadata", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "commands_changed",
        commands: [{ name: "review", description: "Review a PR", argumentHint: "" }],
        uuid: "4b6e5841-0edd-4f9c-b0d0-ea9c38555b65",
        session_id: "session-1",
      })
    );

    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata") {
      expect(result.sessionId).toBe("session-1");
    }
  });

  test("maps Claude compact boundary system events to context compaction events", () => {
    const payload = {
      type: "system",
      subtype: "compact_boundary",
      session_id: "session-1",
      uuid: "9d68d70f-6a4f-454a-8c70-611e6e1e1d21",
      message: "Compacted previous context.",
    };
    const result = normalizeCliChunkToEvent(chunk("system", payload));

    expect(result).toEqual({
      kind: "context-compaction",
      message: "Context compacted.",
      sessionId: "session-1",
      detailsJson: JSON.stringify({
        subtype: "compact_boundary",
        payload,
      }),
    });
  });

  test("compacting status heartbeat opens a pending compaction (OS-1593)", () => {
    const payload = {
      type: "system",
      subtype: "status",
      status: "compacting",
      session_id: "session-1",
    };
    const result = normalizeCliChunkToEvent(chunk("system", payload));

    expect(result).toEqual({
      kind: "context-compaction",
      message: "Compacting…",
      inProgress: true,
      sessionId: "session-1",
      detailsJson: JSON.stringify({ subtype: "status", payload }),
    });
  });

  test("non-compaction status heartbeats stay silent", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "status",
        status: "requesting",
        session_id: "session-1",
      })
    );

    expect(result.kind).toBe("metadata");
  });

  test("omits systemInit from otherJson for system chunks without init fields", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        session_id: "session-1",
      })
    );
    expect(result).toEqual({
      kind: "metadata",
      sessionId: "session-1",
    });
  });

  // ── unknown type ─────────────────────────────────────────────────
  test("returns unknown for unsupported event type", () => {
    const result = normalizeCliChunkToEvent(
      chunk("ping", { type: "ping", ts: 123 })
    );
    expect(result).toEqual({
      kind: "unknown",
      reason: "unsupported-type",
      rawType: "ping",
      rawData: JSON.stringify({ type: "ping", ts: 123 }),
    });
  });

  // ── JSON parse failure ───────────────────────────────────────────
  test("returns unknown on JSON parse failure", () => {
    const result = normalizeCliChunkToEvent({
      type: "assistant",
      data: "not-valid-json{{{",
    });
    expect(result).toEqual({
      kind: "unknown",
      reason: "json-parse-error",
      rawType: "assistant",
      rawData: "not-valid-json{{{",
    });
  });

  // ── bundled: multiple content blocks ─────────────────────────────
  test("bundles multiple assistant content blocks into metadata", () => {
    const result = normalizeCliChunkToEvent(
      chunk("assistant", {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Here is the plan" },
            {
              type: "tool_use",
              id: "toolu_789",
              name: "Edit",
              input: { file: "a.ts" },
            },
          ],
        },
      })
    );
    expect(result.kind).toBe("metadata");
    const parsed = JSON.parse(
      (result as { kind: "metadata"; otherJson: string }).otherJson!
    );
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toEqual({
      kind: "text",
      text: "Here is the plan",
    });
    expect(parsed.events[1]).toEqual({
      kind: "tool-input",
      toolCallId: "toolu_789",
      toolName: "Edit",
      inputJson: JSON.stringify({ file: "a.ts" }),
    });
  });

  // ── assistant: no recognized blocks ──────────────────────────────
  test("returns unknown when assistant has no recognized content blocks", () => {
    const result = normalizeCliChunkToEvent(
      chunk("assistant", {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "redacted", data: "..." }],
        },
      })
    );
    expect(result).toEqual({
      kind: "unknown",
      reason: "no-recognized-content-blocks",
      rawType: "assistant",
      rawData: JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "redacted", data: "..." }],
        },
      }),
    });
  });

  test("returns unknown with raw data when user has no recognized content blocks", () => {
    const result = normalizeCliChunkToEvent(
      chunk("user", {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_status", state: "pending", note: "..." }],
        },
      })
    );

    expect(result).toEqual({
      kind: "unknown",
      reason: "no-recognized-content-blocks",
      rawType: "user",
      rawData: JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_status", state: "pending", note: "..." }],
        },
      }),
    });
  });

  test("preserves nested user text echoes as unknown events for downstream dedupe", () => {
    const result = normalizeCliChunkToEvent(
      chunk("user", {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "Explore the development setup of this project.",
            },
          ],
        },
        parent_tool_use_id: "toolu_nested_1",
        session_id: "session-1",
      })
    );

    expect(result).toEqual({
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
              text: "Explore the development setup of this project.",
            },
          ],
        },
        parent_tool_use_id: "toolu_nested_1",
        session_id: "session-1",
      }),
    });
  });

  test("keeps nested synthetic user text silent", () => {
    const text = "[Image: original 2352x1280, displayed at 2000x1088. Multiply coordinates by 1.18 to map to original image.]";
    const result = normalizeCliChunkToEvent(
      chunk("user", {
        type: "user",
        message: { role: "user", content: [{ type: "text", text }] },
        parent_tool_use_id: "toolu_nested_1",
        session_id: "session-1",
        isSynthetic: true,
      })
    );

    expect(result).toEqual({
      kind: "metadata",
      sessionId: "session-1",
      otherJson: JSON.stringify({ userTextContent: [text] }),
    });
  });

  // ── tool_use with no input ───────────────────────────────────────
  test("handles tool_use block with missing input gracefully", () => {
    const result = normalizeCliChunkToEvent(
      chunk("assistant", {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_x", name: "Bash" }],
        },
      })
    );
    expect(result).toEqual({
      kind: "tool-input",
      toolCallId: "toolu_x",
      toolName: "Bash",
      inputJson: "{}",
    });
  });
});

describe("normalizeCliChunkToEvent (telemetry and notices)", () => {
  test("thinking_tokens system chunks are silent metadata", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "thinking_tokens",
        estimated_tokens: 26,
        session_id: "s1",
      })
    );
    expect(result.kind).toBe("metadata");
  });

  test("hook_started and successful hook_response are silent metadata", () => {
    expect(
      normalizeCliChunkToEvent(
        chunk("system", { type: "system", subtype: "hook_started", hook_name: "SessionStart" })
      ).kind
    ).toBe("metadata");
    expect(
      normalizeCliChunkToEvent(
        chunk("system", {
          type: "system",
          subtype: "hook_response",
          hook_name: "SessionStart:startup",
          outcome: "success",
          exit_code: 0,
        })
      ).kind
    ).toBe("metadata");
  });

  test("failed hook_response surfaces a runtime notice", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "hook_response",
        hook_name: "PreToolUse:guard",
        outcome: "error",
        exit_code: 2,
      })
    );
    expect(result).toMatchObject({
      kind: "runtime-notice",
      code: "claude-hook-failed",
    });
    if (result.kind === "runtime-notice") {
      expect(result.message).toContain("PreToolUse:guard");
      expect(result.message).toContain("exit code 2");
    }
  });

  test("permission_denied surfaces a tool-blocked notice", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "permission_denied",
        tool_name: "Bash",
      })
    );
    expect(result).toMatchObject({
      kind: "runtime-notice",
      code: "claude-permission-denied",
    });
    if (result.kind === "runtime-notice") {
      expect(result.message).toContain("Bash");
    }
  });

  test("files_persisted reports file counts", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "files_persisted",
        files: ["a.ts", "b.ts"],
        failed: ["c.ts"],
      })
    );
    expect(result).toMatchObject({
      kind: "runtime-notice",
      code: "claude-files-persisted",
    });
    if (result.kind === "runtime-notice") {
      expect(result.message).toBe("Persisted 2 files; 1 failed.");
    }
  });

  test("mirror_error surfaces the error text", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "mirror_error",
        error: "sync failed",
      })
    );
    expect(result).toMatchObject({
      kind: "runtime-notice",
      code: "claude-mirror-error",
      message: "sync failed",
    });
  });

  test("compact_boundary includes trigger and pre-compaction tokens", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 145000 },
      })
    );
    expect(result.kind).toBe("context-compaction");
    if (result.kind === "context-compaction") {
      expect(result.message).toBe(
        "Context compacted automatically (was ~145,000 tokens)."
      );
    }
  });

  test("init metadata captures slash commands, agents, and plugins", () => {
    const result = normalizeCliChunkToEvent(
      chunk("system", {
        type: "system",
        subtype: "init",
        model: "claude-sonnet-5",
        slash_commands: ["/compact"],
        agents: ["Explore"],
        plugins: [{ name: "codex" }],
      })
    );
    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata" && result.otherJson) {
      const parsed = JSON.parse(result.otherJson) as {
        systemInit: Record<string, unknown>;
      };
      expect(parsed.systemInit.slashCommands).toEqual(["/compact"]);
      expect(parsed.systemInit.agents).toEqual(["Explore"]);
      expect(parsed.systemInit.plugins).toEqual([{ name: "codex" }]);
    }
  });

  test("rate_limit_event normalizes to a usage-limit snapshot", () => {
    const result = normalizeCliChunkToEvent(
      chunk("rate_limit_event", {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed_warning",
          rateLimitType: "five_hour",
          utilization: 0.94,
          resetsAt: 1751500000,
          isUsingOverage: false,
        },
      })
    );
    expect(result).toMatchObject({
      kind: "usage-limit",
      window: "5h",
      utilization: 0.94,
      resetsAt: 1751500000,
      status: "allowed_warning",
    });
    if (result.kind === "usage-limit") {
      expect(result.isUsingOverage).toBeUndefined();
    }
  });

  test("allowed rate_limit_event is also a usage-limit snapshot (state, not a log)", () => {
    const result = normalizeCliChunkToEvent(
      chunk("rate_limit_event", {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "allowed",
          rateLimitType: "seven_day",
          utilization: 0.12,
          resetsAt: 1751500000,
        },
      })
    );
    expect(result).toMatchObject({
      kind: "usage-limit",
      window: "weekly",
      utilization: 0.12,
      status: "allowed",
    });
  });

  test("rate_limit_event without rate_limit_info stays silent metadata", () => {
    const result = normalizeCliChunkToEvent(
      chunk("rate_limit_event", { type: "rate_limit_event" })
    );
    expect(result.kind).toBe("metadata");
  });

  test("tool_progress normalizes to a tool-progress event", () => {
    const result = normalizeCliChunkToEvent(
      chunk("tool_progress", {
        type: "tool_progress",
        tool_use_id: "toolu_9",
        tool_name: "Bash",
        elapsed_time_seconds: 42,
        parent_tool_use_id: "toolu_parent",
      })
    );
    expect(result).toEqual({
      kind: "tool-progress",
      toolCallId: "toolu_9",
      toolName: "Bash",
      elapsedSeconds: 42,
      parentToolUseId: "toolu_parent",
    });
  });

  test("tool_progress without a tool id falls back to silent metadata", () => {
    const result = normalizeCliChunkToEvent(
      chunk("tool_progress", { type: "tool_progress", elapsed_time_seconds: 3 })
    );
    expect(result.kind).toBe("metadata");
  });

  test("tool_use_summary surfaces the summary text", () => {
    const result = normalizeCliChunkToEvent(
      chunk("tool_use_summary", {
        type: "tool_use_summary",
        summary: "Read three files and ran the tests.",
      })
    );
    expect(result).toMatchObject({
      kind: "runtime-notice",
      code: "claude-tool-summary",
      message: "Read three files and ran the tests.",
    });
  });

  test.each([false, true, undefined])("auth failure remains visible when isAuthenticating=%s", (isAuthenticating) => {
    const payload = { type: "auth_status", isAuthenticating, error: "Login expired", output: ["Sign in again"] };
    const result = normalizeCliChunkToEvent(chunk("auth_status", payload));
    expect(result).toMatchObject({
      kind: "runtime-notice", code: "claude-auth-error", title: "Claude authentication failed",
      message: "Login expired\nSign in again", detailsJson: JSON.stringify({ payload }),
    });
  });

  test("error-only authentication retains its cause without output", () => {
    expect(normalizeCliChunkToEvent(chunk("auth_status", { error: "Login expired" }))).toMatchObject({ kind: "runtime-notice", code: "claude-auth-error", message: "Login expired" });
    expect(normalizeCliChunkToEvent(chunk("auth_status", { isAuthenticating: false, error: "  " })).kind).toBe("metadata");
  });

  test("stored authentication errors are re-normalized on read", () => {
    expect(resolveChunkReadEvent({
      type: "auth_status", data: JSON.stringify({ error: "Login expired", isAuthenticating: false }),
      normalizedEvent: { kind: "metadata", otherJson: "{}" },
    }, "claude-code")).toMatchObject({ kind: "runtime-notice", code: "claude-auth-error" });
  });

  test("auth_status is silent unless authenticating", () => {
    expect(
      normalizeCliChunkToEvent(
        chunk("auth_status", { type: "auth_status", isAuthenticating: false })
      ).kind
    ).toBe("metadata");

    const authenticating = normalizeCliChunkToEvent(
      chunk("auth_status", {
        type: "auth_status",
        isAuthenticating: true,
        output: "Open the browser to sign in",
      })
    );
    expect(authenticating).toMatchObject({
      kind: "runtime-notice",
      code: "claude-auth-status",
      message: "Open the browser to sign in",
    });

    // The SDK types output as string[].
    const arrayOutput = normalizeCliChunkToEvent(
      chunk("auth_status", {
        type: "auth_status",
        isAuthenticating: true,
        output: ["Visit https://claude.ai/auth", "Enter code 1234"],
      })
    );
    expect(arrayOutput).toMatchObject({
      kind: "runtime-notice",
      code: "claude-auth-status",
      message: "Visit https://claude.ai/auth\nEnter code 1234",
    });
  });

  test.each([
    [{ api_error_status: 529 }, "overloaded (529)"],
    [{ terminal_reason: "prompt_too_long" }, "context window"],
    [{ terminal_reason: "api_error" }, "API errors"],
  ])("shows success-tagged structured result failure %j", (fields, message) => {
    const event = normalizeCliChunkToEvent(chunk("result", { type: "result", subtype: "success", is_error: false, ...fields }));
    expect(event.kind).toBe("metadata");
    if (event.kind !== "metadata") throw new Error("Expected metadata");
    const events = JSON.parse(event.otherJson ?? "{}").events ?? [];
    expect(events.find((e: { code?: string }) => e.code === "claude-result-error")?.message).toContain(message);
  });

  test.each(["aborted_tools", "aborted_streaming"])("keeps explicit interruption %s quiet", (terminal_reason) => {
    const event = normalizeCliChunkToEvent(chunk("result", { type: "result", subtype: "error_during_execution", is_error: true, terminal_reason }));
    expect(event.kind).toBe("metadata");
    if (event.kind !== "metadata") throw new Error("Expected metadata");
    expect(JSON.parse(event.otherJson ?? "{}")).toMatchObject({ terminalReason: terminal_reason, resultOutcome: "interrupted" });
  });

  test("error results bundle a run-error notice with result metadata", () => {
    const result = normalizeCliChunkToEvent(
      chunk("result", {
        type: "result",
        subtype: "success",
        is_error: true,
        result: "API Error: Could not load credentials from any providers",
        session_id: "s1",
      })
    );
    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata" && result.otherJson) {
      const parsed = JSON.parse(result.otherJson) as { events: Array<{ kind: string; code?: string; message?: string }> };
      const notice = parsed.events.find((event) => event.kind === "runtime-notice");
      expect(notice).toMatchObject({
        code: "claude-result-error",
        message: "API Error: Could not load credentials from any providers",
      });
    }
  });

  test("error_max_turns results surface a run-error notice", () => {
    const result = normalizeCliChunkToEvent(
      chunk("result", {
        type: "result",
        subtype: "error_max_turns",
        errors: [],
      })
    );
    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata" && result.otherJson) {
      const parsed = JSON.parse(result.otherJson) as { events: Array<{ kind: string; message?: string }> };
      const notice = parsed.events.find((event) => event.kind === "runtime-notice");
      expect(notice?.message).toBe("Claude run ended with error_max_turns.");
    }
  });

  test("an interrupted-while-parked result carries no run-error notice (OS-1463)", () => {
    // Interrupting a turn blocked on an unresolved tool call (plan approval,
    // question) makes the CLI end with this exact diagnostic. Self-inflicted
    // wind-down, not a failure worth a red notice.
    const result = normalizeCliChunkToEvent(
      chunk("result", {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: [
          "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use",
        ],
        result: null,
        session_id: "s1",
      })
    );
    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata" && result.otherJson) {
      expect(result.otherJson).not.toContain("claude-result-error");
    }
  });

  test("an error_during_execution without the parked signature still notices", () => {
    const result = normalizeCliChunkToEvent(
      chunk("result", {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        errors: ["tool executor crashed"],
        result: null,
      })
    );
    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata" && result.otherJson) {
      expect(result.otherJson).toContain("claude-result-error");
    }
  });

  test("successful results do not gain a run-error notice", () => {
    const result = normalizeCliChunkToEvent(
      chunk("result", {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "done",
      })
    );
    expect(result.kind).toBe("metadata");
    if (result.kind === "metadata" && result.otherJson) {
      expect(result.otherJson).not.toContain("claude-result-error");
    }
  });
});

describe("normalizeCliChunkToEvent (stream_event partial streaming)", () => {
  function streamEventChunk(
    event: Record<string, unknown>,
    extra: Record<string, unknown> = {}
  ) {
    return chunk("stream_event", {
      type: "stream_event",
      session_id: "s1",
      event,
      ...extra,
    });
  }

  test("text_delta becomes a text-delta event", () => {
    const result = normalizeCliChunkToEvent(
      streamEventChunk({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hel" },
      })
    );
    expect(result).toEqual({ kind: "text-delta", text: "Hel" });
  });

  test("thinking_delta becomes a reasoning-delta event", () => {
    const result = normalizeCliChunkToEvent(
      streamEventChunk({
        type: "content_block_delta",
        index: 1,
        delta: { type: "thinking_delta", thinking: "Consider" },
      })
    );
    expect(result).toEqual({ kind: "reasoning-delta", text: "Consider" });
  });

  test("a thinking block start becomes an empty reasoning-delta so the live label shows", () => {
    const result = normalizeCliChunkToEvent(
      streamEventChunk({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      })
    );
    expect(result).toEqual({ kind: "reasoning-delta", text: "" });
  });

  test("subagent deltas preserve source for transcript suppression", () => {
    const result = normalizeCliChunkToEvent(
      streamEventChunk(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "child output" },
        },
        { parent_tool_use_id: "toolu_parent" }
      )
    );
    expect(result).toMatchObject({ kind: "text-delta", source: { parentToolUseId: "toolu_parent", scope: "child" } });
  });

  test("input_json_delta and signature_delta stay silent metadata", () => {
    for (const delta of [
      { type: "input_json_delta", partial_json: '{"pat' },
      { type: "signature_delta", signature: "abc" },
    ]) {
      const result = normalizeCliChunkToEvent(
        streamEventChunk({ type: "content_block_delta", index: 0, delta })
      );
      expect(result.kind).toBe("metadata");
    }
  });

  test("message lifecycle stream events stay silent metadata", () => {
    for (const event of [
      { type: "message_start", message: { id: "msg_1" } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", usage: { output_tokens: 42 } },
      { type: "message_stop" },
    ]) {
      const result = normalizeCliChunkToEvent(streamEventChunk(event));
      expect(result.kind).toBe("metadata");
    }
  });
});

describe("resolveChunkReadEvent", () => {
  test("trusts the stored normalizedEvent for non result/system chunks", () => {
    const stored = { kind: "text", text: "hello" } as const;
    expect(
      resolveChunkReadEvent(
        { type: "assistant", data: "{}", normalizedEvent: stored },
        "claude-code"
      )
    ).toBe(stored);
  });

  test("re-normalizes stored unknown events and keeps rawData when still unknown", () => {
    expect(
      resolveChunkReadEvent(
        {
          type: "assistant",
          data: "raw-line",
          normalizedEvent: { kind: "unknown", reason: "no-handler", rawType: "assistant" },
        },
        "claude-code"
      )
    ).toEqual({
      kind: "unknown",
      reason: "json-parse-error",
      rawType: "assistant",
      rawData: "raw-line",
    });
  });

  test("upgrades stored unknown events for chunk types that gained mappings", () => {
    const result = resolveChunkReadEvent(
      {
        type: "rate_limit_event",
        data: JSON.stringify({
          type: "rate_limit_event",
          rate_limit_info: { status: "allowed", resetsAt: 1751500000 },
        }),
        normalizedEvent: {
          kind: "unknown",
          reason: "unsupported-type",
          rawType: "rate_limit_event",
        },
      },
      "claude-code"
    );
    expect(result?.kind).toBe("usage-limit");
  });

  test("re-normalizes stored rate_limit_event notices into usage-limit snapshots", () => {
    const result = resolveChunkReadEvent(
      {
        type: "rate_limit_event",
        data: JSON.stringify({
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed_warning",
            rateLimitType: "five_hour",
            utilization: 0.94,
            resetsAt: 1751500000,
          },
        }),
        normalizedEvent: {
          kind: "runtime-notice",
          code: "claude-rate-limit",
          title: "Claude rate limit",
          message: "Claude reported rate limit status: allowed_warning.",
        },
      },
      "claude-code"
    );
    expect(result).toMatchObject({
      kind: "usage-limit",
      window: "5h",
      utilization: 0.94,
    });
  });

  test("re-normalizes result/system chunks instead of trusting the stored event", () => {
    const stale = { kind: "text", text: "STALE" } as const;
    const result = resolveChunkReadEvent(
      {
        type: "result",
        data: JSON.stringify({ type: "result", subtype: "success" }),
        normalizedEvent: stale,
      },
      "claude-code"
    );
    expect(result).not.toBe(stale);
    expect(result).toBeDefined();
  });
});

describe("normalized source labels", () => {
  test.each(["codex", "claude-code"] as const)("does not reconstruct %s narrative identity from raw data", (cliType) => {
    const event = { kind: "text" as const, text: "answer" };
    expect(resolveChunkReadEvent({
      type: cliType === "codex" ? "item/completed" : "assistant",
      data: JSON.stringify({ threadId: "child", parent_tool_use_id: "child", item: { type: "agentMessage", id: "item", text: "answer" }, message: { content: [{ type: "text", text: "answer" }] } }),
      normalizedEvent: event,
    }, cliType)).toBe(event);
  });

  test("does not reconstruct collaboration markers from raw data", () => {
    const item = { type: "collabAgentToolCall", id: "wait", tool: "wait", status: "completed" };
    const event = { kind: "tool-output" as const, toolCallId: "wait", outputJson: JSON.stringify(item) };
    expect(resolveChunkReadEvent({ type: "item/completed", data: JSON.stringify({ item }), normalizedEvent: event }, "codex")).toBe(event);
  });
});
