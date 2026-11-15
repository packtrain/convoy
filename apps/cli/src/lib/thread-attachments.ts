import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import chalk from "chalk";
import ora from "ora";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import type { ConvoyClient } from "./config/index.js";
import { getContentType } from "./content-type.js";
import { toUserFacingError } from "./convex-error.js";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, uploadToStorage } from "./storage-upload.js";

/** Matches `MAX_MESSAGE_ATTACHMENTS` in `apps/web/convex/cli/lib/messages/attachments.ts`. */
const MAX_ATTACHMENTS = 10;


/** What `cli.messages.send` / `cli.threads.create` take inline. */
export interface ThreadAttachmentInput {
  storageId: Id<"_storage">;
  fileName: string;
  fileSize: number;
  contentType: string;
}

async function uploadOne(
  client: ConvoyClient,
  projectId: Id<"projects">,
  filePath: string
): Promise<ThreadAttachmentInput> {
  const absolutePath = path.resolve(filePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error(`${filePath} is not a file.`);
  }
  // Before `readFile`, so an oversized file is rejected rather than buffered.
  if (fileStat.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${filePath} exceeds the ${MAX_UPLOAD_MB} MB attachment size limit.`);
  }

  const fileName = path.basename(absolutePath);
  const contentType = getContentType(absolutePath);
  const spinner = ora(`Uploading ${fileName}`).start();

  try {
    const uploadUrl = await client.mutation(api.cli.messages.generateMessageAttachmentUploadUrl, { projectId });
    const storageId = await uploadToStorage(uploadUrl, await readFile(absolutePath), contentType);

    // Registered before the send, never skipped: there is no cron sweep, so an
    // unregistered blob has no reclaimer. Spec: docs/specs/cli-message-attachments.md.
    await client.mutation(api.cli.messages.registerPendingUploadedAttachment, {
      projectId,
      storageId,
    });
    spinner.succeed(`Uploaded ${fileName}`);

    return { storageId, fileName, fileSize: fileStat.size, contentType };
  } catch (error) {
    spinner.fail(`Failed to upload ${fileName}`);
    throw error;
  }
}

/**
 * Resolves the thread's own project, not the default one: uploads authorize on a project, and
 * a thread outside the default one would fail or attach elsewhere.
 */
export async function requireThreadProject(client: ConvoyClient, threadId: Id<"cliThreads">): Promise<Id<"projects">> {
  const thread = await client.query(api.cli.threads.summaries.getSummary, { threadId });
  if (!thread) {
    throw new Error("Thread not found or not accessible.");
  }
  return thread.projectId;
}

/**
 * Upload `files`, hand the metadata to `send`, and always discard the pending
 * uploads — a failed send would otherwise leak the blobs. Discarding after a
 * *successful* send is a no-op on storage: the mutation deletes bytes only when
 * no message references them (`createAttachmentRefs` already dropped the rows).
 *
 * Cleanup never changes the outcome: every blob is attempted even if one fails,
 * and a cleanup failure is warned about rather than thrown. Rethrowing would turn
 * a committed send into a reported failure — losing the message id and inviting a
 * retry that queues a duplicate.
 */
export async function withThreadAttachments<T>(
  client: ConvoyClient,
  projectId: Id<"projects">,
  files: string[],
  send: (attachments: ThreadAttachmentInput[]) => Promise<T>
): Promise<T> {
  if (files.length === 0) {
    return send([]);
  }
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`A message can include at most ${MAX_ATTACHMENTS} attachments.`);
  }

  const uploaded: ThreadAttachmentInput[] = [];
  try {
    for (const file of files) {
      uploaded.push(await uploadOne(client, projectId, file));
    }
    return await send(uploaded);
  } finally {
    await discardPendingUploads(client, projectId, uploaded);
  }
}

async function discardPendingUploads(
  client: ConvoyClient,
  projectId: Id<"projects">,
  uploaded: ThreadAttachmentInput[]
): Promise<void> {
  const results = await Promise.allSettled(
    uploaded.map((attachment) =>
      client.mutation(api.cli.messages.deletePendingUploadedAttachment, {
        projectId,
        storageId: attachment.storageId,
      })
    )
  );

  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      const storageId = uploaded[index]?.storageId;
      console.error(
        chalk.yellow("!") +
          ` Could not discard pending upload ${storageId}: ${toUserFacingError(result.reason)}`
      );
    }
  }
}
