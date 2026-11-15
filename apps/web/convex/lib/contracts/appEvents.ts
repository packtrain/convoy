import { v, type Infer } from "convex/values";
import { statusValidator } from "./validators";

const taskSubjectValidator = v.object({ kind: v.literal("task"), id: v.id("tasks") });
const threadSubjectValidator = v.object({ kind: v.literal("thread"), id: v.id("cliThreads") });

/** Subject the event is about. One member per subject kind. */
export const eventSubjectValidator = v.union(taskSubjectValidator, threadSubjectValidator);

const common = {
  // Optional so future system-originated events (automations, schedulers) fit.
  actorUserId: v.optional(v.id("users")),
  projectId: v.optional(v.id("projects")),
};
// Per-kind bases so an impossible pairing (a thread event with a task
// subject) is rejected at compile and validation time.
const taskBase = { ...common, subject: taskSubjectValidator };
const threadBase = { ...common, subject: threadSubjectValidator };

// The run's assistant message: the fan-out reads its tail for the
// notification's reply excerpt. Optional — some wind-down paths (browser
// cancel) have no meaningful message.
const threadLifecyclePayload = v.object({ messageId: v.optional(v.id("cliMessages")) });

/**
 * The bus event union — one member per type, ids and literals only (handlers load
 * docs for anything richer). Transient transport, strictly separate from
 * `taskActivityLogs`. See docs/specs/internal-event-bus.md.
 *
 * Adding a type = one union member here + one emit call at the producer.
 */
export const appEventValidator = v.union(
  v.object({ ...taskBase, type: v.literal("task.created"), payload: v.object({}) }),
  v.object({
    ...taskBase,
    type: v.literal("task.status_changed"),
    payload: v.object({
      oldStatus: v.optional(statusValidator),
      newStatus: statusValidator,
    }),
  }),
  v.object({
    ...taskBase,
    type: v.literal("task.assignee_changed"),
    payload: v.object({
      oldAssigneeId: v.optional(v.id("users")),
      newAssigneeId: v.optional(v.id("users")),
    }),
  }),
  v.object({ ...taskBase, type: v.literal("task.deleted"), payload: v.object({}) }),
  v.object({ ...taskBase, type: v.literal("task.archived"), payload: v.object({}) }),
  v.object({
    ...taskBase,
    type: v.literal("task.comment_added"),
    payload: v.object({ commentId: v.id("taskComments") }),
  }),
  // Thread lifecycle (OS-1243): every transition into a terminal thread status
  // emits. CLI-driven transitions carry no actor (the CLI authenticates as the
  // owner — an actor would self-suppress the only recipient); browser-driven
  // ones (cancel, delete) set the actor so fan-out mutes them.
  v.object({ ...threadBase, type: v.literal("thread.completed"), payload: threadLifecyclePayload }),
  v.object({ ...threadBase, type: v.literal("thread.failed"), payload: threadLifecyclePayload }),
  v.object({ ...threadBase, type: v.literal("thread.waiting_input"), payload: threadLifecyclePayload })
);

export type AppEvent = Infer<typeof appEventValidator>;
export type AppEventType = AppEvent["type"];
export type AppEventOf<T extends AppEventType> = Extract<AppEvent, { type: T }>;
