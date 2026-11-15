import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api.js";

export type TaskAttachmentSummary = FunctionReturnType<typeof api.tasks.attachments.listTaskAttachmentsByTask>[number];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatAttachmentSummaryLine(attachment: TaskAttachmentSummary): string {
  const uploadedAt = new Date(attachment.uploadedAt).toISOString();
  return `${attachment.fileName} (${attachment._id}) ${formatFileSize(
    attachment.fileSize
  )} ${attachment.contentType} uploaded=${uploadedAt}`;
}
