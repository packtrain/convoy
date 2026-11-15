import { describe, expect, test } from "vitest";
import { extractCodexCostUsage } from "./costUsage";
import { resolveCostUsage } from "@/convex/costs/lib/resolution";
import fixtures from "./costUsage.fixtures.json";
import type { CodexModelState } from "@/convex/lib/contracts/validators";
import type { CodexUsageCursor } from "@/convex/lib/contracts/costUsage";

function execTurnCompleted(usage: Record<string, number>) {
  return {
    type: "turn.completed",
    data: JSON.stringify({ type: "turn.completed", usage }),
  };
}

function tokenUsageUpdated(total: Record<string, number>) {
  return {
    type: "thread/tokenUsage/updated",
    data: JSON.stringify({
      tokenUsage: {
        total,
        last: total,
        modelContextWindow: 272_000,
      },
    }),
  };
}

function tokenTotals(result: ReturnType<typeof extractCodexCostUsage>) {
  return (result?.usage.byModel ?? []).reduce((total, entry) => ({
    inputTokens: total.inputTokens + entry.inputTokens,
    cachedInputTokens: total.cachedInputTokens + entry.cachedInputTokens,
    cacheReadTokens: total.cacheReadTokens + (entry.cacheReadTokens ?? 0),
    cacheWriteTokens: total.cacheWriteTokens + (entry.cacheWriteTokens ?? 0),
    outputTokens: total.outputTokens + entry.outputTokens,
  }), { inputTokens: 0, cachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 });
}

describe("extractCodexCostUsage", () => {
  test("attributes Mantle usage to the AWS model ID the run reported (OS-2105)", () => {
    const result = extractCodexCostUsage([
      { type: "thread/started", data: JSON.stringify({ thread: { id: "thread" }, model: "openai.gpt-6-sol" }) },
      { type: "turn/started", data: JSON.stringify({ turn: { id: "turn" } }) },
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
    ], { cliModel: "gpt-6-sol", continuationId: "thread" });
    expect(result?.usage.byModel.map((usage) => usage.model)).toEqual(["openai.gpt-6-sol"]);
  });

  test("prices Mantle usage at the Mantle GPT-6 Sol rates (OS-2105)", () => {
    // Token shape from a live Mantle turn: cache writes are reported separately.
    const result = extractCodexCostUsage([
      { type: "thread/started", data: JSON.stringify({ thread: { id: "thread" }, model: "openai.gpt-6-sol" }) },
      { type: "turn/started", data: JSON.stringify({ turn: { id: "turn" } }) },
      tokenUsageUpdated({ inputTokens: 71380, cachedInputTokens: 0, cacheWriteInputTokens: 71338, outputTokens: 7 }),
    ], { cliModel: "gpt-6-sol", continuationId: "thread" });
    const resolved = resolveCostUsage(result!.usage);
    expect(resolved.costUsd).toBeGreaterThan(0);
    expect(resolved.byModel[0]?.costMetadata).toMatchObject({ hasEstimated: true });
  });

  test("model attribution is invariant across append boundaries around reroutes", () => {
    const chunks = [
      { type: "thread/started", data: JSON.stringify({ thread: { id: "thread" }, model: "gpt-5.5" }) },
      { type: "turn/started", data: JSON.stringify({ turn: { id: "turn" } }) },
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
      { type: "model/rerouted", data: JSON.stringify({ threadId: "thread", turnId: "turn", toModel: "gpt-6-astra" }) },
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
      tokenUsageUpdated({ inputTokens: 150, cachedInputTokens: 0, outputTokens: 30 }),
      tokenUsageUpdated({ inputTokens: 180, cachedInputTokens: 0, outputTokens: 40 }),
    ];
    for (const batchSize of [1, 2, 3, chunks.length]) {
      let modelState: CodexModelState | undefined;
      let usageCursor: CodexUsageCursor | undefined;
      const inputByModel: Record<string, number> = {};
      for (let index = 0; index < chunks.length; index += batchSize) {
        const result = extractCodexCostUsage(chunks.slice(index, index + batchSize), {
          cliModel: "default", continuationId: "thread", usageCursor, modelState,
        });
        modelState = result?.nextModelState ?? modelState;
        usageCursor = result?.nextUsageCursor ?? usageCursor;
        for (const usage of result?.usage.byModel ?? []) inputByModel[usage.model] = (inputByModel[usage.model] ?? 0) + usage.inputTokens;
      }
      expect(inputByModel).toEqual({ "gpt-5.5": 100, unknown: 50, "gpt-6-astra": 30 });
      expect(modelState).toMatchObject({ model: "gpt-6-astra", source: "runtime", pendingChange: false });
    }
  });

  test.each(["", "default", "unknown", undefined])("legacy startup and unresolved model %s preserve unknown tokens", (cliModel) => {
    const result = extractCodexCostUsage([
      { type: "thread/started", data: JSON.stringify({ thread: { id: "old-cli" } }) },
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
    ], { cliModel });
    expect(result?.usage.byModel[0]).toMatchObject({ model: "unknown", inputTokens: 100 });
  });

  test("legacy startup uses an explicit run model without machine defaults", () => {
    const result = extractCodexCostUsage([
      { type: "thread/started", data: JSON.stringify({ thread: { id: "old-cli" } }) },
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
    ], { cliModel: "gpt-5.5" });
    expect(result?.usage.byModel[0]?.model).toBe("gpt-5.5");
  });

  test("runtime evidence outranks repeated startup metadata and configured slots", () => {
    const result = extractCodexCostUsage([
      { type: "thread/started", data: JSON.stringify({ model: "gpt-5.5" }) },
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
    ], { cliModel: "gpt-5.4", modelState: { model: "gpt-6-astra", source: "runtime" } });
    expect(result?.usage.byModel[0]?.model).toBe("gpt-6-astra");
  });

  test.each([
    { threadId: "another-thread", turnId: "current-turn", toModel: "gpt-6-astra" },
    { threadId: "current-thread", turnId: "old-turn", toModel: "gpt-6-astra" },
    { threadId: "current-thread", turnId: "current-turn", toModel: "default" },
  ])("ignores irrelevant or malformed model changes %j", (change) => {
    const result = extractCodexCostUsage([
      { type: "model/rerouted", data: JSON.stringify(change) },
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
    ], { continuationId: "current-thread", modelState: { model: "gpt-5.5", source: "startup", turnId: "current-turn" } });
    expect(result?.usage.byModel[0]?.model).toBe("gpt-5.5");
  });

  test("startup model overrides the configured slot", () => {
    const result = extractCodexCostUsage([
      { type: "thread/started", data: JSON.stringify({ thread: { id: "thread" }, model: "gpt-6-astra" }) },
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
    ], { cliModel: "default" });
    expect(result?.usage.byModel[0]?.model).toBe("gpt-6-astra");
  });

  test("exec default stays unknown while retaining tokens", () => {
    const result = extractCodexCostUsage([
      execTurnCompleted({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 20 }),
    ], { cliModel: "default" });
    expect(result?.usage.byModel[0]).toMatchObject({ model: "unknown", inputTokens: 100, outputTokens: 20 });
  });

  test("a reroute leaves the crossing interval unknown and attributes later usage to its model", () => {
    const result = extractCodexCostUsage([
      tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }),
      { type: "model/rerouted", data: JSON.stringify({ fromModel: "gpt-5.5", toModel: "gpt-6-astra" }) },
      tokenUsageUpdated({ inputTokens: 150, cachedInputTokens: 0, outputTokens: 30 }),
      tokenUsageUpdated({ inputTokens: 180, cachedInputTokens: 0, outputTokens: 40 }),
    ], { cliModel: "gpt-5.5" });
    expect(result?.usage.byModel.map(({ model, inputTokens }) => ({ model, inputTokens }))).toEqual([
      { model: "gpt-5.5", inputTokens: 100 }, { model: "unknown", inputTokens: 50 },
      { model: "gpt-6-astra", inputTokens: 30 },
    ]);
  });

  test("captured app-server results are invariant under batch boundaries", () => {
    for (const batchSize of [1, 2, 3, fixtures.appServer.length]) {
      let usageCursor: CodexUsageCursor | undefined;
      const totals = { input: 0, cache: 0, output: 0 };
      for (let start = 0; start < fixtures.appServer.length; start += batchSize) {
        const result = extractCodexCostUsage(
          fixtures.appServer.slice(start, start + batchSize).map((params) => ({
            type: "thread/tokenUsage/updated", data: JSON.stringify(params),
          })), { usageCursor }
        );
        usageCursor = result?.nextUsageCursor ?? usageCursor;
        for (const usage of result?.usage.byModel ?? []) {
          totals.input += usage.inputTokens;
          totals.cache += usage.cachedInputTokens;
          totals.output += usage.outputTokens;
        }
      }
      expect(totals).toEqual({ input: 750, cache: 750, output: 300 });
    }
  });

  test("equal snapshots can adopt a late continuation id without recounting", () => {
    const result = extractCodexCostUsage(
      [execTurnCompleted({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 })],
      { continuationId: "late-id", usageCursor: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 } }
    );
    expect(result?.usage.byModel).toEqual([]);
    expect(result?.nextUsageCursor?.continuationId).toBe("late-id");
  });

  test.each([[100, 150, 150], [100, 100, 100]])(
    "exec %i then %i follows the cumulative contract, never old per-turn semantics",
    (first, second, expected) => {
      const result = extractCodexCostUsage([first, second].map((input_tokens) =>
        execTurnCompleted({ input_tokens, cached_input_tokens: 0, output_tokens: 0 })
      ), {});
      expect(tokenTotals(result).inputTokens).toBe(expected);
    }
  );

  test("a reset within a batch preserves usage on both sides of the reset", () => {
    const result = extractCodexCostUsage([100, 0, 150].map((input_tokens) =>
      execTurnCompleted({ input_tokens, cached_input_tokens: 0, output_tokens: 0 })
    ), {});
    expect(tokenTotals(result).inputTokens).toBe(250);
  });

  test("absent cache writes remain unknown, including old persisted cursors", () => {
    const result = extractCodexCostUsage(
      [{ type: "turn.completed", data: JSON.stringify(fixtures.exec[1]) }],
      { usageCursor: { inputTokens: 300, cachedInputTokens: 120, outputTokens: 60 } }
    );
    expect(result?.usage.byModel[0]?.cacheWriteTokens).toBeUndefined();
    expect(result?.nextUsageCursor?.cacheWriteInputTokens).toBe(60);
  });

  test("explicit zero cache writes are known and reasoning is not added again", () => {
    const result = extractCodexCostUsage([execTurnCompleted({
      input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 0,
      output_tokens: 20, reasoning_output_tokens: 5,
    })], {});
    expect(result?.usage.byModel[0]).toMatchObject({
      inputTokens: 60, cacheReadTokens: 40, cacheWriteTokens: 0, outputTokens: 20,
    });
  });

  test.each(["invalid JSON", "null", JSON.stringify({ usage: { input_tokens: 100 } }),
    JSON.stringify({ usage: { input_tokens: -1, cached_input_tokens: 0, output_tokens: 0 } })])(
    "malformed or incomplete usage leaves the cursor alone: %s", (data) => {
      expect(extractCodexCostUsage([{ type: "turn.completed", data }], {})).toBeNull();
    }
  );

  test("app-server last alone cannot establish a cumulative usage increment", () => {
    expect(extractCodexCostUsage([{
      type: "thread/tokenUsage/updated", data: JSON.stringify({ tokenUsage: { last: fixtures.appServer[0].tokenUsage.last } }),
    }], {})).toBeNull();
  });
  test("a resume baseline seeds historical usage without charging it again", () => {
    const baseline = { ...fixtures.appServer[2], convoyUsageBaseline: true };
    const result = extractCodexCostUsage(
      [{ type: "thread/tokenUsage/updated", data: JSON.stringify(baseline) }], {}
    );
    expect(result?.usage.byModel).toEqual([]);
    expect(result?.nextUsageCursor).toMatchObject({ inputTokens: 300 });
  });
  test("captured app-server repeats on resume and compaction add no usage", () => {
    const chunks = fixtures.appServer.map((params) => ({
      type: "thread/tokenUsage/updated",
      data: JSON.stringify(params),
    }));
    const result = extractCodexCostUsage(chunks, {});
    expect(tokenTotals(result)).toEqual({
      inputTokens: 750,
      cachedInputTokens: 750,
      cacheReadTokens: 600,
      cacheWriteTokens: 150,
      outputTokens: 300,
    });
  });

  test("captured exec cache writes and reasoning stay within input and output", () => {
    const result = extractCodexCostUsage(
      fixtures.exec.map((event) => ({ type: event.type, data: JSON.stringify(event) })),
      {}
    );
    expect(tokenTotals(result)).toEqual({
      inputTokens: 300,
      cachedInputTokens: 300,
      cacheReadTokens: 240,
      cacheWriteTokens: 60,
      outputTokens: 120,
    });
  });

  test("zero resets advance the cursor without recording usage", () => {
    const result = extractCodexCostUsage(
      [execTurnCompleted({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 })],
      { usageCursor: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 } }
    );
    expect(result?.nextUsageCursor).toMatchObject({
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
    });
    expect(result?.usage.byModel).toEqual([]);
  });

  test("exec cumulative snapshots yield separate deltas, never summed snapshots", () => {
    const extraction = extractCodexCostUsage(
      [
        execTurnCompleted({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 }),
        execTurnCompleted({ input_tokens: 160, cached_input_tokens: 90, output_tokens: 45 }),
      ],
      { cliModel: "gpt-5.4-codex", continuationId: "thread-1" }
    );

    expect(extraction).toEqual({
      nextModelState: { model: "gpt-5.4-codex", source: "configured" },
      usage: {
        costUsd: 0,
        reportedCost: false,
        byModel: [
          {
            model: "gpt-5.4-codex",
            inputTokens: 60,
            cachedInputTokens: 40,
            cacheReadTokens: 40,
            outputTokens: 20,
            costUsd: 0,
            reportedCost: false,
          },
          {
            model: "gpt-5.4-codex",
            inputTokens: 10,
            cachedInputTokens: 50,
            cacheReadTokens: 50,
            outputTokens: 25,
            costUsd: 0,
            reportedCost: false,
          },
        ],
      },
      nextUsageCursor: {
        continuationId: "thread-1",
        inputTokens: 160,
        cachedInputTokens: 90,
        outputTokens: 45,
      },
    });
  });

  test("diffs against the thread's cursor for the batch delta", () => {
    const extraction = extractCodexCostUsage(
      [execTurnCompleted({ input_tokens: 260, cached_input_tokens: 170, output_tokens: 65 })],
      {
        cliModel: "gpt-5.4-codex",
        continuationId: "thread-1",
        usageCursor: { continuationId: "thread-1", inputTokens: 160, cachedInputTokens: 90, outputTokens: 45 },
      }
    );

    expect(extraction?.usage.byModel).toEqual([
      {
        model: "gpt-5.4-codex",
        inputTokens: 20,
        cachedInputTokens: 80,
        cacheReadTokens: 80,
        outputTokens: 20,
        costUsd: 0,
        reportedCost: false,
      },
    ]);
    expect(extraction?.nextUsageCursor).toEqual({
      continuationId: "thread-1",
      inputTokens: 260,
      cachedInputTokens: 170,
      outputTokens: 65,
    });
  });

  test("a decreased cumulative snapshot starts a new counter baseline", () => {
    const extraction = extractCodexCostUsage(
      [execTurnCompleted({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 })],
      {
        cliModel: "gpt-5.4-codex",
        continuationId: "thread-1",
        usageCursor: { continuationId: "thread-1", inputTokens: 500, cachedInputTokens: 300, outputTokens: 200 },
      }
    );

    expect(extraction?.usage.byModel).toEqual([
      {
        model: "gpt-5.4-codex",
        inputTokens: 60,
        cachedInputTokens: 40,
        cacheReadTokens: 40,
        outputTokens: 20,
        costUsd: 0,
        reportedCost: false,
      },
    ]);
    expect(extraction?.nextUsageCursor).toMatchObject({ inputTokens: 100 });
  });

  test("a cursor recorded before the continuation id was known still matches", () => {
    const extraction = extractCodexCostUsage(
      [execTurnCompleted({ input_tokens: 260, cached_input_tokens: 170, output_tokens: 65 })],
      {
        cliModel: "gpt-5.4-codex",
        continuationId: "thread-1",
        // Recorded from a batch that carried usage before the session id.
        usageCursor: { inputTokens: 160, cachedInputTokens: 90, outputTokens: 45 },
      }
    );

    expect(extraction?.usage.byModel[0]).toMatchObject({
      inputTokens: 20,
      cachedInputTokens: 80,
      outputTokens: 20,
    });
    expect(extraction?.nextUsageCursor).toEqual({
      continuationId: "thread-1",
      inputTokens: 260,
      cachedInputTokens: 170,
      outputTokens: 65,
    });
  });

  test("a cursor from another continuation is ignored", () => {
    const extraction = extractCodexCostUsage(
      [execTurnCompleted({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 })],
      {
        cliModel: "gpt-5.4-codex",
        continuationId: "thread-2",
        usageCursor: { continuationId: "thread-1", inputTokens: 90, cachedInputTokens: 10, outputTokens: 5 },
      }
    );

    expect(extraction?.usage.byModel).toEqual([
      {
        model: "gpt-5.4-codex",
        inputTokens: 60,
        cachedInputTokens: 40,
        cacheReadTokens: 40,
        outputTokens: 20,
        costUsd: 0,
        reportedCost: false,
      },
    ]);
    expect(extraction?.nextUsageCursor).toEqual({
      continuationId: "thread-2",
      inputTokens: 100,
      cachedInputTokens: 40,
      outputTokens: 20,
    });
  });

  test("app-server cumulative snapshots yield separate deltas in a batch", () => {
    const extraction = extractCodexCostUsage(
      [
        tokenUsageUpdated({ inputTokens: 50, cachedInputTokens: 10, outputTokens: 8, totalTokens: 68 }),
        tokenUsageUpdated({ inputTokens: 80, cachedInputTokens: 30, outputTokens: 13, totalTokens: 93 }),
        { type: "turn/completed", data: JSON.stringify({ turn: { status: "completed" } }) },
      ],
      { cliModel: "gpt-5.4-codex", continuationId: "thread-1" }
    );

    expect(extraction).toMatchObject({
      usage: {
        costUsd: 0,
        reportedCost: false,
        byModel: [
          {
            model: "gpt-5.4-codex",
            inputTokens: 40,
            cachedInputTokens: 10,
            cacheReadTokens: 10,
            outputTokens: 8,
            costUsd: 0,
            reportedCost: false,
          },
          {
            model: "gpt-5.4-codex",
            inputTokens: 10,
            cachedInputTokens: 20,
            cacheReadTokens: 20,
            outputTokens: 5,
            costUsd: 0,
            reportedCost: false,
          },
        ],
      },
    });
  });

  test("returns null when the chunks carry no usage", () => {
    expect(
      extractCodexCostUsage(
        [{ type: "turn/completed", data: JSON.stringify({ turn: { status: "completed" } }) }],
        { cliModel: "gpt-5.4-codex" }
      )
    ).toBeNull();
  });
});

test("child envelopes cannot update root cost, model, or turn cursors", () => {
  const root = tokenUsageUpdated({ inputTokens: 100, cachedInputTokens: 10, outputTokens: 20 });
  const children = [
    { method: "thread/tokenUsage/updated", params: JSON.parse(tokenUsageUpdated({ inputTokens: 9999, cachedInputTokens: 0, outputTokens: 9999 }).data) },
    { method: "turn/started", params: { turn: { id: "child-turn" } } },
    { method: "model/rerouted", params: { toModel: "other-model" } },
  ].map((event) => ({ type: "convoy/child", data: JSON.stringify({ ...event, source: { scope: "child", threadId: "child" } }) }));
  const context = { cliModel: "gpt-5.5", continuationId: "root" };
  expect(extractCodexCostUsage([root, ...children], context)).toEqual(extractCodexCostUsage([root], context));
});
