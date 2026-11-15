"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AttachmentLightbox } from "@/components/blocks/tasks/attachment-lightbox";
import { Spinner } from "@/components/custom/spinner";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  Pill,
  PillContent,
  PillIcon,
  PillText,
} from "@/components/ui/pill";
import { getFileIcon, formatFileSize, downloadFile } from "@/lib/tasks/files";
import type { TaskCommentAttachment } from "@/lib/tasks/types";
import { useAttachmentPreview } from "@/hooks/uploads/use-attachment-preview";

interface CommentAttachmentsProps {
  attachments: TaskCommentAttachment[];
}

export function CommentAttachments({ attachments }: CommentAttachmentsProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (attachment: TaskCommentAttachment) => {
    if (!attachment.url || downloadingId) return;
    setDownloadingId(attachment._id);
    const success = await downloadFile(attachment.url, attachment.fileName);
    if (!success) {
      toast.error(`Download failed: ${attachment.fileName}`);
    }
    setDownloadingId(null);
  };

  const { tryOpenPreview, lightboxProps } =
    useAttachmentPreview<TaskCommentAttachment>({
      attachments,
      onDownload: handleDownload,
    });

  const handleAttachmentClick = (attachment: TaskCommentAttachment) => {
    if (tryOpenPreview(attachment)) {
      return;
    }

    void handleDownload(attachment);
  };

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((attachment) => {
        const Icon = getFileIcon(attachment.contentType);
        const isDownloading = downloadingId === attachment._id;

        return (
          <TooltipExt
            key={attachment._id}
            content={`${attachment.fileName} (${formatFileSize(attachment.fileSize)})`}
          >
            <Pill
              asChild
              size="compact"
              className="max-w-[160px] cursor-pointer hover:bg-muted disabled:cursor-wait disabled:opacity-70"
            >
              <button
                type="button"
                disabled={isDownloading}
                onClick={() => handleAttachmentClick(attachment)}
              >
                <PillContent className="gap-1">
                  <PillIcon>
                    {isDownloading ? (
                      <Spinner className="size-3 text-muted-foreground" />
                    ) : (
                      <Icon
                        className="size-3 text-muted-foreground"
                        strokeWidth={1.5}
                      />
                    )}
                  </PillIcon>
                  <PillText>{attachment.fileName}</PillText>
                </PillContent>
              </button>
            </Pill>
          </TooltipExt>
        );
      })}

      <AttachmentLightbox {...lightboxProps} />
    </div>
  );
}
