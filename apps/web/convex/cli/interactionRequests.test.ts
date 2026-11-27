import { expect, test, describe, vi, beforeEach, afterEach } from "vitest";
import { cancelPendingInteractionRequestsForThread } from "./interactionRequests";
import { api } from "../_generated/api";
import { createTestContext } from "../../convex-testing";

describe("cliInteractionRequests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setup() {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const apiKeyResult = await asUser.mutation(api.apiKeys.core.create, {
      name: "CLI Key",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });

    const profile = await ctx.cliProfile(user._id, project._id);
    const session = await ctx.cliSession(profile._id, apiKeyResult.id);
    const chat = await ctx.cliThread(user._id, project._id, profile._id, {
      status: "streaming",
      claimedBySessionId: session._id,
      claimLeaseExpiresAt: Date.now() + 60_000,
      processingState: "streaming",
    });
    const message = await ctx.cliMessage(chat._id, profile._id, {
      role: "assistant",
      status: "streaming",
      claimedBySessionId: session._id,
    });

    return { ctx, user, asUser, t, apiKey: apiKeyResult.key, session, chat, message };
  }

  async function createRequest(
    s: Awaited<ReturnType<typeof setup>>,
    requestId = "req-1"
  ) {
    return s.t.mutation(api.cli.interactionRequests.create, {
      threadId: s.chat._id,
      messageId: s.message._id,
      sessionId: s.session._id,
      requestId,
      kind: "tool-approval",
      payloadJson: JSON.stringify({ toolName: "Bash" }),
      expiresAt: Date.now() + 120_000,
      apiKey: s.apiKey,
    });
  }

  test("nonblocking questions stay answerable without marking the run as waiting", async () => {
    const s = await setup();
    await s.t.mutation(api.cli.interactionRequests.create, {
      threadId: s.chat._id, messageId: s.message._id, sessionId: s.session._id,
      requestId: "async", kind: "question", payloadJson: JSON.stringify({ isBlocking: false }),
      expiresAt: Date.now() + 60_000, apiKey: s.apiKey,
    });
    expect((await s.t.run(ctx => ctx.db.get("cliThreads", s.chat._id)))?.hasPendingInteraction).not.toBe(true);
    expect(await s.asUser.query(api.cli.interactionRequests.listPendingByThread, { threadId: s.chat._id })).toHaveLength(1);
    await createRequest(s, "blocking");
    await s.asUser.mutation(api.cli.interactionRequests.respond, { threadId: s.chat._id, requestId: "blocking", responseJson: "{}" });
    expect((await s.t.run(ctx => ctx.db.get("cliThreads", s.chat._id)))?.hasPendingInteraction).toBe(false);
    const blockingCount = await s.t.run(ctx => cancelPendingInteractionRequestsForThread(ctx, s.chat._id, "disconnected", Date.now()));
    expect(blockingCount).toBe(0);
    expect(await s.asUser.query(api.cli.interactionRequests.listPendingByThread, { threadId: s.chat._id })).toHaveLength(0);
  });

  test("create is idempotent by requestId and listPendingByThread returns it", async () => {
    const s = await setup();
    const first = await createRequest(s);
    const second = await createRequest(s);
    expect(second).toBe(first);

    const pending = await s.asUser.query(
      api.cli.interactionRequests.listPendingByThread,
      { threadId: s.chat._id }
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      requestId: "req-1",
      kind: "tool-approval",
      status: "pending",
    });
  });

  test("respond transitions pending → answered once; repeats are no-ops", async () => {
    const s = await setup();
    await createRequest(s);

    await s.asUser.mutation(api.cli.interactionRequests.respond, {
      threadId: s.chat._id,
      requestId: "req-1",
      responseJson: JSON.stringify({ decision: "allow" }),
    });
    // Second click: idempotent, does not throw or overwrite.
    await s.asUser.mutation(api.cli.interactionRequests.respond, {
      threadId: s.chat._id,
      requestId: "req-1",
      responseJson: JSON.stringify({ decision: "deny" }),
    });

    const answered = await s.t.query(
      api.cli.interactionRequests.listAnsweredBySession,
      { sessionId: s.session._id, apiKey: s.apiKey }
    );
    expect(answered).toHaveLength(1);
    expect(answered[0]?.responseJson).toBe(JSON.stringify({ decision: "allow" }));

    const pending = await s.asUser.query(
      api.cli.interactionRequests.listPendingByThread,
      { threadId: s.chat._id }
    );
    expect(pending).toHaveLength(0);
  });

  test("respond rejects expired requests", async () => {
    const s = await setup();
    await createRequest(s);
    await s.t.run(async (runCtx) => {
      const rows = await runCtx.db.query("cliInteractionRequests").collect();
      await runCtx.db.patch("cliInteractionRequests", rows[0]!._id, {
        expiresAt: Date.now() - 1,
      });
    });

    await expect(
      s.asUser.mutation(api.cli.interactionRequests.respond, {
        threadId: s.chat._id,
        requestId: "req-1",
        responseJson: "{}",
      })
    ).rejects.toThrow();
  });

  test("cancel marks pending cancelled; answered rows stay answered", async () => {
    const s = await setup();
    await createRequest(s);

    await s.t.mutation(api.cli.interactionRequests.cancel, {
      threadId: s.chat._id,
      sessionId: s.session._id,
      requestId: "req-1",
      reason: "run aborted",
      apiKey: s.apiKey,
    });

    const pending = await s.asUser.query(
      api.cli.interactionRequests.listPendingByThread,
      { threadId: s.chat._id }
    );
    expect(pending).toHaveLength(0);

    // Answered rows are final: respond then cancel is a no-op.
    await createRequest(s, "req-2");
    await s.asUser.mutation(api.cli.interactionRequests.respond, {
      threadId: s.chat._id,
      requestId: "req-2",
      responseJson: "{}",
    });
    await s.t.mutation(api.cli.interactionRequests.cancel, {
      threadId: s.chat._id,
      sessionId: s.session._id,
      requestId: "req-2",
      apiKey: s.apiKey,
    });
    const answered = await s.t.query(
      api.cli.interactionRequests.listAnsweredBySession,
      { sessionId: s.session._id, apiKey: s.apiKey }
    );
    expect(answered).toHaveLength(1);
  });

  test("hides pending requests whose claiming CLI session went offline (OS-1463)", async () => {
    const s = await setup();
    await createRequest(s);

    // Still answerable while the CLI heartbeats.
    expect(
      await s.asUser.query(api.cli.interactionRequests.listPendingByThread, {
        threadId: s.chat._id,
      })
    ).toHaveLength(1);

    // The CLI process dies without winding down: the row keeps status
    // `pending` and a lease that outlives the process by up to two minutes.
    // Answering it would write into a row nobody is subscribed to — the click
    // does nothing and the run only fails when the watchdog notices.
    await s.t.run(async (runCtx) => {
      await runCtx.db.patch("cliSessions", s.session._id, { isOnline: false, offlineAt: Date.now() });
    });

    expect(
      await s.asUser.query(api.cli.interactionRequests.listPendingByThread, {
        threadId: s.chat._id,
      })
    ).toHaveLength(0);
  });

  test("message fail cancels pending requests for the thread", async () => {
    const s = await setup();
    await createRequest(s);

    await s.t.mutation(api.cli.messages.fail, {
      messageId: s.message._id,
      sessionId: s.session._id,
      errorMessage: "boom",
      apiKey: s.apiKey,
    });

    const pending = await s.asUser.query(
      api.cli.interactionRequests.listPendingByThread,
      { threadId: s.chat._id }
    );
    expect(pending).toHaveLength(0);
  });

  test("stopping the run cancels pending requests and clears the flag", async () => {
    const s = await setup();
    await createRequest(s);

    // The thread's active assistant must be the streaming one for the stop to
    // treat this as an active run rather than a queue-only stop.
    await s.t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", s.chat._id, {
        activeAssistantMessageId: s.message._id,
      });
    });

    await s.asUser.mutation(api.cli.threads.runControl.cancelProcessing, {
      threadId: s.chat._id,
    });

    const pending = await s.asUser.query(
      api.cli.interactionRequests.listPendingByThread,
      { threadId: s.chat._id }
    );
    expect(pending).toHaveLength(0);

    const thread = await s.t.run(async (runCtx) =>
      runCtx.db.get("cliThreads", s.chat._id)
    );
    expect(thread?.hasPendingInteraction).toBe(false);
  });

  async function getThread(s: Awaited<ReturnType<typeof setup>>) {
    return s.t.run(async (runCtx) => {
      const thread = await runCtx.db.get("cliThreads", s.chat._id);
      if (!thread) throw new Error("thread missing");
      return thread;
    });
  }

  test("pending request flips a streaming thread to waiting_input; answering flips it back", async () => {
    const s = await setup();
    expect((await getThread(s)).statusProjection?.watchTowerStatus).toBe("running");

    await createRequest(s);
    let thread = await getThread(s);
    expect(thread.hasPendingInteraction).toBe(true);
    expect(thread.statusProjection?.watchTowerStatus).toBe("waiting_input");

    await s.asUser.mutation(api.cli.interactionRequests.respond, {
      threadId: s.chat._id,
      requestId: "req-1",
      responseJson: JSON.stringify({ decision: "allow" }),
    });
    thread = await getThread(s);
    expect(thread.hasPendingInteraction).toBe(false);
    expect(thread.statusProjection?.watchTowerStatus).toBe("running");
  });

  test("answering one of two pending requests keeps waiting_input until both resolve", async () => {
    const s = await setup();
    await createRequest(s, "req-1");
    await createRequest(s, "req-2");

    await s.asUser.mutation(api.cli.interactionRequests.respond, {
      threadId: s.chat._id,
      requestId: "req-1",
      responseJson: "{}",
    });
    expect((await getThread(s)).statusProjection?.watchTowerStatus).toBe("waiting_input");

    await s.t.mutation(api.cli.interactionRequests.cancel, {
      threadId: s.chat._id,
      sessionId: s.session._id,
      requestId: "req-2",
      apiKey: s.apiKey,
    });
    const thread = await getThread(s);
    expect(thread.hasPendingInteraction).toBe(false);
    expect(thread.statusProjection?.watchTowerStatus).toBe("running");
  });

  test("message fail clears the pending-interaction flag with the run", async () => {
    const s = await setup();
    await createRequest(s);

    await s.t.mutation(api.cli.messages.fail, {
      messageId: s.message._id,
      sessionId: s.session._id,
      errorMessage: "boom",
      apiKey: s.apiKey,
    });

    const thread = await getThread(s);
    expect(thread.hasPendingInteraction).toBe(false);
    // Failing while parked on the request is the user's turn, not an error:
    // the thread waits instead of failing (OS-1463).
    expect(thread.statusProjection?.watchTowerStatus).toBe("waiting_input");
  });

  test("message fail without a pending request keeps the failed bucket", async () => {
    const s = await setup();

    await s.t.mutation(api.cli.messages.fail, {
      messageId: s.message._id,
      sessionId: s.session._id,
      errorMessage: "boom",
      apiKey: s.apiKey,
    });

    const thread = await getThread(s);
    expect(thread.statusProjection?.watchTowerStatus).toBe("failed");
  });

  test("create requires an active claim by the calling session", async () => {
    const s = await setup();
    await s.t.run(async (runCtx) => {
      await runCtx.db.patch("cliThreads", s.chat._id, {
        claimLeaseExpiresAt: Date.now() - 1,
      });
    });

    await expect(createRequest(s)).rejects.toThrow(/not claimed/i);
  });

  test("heartbeatClaim extends pending request expiry with the lease", async () => {
    const s = await setup();
    await createRequest(s);

    const leaseMs = 300_000;
    await s.t.mutation(api.cli.threads.runControl.heartbeatClaim, {
      threadId: s.chat._id,
      sessionId: s.session._id,
      leaseMs,
      apiKey: s.apiKey,
    });

    await s.t.run(async (runCtx) => {
      const rows = await runCtx.db.query("cliInteractionRequests").collect();
      expect(rows[0]?.expiresAt).toBe(Date.now() + leaseMs);
    });
  });
});
