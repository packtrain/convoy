import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import ora from "ora";
import { api } from "../../../convex/_generated/api.js";
import type { Id } from "../../../convex/_generated/dataModel.js";
import type { ConvoyClient } from "../../../lib/config/index.js";
import { getContentType } from "../../../lib/content-type.js";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, uploadToStorage } from "../../../lib/storage-upload.js";
import { toSafeFileName } from "../../../lib/file-name.js";
import type { TaskAttachmentSummary } from "./formatters.js";

export async function uploadTaskAttachmentFile(
  client: ConvoyClient,
  taskId: Id<"tasks">,
  filePath: string
): Promise<{
  attachmentId: Id<"taskAttachments">;
  storageId: Id<"_storage">;
  fileName: string;
  fileSize: number;
  contentType: string;
}> {
  const absolutePath = path.resolve(filePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`${filePath} is not a file.`);
  }
  if (fileStat.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${filePath} exceeds the ${MAX_UPLOAD_MB} MB attachment size limit.`);
  }

  const fileName = path.basename(absolutePath);
  const fileSize = fileStat.size;
  const contentType = getContentType(absolutePath);
  const spinner = ora(`Uploading ${fileName}`).start();
  let storageId: Id<"_storage"> | undefined;

  try {
    const uploadUrl = await client.mutation(api.tasks.attachments.generateTaskAttachmentUploadUrl, {});
    storageId = await uploadToStorage(uploadUrl, await readFile(absolutePath), contentType);

    // Ownership claim (OS-1901): save rejects blobs the caller did not register.
    await client.mutation(api.tasks.attachments.registerPendingUploadedAttachment, { storageId });

    const attachmentId = await client.mutation(api.tasks.attachments.saveTaskAttachment, {
      taskId,
      storageId,
      fileName,
      fileSize,
      contentType,
    });

    spinner.succeed(`Uploaded ${fileName}`);

    return {
      attachmentId,
      storageId,
      fileName,
      fileSize,
      contentType,
    };
  } catch (error) {
    spinner.fail(`Failed to upload ${fileName}`);
    if (storageId) {
      // A failed save leaves a registered blob; nothing else reclaims it (OS-1676).
      await client.mutation(api.tasks.comments.deletePendingUploadedAttachment, { taskId, storageId }).catch(() => undefined);
    }
    throw error;
  }
}

export async function downloadTaskAttachment(
  attachment: TaskAttachmentSummary,
  outputPath: string | undefined,
  options: { force?: boolean } = {}
): Promise<string> {
  if (!attachment.url) {
    throw new Error("Attachment does not have a download URL.");
  }

  const response = await fetch(attachment.url);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Download failed: ${response.status} - ${errorText}`);
  }

  // The server name is untrusted: reduce it to a basename so it stays in cwd (OS-1902).
  const targetPath = outputPath ? path.resolve(outputPath) : path.resolve(process.cwd(), toSafeFileName(attachment.fileName));
  await mkdir(path.dirname(targetPath), { recursive: true });
  const bytes = Buffer.from(await response.arrayBuffer());
  try {
    await writeFile(targetPath, bytes, { flag: options.force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${targetPath} already exists. Pass --force to overwrite it.`);
    }
    throw error;
  }
  return targetPath;
}
