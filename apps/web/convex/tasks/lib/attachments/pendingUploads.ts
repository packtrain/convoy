import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { ensure } from "../../../lib/shared/ensure";
import { getStorageSize } from "../../../lib/storageRepo";
import { errors } from "../../errors";
import { deleteTaskAttachmentPendingUpload, findOwnedTaskAttachmentPendingUpload } from "../taskAttachmentPendingUploadsRepo";

/**
 * Spend the caller's pending-upload claim so the blob is attached exactly once (OS-1901),
 * and reject a `fileSize` that disagrees with the stored blob (OS-1676).
 */
export async function claimPendingUpload(ctx: MutationCtx, userId: Id<"users">, storageId: Id<"_storage">, fileSize: number): Promise<void> {
  const owned = await ensure(findOwnedTaskAttachmentPendingUpload(ctx, userId, storageId)).notNull(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
  const size = await ensure(getStorageSize(ctx, storageId)).notNull(errors.ATTACHMENT_UPLOAD_NOT_OWNED);
  ensure(size).eq(fileSize, errors.ATTACHMENT_SIZE_MISMATCH);
  await deleteTaskAttachmentPendingUpload(ctx, owned._id);
}
