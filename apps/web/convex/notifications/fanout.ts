import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { DispatchedEvent, EventHandler } from "../lib/eventRegistry";
import type { NotificationSnapshot, NotificationType } from "../lib/contracts/notifications";
import { getTaskById } from "../tasks/lib/tasksRepo";
import { getProjectById } from "../projects/lib/projectsRepo";
import { getUserById } from "../users/lib/usersRepo";
import { getThreadActorLabel, getThreadById } from "../cli/threads/lib/cliThreadsRepo";
import { expandCliNormalizedEvent } from "../cli/lib/chunks/normalizedEvents";
import { isForeignNarrativeSource } from "../lib/contracts/validators";
import { listLatestStoredChunksByMessage } from "../cli/lib/cliMessageChunksRepo";
import { listInteractionRequestsByThreadAndStatus } from "../cli/lib/cliInteractionRequestsRepo";
import { describeInteractionRequest } from "../lib/interactionPreview";
import { clampChars } from "../lib/shared/strings";
import { listPreferencesByUser } from "./lib/notificationPreferencesRepo";
import { isChannelEnabled } from "./lib/preferences";
import {
  deleteNotification,
  insertNotification,
  listUnreadByUserTypeAndSubject,
} from "./lib/notificationsRepo";

type TaskEvent = Extract<DispatchedEvent, { subject: { kind: "task" } }>;
type ThreadEvent = Extract<DispatchedEvent, { subject: { kind: "thread" } }>;

// TS narrows unions only on top-level discriminants, not `subject.kind`.
function isTaskEvent(event: DispatchedEvent): event is TaskEvent {
  return event.subject.kind === "task";
}

/** Status changes to Done/Canceled surface as their own "completed" type. */
function toNotificationType(event: DispatchedEvent): NotificationType {
  if (event.type === "task.status_changed") {
    const status = event.payload.newStatus;
    if (status === "Done" || status === "Canceled") {
      return "task.completed";
    }
  }
  return event.type;
}

/**
 * Insert per-recipient rows for one event: preference check, then coalescing
 * (rapid same-type events on one subject collapse into a single unread row
 * with the freshest snapshot; read rows are never touched).
 */
async function insertForRecipients(
  ctx: MutationCtx,
  event: DispatchedEvent,
  args: {
    recipients: Set<Id<"users">>;
    organizationId: Id<"organizations">;
    projectId: Id<"projects">;
    type: NotificationType;
    snapshot: NotificationSnapshot;
  }
): Promise<void> {
  for (const userId of args.recipients) {
    const preferences = await listPreferencesByUser(ctx, userId);
    const inApp = isChannelEnabled(preferences, args.type, "inApp");
    if (!inApp && !isChannelEnabled(preferences, args.type, "toast")) {
      continue;
    }
    const unread = await listUnreadByUserTypeAndSubject(ctx, userId, args.type, event.subject.id);
    for (const stale of unread) {
      await deleteNotification(ctx, stale._id);
    }
    // inApp off but toast on → the row is born read (no readAt: nobody read
    // it): it feeds the toaster and shows in the inbox's "all" view, but
    // never the badge or unread view.
    await insertNotification(ctx, {
      userId,
      type: args.type,
      actorUserId: event.actorUserId,
      organizationId: args.organizationId,
      projectId: args.projectId,
      subject: event.subject,
      read: !inApp,
      snapshot: args.snapshot,
    });
  }
}

/**
 * Task events: recipients are task creator + current assignee, minus the
 * actor (self-actions never notify). No permission checks here — the inbox
 * filters at read time (OS-1124).
 */
async function fanOutTaskEvent(ctx: MutationCtx, event: TaskEvent): Promise<void> {
  // Soft-deleted tasks still resolve, so deleted/archived events notify.
  const task = await getTaskById(ctx, event.subject.id);
  if (!task) {
    return;
  }

  const recipients = new Set<Id<"users">>([task.createdBy]);
  if (task.assigneeId) {
    recipients.add(task.assigneeId);
  }
  if (event.actorUserId) {
    recipients.delete(event.actorUserId);
  }
  if (recipients.size === 0) {
    return;
  }

  const project = await getProjectById(ctx, task.projectId);
  if (!project) {
    return;
  }
  const actor = event.actorUserId ? await getUserById(ctx, event.actorUserId) : null;

  await insertForRecipients(ctx, event, {
    recipients,
    organizationId: project.organizationId,
    projectId: task.projectId,
    type: toNotificationType(event),
    snapshot: {
      taskRef: `${project.alias}-${task.refNumber}`,
      taskTitle: task.name,
      ...(task.taskTypeKey !== undefined ? { taskTypeKey: task.taskTypeKey } : {}),
      ...(actor ? { actorName: actor.name } : {}),
      ...(event.type === "task.status_changed" ? { newStatus: event.payload.newStatus } : {}),
    },
  });
}

const THREAD_MESSAGE_PREVIEW_CHARS = 240;
/** Exported so the OS-1673 regression test sizes its fixture from the real cap. */
export const THREAD_MESSAGE_PREVIEW_CHUNK_SCAN = 40;

/** Last root text or completed plan, using normalized source labels. */
// ponytail: bounded tail scan — a run whose last 40 stored chunks are all tool
// traffic just yields no preview.
async function getThreadMessagePreview(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">
): Promise<string | undefined> {
  const chunks = await listLatestStoredChunksByMessage(
    ctx,
    threadId,
    messageId,
    THREAD_MESSAGE_PREVIEW_CHUNK_SCAN
  );
  for (const chunk of chunks) {
    for (const event of expandCliNormalizedEvent(chunk.normalizedEvent).reverse()) {
      if (event.kind !== "text" && !(event.kind === "proposed-plan" && event.phase === "completed"))
        continue;
      if (event.kind === "text" && isForeignNarrativeSource(event.source)) continue;
      const text = event.text.trim();
      if (text) return clampChars(text, THREAD_MESSAGE_PREVIEW_CHARS);
    }
  }
  return undefined;
}

/**
 * `waiting_input` preview: the prompt the user must answer, read from the request row.
 * The run is still streaming when this dispatches, so scanning that message's chunks
 * would overlap `appendRunContent`'s inserts and force write-conflict retries of
 * `events/core:ingest` — and the prompt is the better excerpt anyway.
 */
async function getWaitingInputPreview(
  ctx: MutationCtx,
  threadId: Id<"cliThreads">,
  messageId: Id<"cliMessages">
): Promise<string | undefined> {
  const pending = await listInteractionRequestsByThreadAndStatus(ctx, threadId, "pending");
  // Newest wins: a run can park on several prompts, and the freshly emitted one is
  // what this notification is about. Already answered means no preview; the row lands.
  const request = pending
    .filter((row) => row.messageId === messageId)
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  const preview = request ? describeInteractionRequest(request) : undefined;
  return preview === undefined ? undefined : clampChars(preview, THREAD_MESSAGE_PREVIEW_CHARS);
}

/**
 * Thread lifecycle events (OS-1243): the only recipient is the thread owner.
 * CLI-driven transitions carry no actor, so the owner is notified;
 * browser-driven ones (cancel, delete) set the actor and self-suppress here.
 * `actorName` is the agent/runtime label — the "who" the inbox shows.
 */
async function fanOutThreadEvent(ctx: MutationCtx, event: ThreadEvent): Promise<void> {
  const thread = await getThreadById(ctx, event.subject.id);
  if (!thread || thread.isDeleted) {
    return;
  }
  if (event.actorUserId === thread.userId) {
    return;
  }
  // Rows are read per organization (docs/specs/notifications.md), so a thread
  // whose project is gone has nowhere to be shown.
  const project = await getProjectById(ctx, thread.projectId);
  if (!project) {
    return;
  }

  const threadMessage =
    event.payload.messageId === undefined
      ? undefined
      : event.type === "thread.waiting_input"
        ? await getWaitingInputPreview(ctx, thread._id, event.payload.messageId)
        : await getThreadMessagePreview(ctx, thread._id, event.payload.messageId);
  await insertForRecipients(ctx, event, {
    recipients: new Set([thread.userId]),
    organizationId: project.organizationId,
    projectId: thread.projectId,
    type: toNotificationType(event),
    snapshot: {
      threadTitle: thread.title,
      threadCliType: thread.cliType,
      actorName: await getThreadActorLabel(ctx, thread),
      ...(threadMessage !== undefined ? { threadMessage } : {}),
    },
  });
}

/**
 * Bus fan-out handler (docs/specs/notifications.md): event → per-recipient
 * notification rows with a frozen render snapshot.
 */
export const notificationsFanout: EventHandler = {
  name: "notifications",
  handle: async (ctx, event) => {
    if (isTaskEvent(event)) {
      return fanOutTaskEvent(ctx, event);
    }
    return fanOutThreadEvent(ctx, event);
  },
};
