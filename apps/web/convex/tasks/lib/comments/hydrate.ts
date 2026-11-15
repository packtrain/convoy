import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import { ProjectPermission } from "../../../../lib/authz/permissions";
import { hasAuthorizedProjectPermission, type AuthorizedProjectAccess } from "../../../lib/access/permissions";
import { join } from "../../../lib/shared/join";
import { getUsersByIds } from "../../../users/lib/usersRepo";
import { listTaskCommentAttachmentsByCommentIds } from "../taskCommentAttachmentsRepo";
import type { TaskCommentRow } from "./validators";

/**
 * Enrich comments with author display fields, attachments (+ signed storage
 * URLs), and the viewer's `canEdit`/`canDelete` flags.
 *
 * Shared by `tasks.comments.listByTask` and the merged
 * `tasks.timeline.listByTask` so both render identical comment rows.
 */
export async function hydrateTaskComments(
  ctx: QueryCtx,
  comments: readonly Doc<"taskComments">[],
  viewer: { userId: Id<"users">; access: AuthorizedProjectAccess }
): Promise<TaskCommentRow[]> {
  const canDeleteAny = hasAuthorizedProjectPermission(viewer.access, ProjectPermission.COMMENT_DELETE_ANY);

  // Batch fetch attachments for every comment on the page, then resolve their
  // storage URLs once.
  const commentIds = comments.map((comment) => comment._id);
  const allAttachments = await listTaskCommentAttachmentsByCommentIds(ctx, commentIds);
  const attachmentMap = new Map(commentIds.map((id, index) => [id, allAttachments[index]]));

  // One round trip per attachment, all in flight at once — they are independent.
  const flatAttachments = allAttachments.flat();
  const attachmentUrls = await Promise.all(
    flatAttachments.map((attachment) => ctx.storage.getUrl(attachment.storageId))
  );
  const attachmentUrlMap = new Map<Id<"taskCommentAttachments">, string | null>(
    flatAttachments.map((attachment, index) => [attachment._id, attachmentUrls[index]])
  );

  // Left join: the author may have been deleted.
  return join(comments)
    .on((comment) => comment.authorId)
    .with((ids) => getUsersByIds(ctx, ids))
    .selectAll((comment, author) => {
      const attachments = attachmentMap.get(comment._id) ?? [];
      const isAuthor = comment.authorId === viewer.userId;

      return {
        ...comment,
        authorName: author?.name ?? "Unknown",
        authorAvatarUrl: author?.avatarUrl ?? null,
        attachments: attachments.map((attachment) => ({
          _id: attachment._id,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          contentType: attachment.contentType,
          url: attachmentUrlMap.get(attachment._id) ?? null,
        })),
        canEdit: isAuthor,
        canDelete: isAuthor || canDeleteAny,
      };
    });
}
