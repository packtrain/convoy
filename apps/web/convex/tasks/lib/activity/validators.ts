import { v } from "convex/values";
import {
  changeDetailsValidator,
  eventTypeValidator,
} from "../../../lib/contracts/taskActivity";

// The stored row shape is a schema contract (`lib/contracts/taskActivity.ts`);
// re-exported so activity code reads one module.
export { eventTypeValidator, changeDetailsValidator };

/**
 * Activity log enriched with the acting user's display fields, as returned by
 * `api.tasks.activity.listByTask`.
 */
export const taskActivityLogListItemValidator = v.object({
  _id: v.id("taskActivityLogs"),
  _creationTime: v.number(),
  taskId: v.id("tasks"),
  userId: v.id("users"),
  eventType: eventTypeValidator,
  changeDetails: v.optional(changeDetailsValidator),
  createdAt: v.number(),
  userName: v.string(),
  userAvatarUrl: v.union(v.string(), v.null()),
});
