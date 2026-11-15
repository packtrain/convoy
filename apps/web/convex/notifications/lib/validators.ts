import { v } from "convex/values";
import { eventSubjectValidator } from "../../lib/contracts/appEvents";
import {
  notificationSnapshotValidator,
  notificationTypeValidator,
} from "../../lib/contracts/notifications";

const notificationRowFields = {
  _id: v.id("notifications"),
  _creationTime: v.number(),
  userId: v.id("users"),
  type: notificationTypeValidator,
  actorUserId: v.optional(v.id("users")),
  organizationId: v.optional(v.id("organizations")),
  projectId: v.id("projects"),
  subject: eventSubjectValidator,
  read: v.boolean(),
  readAt: v.optional(v.number()),
  snapshot: notificationSnapshotValidator,
};

/** Full notifications row as returned by the inbox queries. */
export const notificationItemValidator = v.object(notificationRowFields);

/**
 * Inbox feed item: the row plus live navigation/render context resolved at
 * read time (task deep link needs org slug + project alias; avatar is live,
 * unlike the frozen snapshot). orgSlug/projectAlias are absent when the
 * recipient can no longer view the project — the client renders those rows
 * as "No access" without a link.
 */
export const notificationFeedItemValidator = v.object({
  ...notificationRowFields,
  orgSlug: v.optional(v.string()),
  projectAlias: v.optional(v.string()),
  actorAvatarUrl: v.optional(v.string()),
});
