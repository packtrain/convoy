/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { createTestContext } from "../../convex-testing";
import { dispatchToHandlers, type EventHandler } from "../lib/eventRegistry";
import type { AppEvent } from "../lib/contracts/appEvents";

// The v1 registry is empty and `emitEvents` drops events with no registered
// handler, so producer wiring is only observable with a handler in place.
// `testHandlers` stands in for the registry; each test opts in.
const { testHandlers } = vi.hoisted(() => ({
  testHandlers: [] as { name: string; handle: () => Promise<void> }[],
}));

vi.mock("../lib/eventRegistry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eventRegistry")>();
  return {
    ...actual,
    handlersFor: ((): unknown => testHandlers) as typeof actual.handlersFor,
  };
});

function registerNoopTestHandler(): void {
  testHandlers.push({ name: "test-noop", handle: async () => {} });
}

type AsUser = Awaited<ReturnType<ReturnType<typeof createTestContext>["setupProject"]>>["asUser"];

async function createTaskViaApi(asUser: AsUser, projectId: Id<"projects">, name: string): Promise<Id<"tasks">> {
  const result = await asUser.mutation(api.tasks.core.create, {
    projectId,
    clientId: `client-${name}`,
    name,
    priority: "None",
    status: "To Do",
    tags: [],
  });
  return result.taskId;
}

describe("events bus core", () => {
  afterEach(() => {
    vi.useRealTimers();
    testHandlers.length = 0;
  });

  test("ingest persists a batch and the batched janitor deletes it after TTL", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const events: AppEvent[] = [
        {
          type: "task.status_changed",
          actorUserId: user._id,
          projectId: project._id,
          subject: { kind: "task", id: task._id },
          payload: { oldStatus: "To Do", newStatus: "Done" },
        },
        {
          type: "task.deleted",
          actorUserId: user._id,
          projectId: project._id,
          subject: { kind: "task", id: task._id },
          payload: {},
        },
      ];
      await t.mutation(internal.events.core.ingest, { events });

      await t.run(async (runCtx) => {
        const rows = await runCtx.db.query("events").collect();
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.type).sort()).toEqual(["task.deleted", "task.status_changed"]);
        expect(rows[0].subject).toEqual({ kind: "task", id: task._id });
      });

      // Runs the 7-day janitor — also proves the TTL delay doesn't overflow in convex-test.
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      await t.run(async (runCtx) => {
        expect(await runCtx.db.query("events").collect()).toHaveLength(0);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("ingest of an empty batch is a no-op", async () => {
    const ctx = createTestContext();
    const { t } = await ctx.setupProject();

    await t.mutation(internal.events.core.ingest, { events: [] });

    await t.run(async (runCtx) => {
      expect(await runCtx.db.query("events").collect()).toHaveLength(0);
    });
  });

  test("dispatch runs handlers in order and isolates failures", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ctx = createTestContext();
      const { user, project, t } = await ctx.setupProject();
      const task = await ctx.task(project._id, user._id);

      const event: AppEvent = {
        type: "task.created",
        actorUserId: user._id,
        projectId: project._id,
        subject: { kind: "task", id: task._id },
        payload: {},
      };

      const calls: string[] = [];
      const recording = (name: string): EventHandler => ({
        name,
        handle: async () => {
          calls.push(name);
        },
      });
      const throwing: EventHandler = {
        name: "boom",
        handle: async () => {
          throw new Error("kaboom");
        },
      };

      await t.run(async (runCtx) => {
        const eventId = await runCtx.db.insert("events", event);
        await dispatchToHandlers(runCtx, { ...event, eventId }, [recording("first"), throwing, recording("second")]);
      });

      expect(calls).toEqual(["first", "second"]);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0][0])).toContain('handler "boom" failed for task.created');
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("emit is a no-op while no handler is registered (dormant bus)", async () => {
    vi.useFakeTimers();
    const ctx = createTestContext();
    const { project, asUser, t } = await ctx.setupProject();

    await createTaskViaApi(asUser, project._id, "dormant-bus");
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    await t.run(async (runCtx) => {
      expect(await runCtx.db.query("events").collect()).toHaveLength(0);
    });
  });

  test("task create emits task.created and keeps the activity log intact", async () => {
    vi.useFakeTimers();
    registerNoopTestHandler();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const taskId = await createTaskViaApi(asUser, project._id, "created-event");
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("events").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "task.created",
        actorUserId: user._id,
        projectId: project._id,
        subject: { kind: "task", id: taskId },
        payload: {},
      });

      // Separation intact: the activity log row exists independently of the bus event.
      const logs = await runCtx.db
        .query("taskActivityLogs")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect();
      expect(logs.some((log) => log.eventType === "created")).toBe(true);
    });
  });

  test("task update emits status and assignee events in one batch", async () => {
    vi.useFakeTimers();
    registerNoopTestHandler();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const taskId = await createTaskViaApi(asUser, project._id, "update-events");
    await asUser.mutation(api.tasks.core.update, {
      id: taskId,
      status: "Done",
      assigneeId: user._id,
    });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("events").collect();

      const statusEvent = rows.find((row) => row.type === "task.status_changed");
      expect(statusEvent).toMatchObject({
        actorUserId: user._id,
        projectId: project._id,
        subject: { kind: "task", id: taskId },
        payload: { oldStatus: "To Do", newStatus: "Done" },
      });

      const assigneeEvent = rows.find((row) => row.type === "task.assignee_changed");
      expect(assigneeEvent).toMatchObject({
        actorUserId: user._id,
        subject: { kind: "task", id: taskId },
        payload: { newAssigneeId: user._id },
      });
      expect(
        assigneeEvent?.type === "task.assignee_changed" ? assigneeEvent.payload.oldAssigneeId : "unset"
      ).toBeUndefined();
    });
  });

  test("comment creation emits task.comment_added with the real comment id", async () => {
    vi.useFakeTimers();
    registerNoopTestHandler();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const task = await ctx.task(project._id, user._id);
    const commentId = await asUser.mutation(api.tasks.comments.create, {
      taskId: task._id,
      content: "hello",
    });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("events").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: "task.comment_added",
        actorUserId: user._id,
        subject: { kind: "task", id: task._id },
        payload: { commentId },
      });
    });
  });

  test("bulk status update emits one event per changed task and archive emits per subtree root", async () => {
    vi.useFakeTimers();
    registerNoopTestHandler();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const tasks = await Promise.all(
      ["bulk-a", "bulk-b", "bulk-c"].map((name) => ctx.task(project._id, user._id, { name, status: "To Do" }))
    );
    const ids = tasks.map((task) => task._id);

    await asUser.mutation(api.tasks.core.bulk.update, { ids, status: "Done" });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("events").collect();
      const statusEvents = rows.filter((row) => row.type === "task.status_changed");
      expect(statusEvents).toHaveLength(3);
      expect(new Set(statusEvents.map((row) => row.subject.id))).toEqual(new Set(ids));
    });

    await asUser.mutation(api.tasks.core.bulk.archive, { ids: [ids[0], ids[1]] });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("events").collect();
      const archivedEvents = rows.filter((row) => row.type === "task.archived");
      expect(new Set(archivedEvents.map((row) => row.subject.id))).toEqual(new Set([ids[0], ids[1]]));
    });
  });

  test("bulk delete emits task.deleted per removed root task", async () => {
    vi.useFakeTimers();
    registerNoopTestHandler();
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();

    const first = await ctx.task(project._id, user._id, { name: "delete-a" });
    const second = await ctx.task(project._id, user._id, { name: "delete-b" });

    await asUser.mutation(api.tasks.core.bulk.remove, { ids: [first._id, second._id] });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();

    await t.run(async (runCtx) => {
      const rows = await runCtx.db.query("events").collect();
      const deletedEvents = rows.filter((row) => row.type === "task.deleted");
      expect(new Set(deletedEvents.map((row) => row.subject.id))).toEqual(new Set([first._id, second._id]));
    });
  });
});
