import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../../lib/config/index.js";
import type { TaskAttachmentSummary } from "./formatters.js";

export {
  resolveTaskIdForCommand as resolveTaskIdForAttachmentCommand,
} from "../resolve.js";

export async function listTaskAttachments(client: ConvoyClient, taskId: Id<"tasks">): Promise<TaskAttachmentSummary[]> {
  return client.query(api.tasks.attachments.listTaskAttachmentsByTask, {
    taskId,
  });
}

export function findTaskAttachment(attachments: TaskAttachmentSummary[], attachmentId: Id<"taskAttachments">): TaskAttachmentSummary {
  const attachment = attachments.find((item) => item._id === attachmentId);
  if (!attachment) {
    throw new Error("Attachment not found on task.");
  }
  return attachment;
}
