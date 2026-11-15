import { v, type Infer } from "convex/values";
import { cliTypeValidator, statusValidator } from "./validators";

/**
 * Notification types are the bus event types plus the derived
 * `task.completed` (status change to Done/Canceled) — "completed" is
 * user-facing on its own later (dedicated preference, immediate email), so it
 * is distinct from day one. See docs/specs/notifications.md.
 */
export const notificationTypeValidator = v.union(
  v.literal("task.created"),
  v.literal("task.status_changed"),
  v.literal("task.completed"),
  v.literal("task.assignee_changed"),
  v.literal("task.deleted"),
  v.literal("task.archived"),
  v.literal("task.comment_added"),
  v.literal("thread.completed"),
  v.literal("thread.failed"),
  v.literal("thread.waiting_input")
);
export type NotificationType = Infer<typeof notificationTypeValidator>;

/**
 * `inApp` and `toast` are independent: fan-out creates a row when either is
 * on (toast-only rows are born read); `email` delivery ships in OS-1126.
 */
export const notificationChannelValidator = v.union(
  v.literal("inApp"),
  v.literal("toast"),
  v.literal("email")
);
export type NotificationChannel = Infer<typeof notificationChannelValidator>;

/**
 * Channel defaults per (type, channel): toast on, email off (opt-in), in-app
 * on — except agent-run (`thread.*`) types, which default to toast-only so
 * runs don't pile up in the inbox. Only overrides that differ from these are
 * stored in notificationPreferences.
 */
export function channelDefault(type: NotificationType, channel: NotificationChannel): boolean {
  if (channel === "email") {
    return false;
  }
  if (channel === "inApp") {
    return !type.startsWith("thread.");
  }
  return true;
}

// Enumerations of the unions above for iteration (preferences matrix).
// `satisfies Record<..., true>` makes them compile-enforced exhaustive: a
// validator literal missing here (or an extra key) fails the build.
const NOTIFICATION_TYPE_SET = {
  "task.created": true,
  "task.status_changed": true,
  "task.completed": true,
  "task.assignee_changed": true,
  "task.deleted": true,
  "task.archived": true,
  "task.comment_added": true,
  "thread.completed": true,
  "thread.failed": true,
  "thread.waiting_input": true,
} satisfies Record<NotificationType, true>;
export const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPE_SET) as readonly NotificationType[];

const NOTIFICATION_CHANNEL_SET = {
  inApp: true,
  toast: true,
  email: true,
} satisfies Record<NotificationChannel, true>;
export const NOTIFICATION_CHANNELS = Object.keys(NOTIFICATION_CHANNEL_SET) as readonly NotificationChannel[];

/**
 * Render data copied from the live docs at fan-out time so the inbox renders without
 * joins. Frozen: a later task rename doesn't rewrite existing snapshots. One shape for
 * both subject kinds — task events fill the task* fields, thread events (OS-1243) the
 * thread* ones — and the client picks by `subject.kind`.
 */
export const notificationSnapshotValidator = v.object({
  taskRef: v.optional(v.string()),
  taskTitle: v.optional(v.string()),
  taskTypeKey: v.optional(v.string()),
  threadTitle: v.optional(v.string()),
  threadCliType: v.optional(cliTypeValidator),
  threadMessage: v.optional(v.string()),
  actorName: v.optional(v.string()),
  newStatus: v.optional(statusValidator),
});
export type NotificationSnapshot = Infer<typeof notificationSnapshotValidator>;
