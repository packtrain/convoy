import { ConvexError } from "convex/values";
import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import type { CliMessageAttachmentInput, CliMessageRole } from "../../../lib/contracts/validators";
import { MAX_ATTACHMENT_CAPTION_LENGTH, MAX_MESSAGE_ATTACHMENTS } from "../../../lib/constants";
import { ensure } from "../../../lib/shared/ensure";
import { isSafeFileName } from "../../../lib/shared/strings";
import { deleteStorageIfUnreferenced, getStorageSize } from "../../../lib/storageRepo";
import { errors } from "../../errors";
import { deletePendingUpload, listPendingUploadsByStorageId } from "../cliMessagePendingUploadsRepo";
import { deleteAttachmentRef, insertAttachmentRef, listAttachmentRefsByMessage } from "../cliMessageAttachmentRefsRepo";

export function assertValidMessageAttachments(attachments: CliMessageAttachmentInput[] | undefined): CliMessageAttachmentInput[] {
  const normalized = attachments ?? [];
  if (normalized.length > MAX_MESSAGE_ATTACHMENTS) {
    throw new ConvexError(`A message can include at most ${MAX_MESSAGE_ATTACHMENTS} attachments`);
  }
  for (const attachment of normalized) {
    ensure(isSafeFileName(attachment.fileName)).isTrue(errors.ATTACHMENT_FILE_NAME_INVALID);
    ensure(attachment.display !== "inline" || attachment.contentType === "text/html").isTrue(errors.ATTACHMENT_INLINE_NOT_HTML);
    ensure(attachment.caption?.length ?? 0).lte(MAX_ATTACHMENT_CAPTION_LENGTH, errors.attachmentCaptionTooLong(MAX_ATTACHMENT_CAPTION_LENGTH));
  }

  return normalized;
}

/** Reject a `fileSize` that disagrees with the stored blob (OS-1676). Call only once ownership is proven. */
export async function assertStoredAttachmentSize(
  ctx: MutationCtx,
  { storageId, fileSize }: Pick<CliMessageAttachmentInput, "storageId" | "fileSize">
): Promise<void> {
  const size = await ensure(getStorageSize(ctx, storageId)).notNull(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
  ensure(size).eq(fileSize, errors.ATTACHMENT_SIZE_MISMATCH);
}

/**
 * Spend the sender's pending-upload claim so a blob is attached only by its uploader (OS-1901),
 * and reject a `fileSize` that disagrees with the stored blob (OS-1676).
 */
async function claimPendingAttachmentUpload(
  ctx: MutationCtx,
  owner: { userId: Id<"users">; projectId: Id<"projects"> },
  { storageId, fileSize }: Pick<CliMessageAttachmentInput, "storageId" | "fileSize">
): Promise<void> {
  const pendingRows = await listPendingUploadsByStorageId(ctx, storageId);
  const owned = pendingRows.filter((row) => row.userId === owner.userId && row.projectId === owner.projectId);
  ensure(owned.length > 0).isTrue(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
  await assertStoredAttachmentSize(ctx, { storageId, fileSize });
  await Promise.all(owned.map((row) => deletePendingUpload(ctx, row._id)));
}

export async function createAttachmentRefs(
  ctx: MutationCtx,
  args: {
    messageId: Id<"cliMessages">;
    threadId: Id<"cliThreads">;
    role: CliMessageRole;
    owner: { userId: Id<"users">; projectId: Id<"projects"> };
    attachments: CliMessageAttachmentInput[];
    now: number;
  }
): Promise<void> {
  const { messageId, threadId, role, owner, attachments, now } = args;
  if (attachments.length === 0) {
    return;
  }

  await Promise.all(
    attachments.map(async (attachment) => {
      await claimPendingAttachmentUpload(ctx, owner, attachment);
      await insertAttachmentRef(
        ctx,
        {
          messageId,
          threadId,
          storageId: attachment.storageId,
          role,
        },
        now
      );
    })
  );
}

/** Release a deleted message's refs; a blob another ref or family still holds survives. */
export async function deleteMessageAttachmentRefs(ctx: MutationCtx, messageId: Id<"cliMessages">): Promise<void> {
  for (const ref of await listAttachmentRefsByMessage(ctx, messageId)) {
    await deleteAttachmentRef(ctx, ref._id);
    await deleteStorageIfUnreferenced(ctx, ref.storageId);
  }
}
