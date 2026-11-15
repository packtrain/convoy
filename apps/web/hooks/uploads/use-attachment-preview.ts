"use client";

import { useCallback, useMemo, useState } from "react";
import type { AttachmentLightboxSlide } from "@/components/blocks/tasks/attachment-lightbox";
import {
  isPreviewableImageAttachment,
  isPreviewableTextAttachment,
  isPreviewableVideoAttachment,
} from "@/lib/tasks/files";

interface PreviewableAttachment {
  contentType: string;
  url: string | null;
  fileName: string;
  /** Unknown size never previews as text. */
  fileSize?: number;
}

interface UseAttachmentPreviewOptions<T extends PreviewableAttachment> {
  attachments: T[];
  onDownload: (attachment: T) => void | Promise<void>;
}

function isPreviewableMedia(contentType: string, url: string | null): boolean {
  return (
    isPreviewableImageAttachment(contentType, url) ||
    isPreviewableVideoAttachment(contentType, url)
  );
}

function isPreviewableText<T extends PreviewableAttachment>(
  attachment: T
): attachment is T & { url: string } {
  return (
    attachment.fileSize !== undefined &&
    isPreviewableTextAttachment(
      attachment.contentType,
      attachment.url,
      attachment.fileSize
    )
  );
}

function isPreviewableAttachment<T extends PreviewableAttachment>(
  attachment: T
): attachment is T & { url: string } {
  return isPreviewableMedia(attachment.contentType, attachment.url);
}

function isSamePreviewAttachment<T extends PreviewableAttachment>(
  left: T,
  right: T
): boolean {
  return left.url === right.url && left.fileName === right.fileName;
}

function toLightboxSlide<T extends PreviewableAttachment & { url: string }>(
  attachment: T
): AttachmentLightboxSlide {
  const download = {
    url: attachment.url,
    filename: attachment.fileName,
  };

  if (isPreviewableVideoAttachment(attachment.contentType, attachment.url)) {
    return {
      type: "video",
      sources: [{ src: attachment.url, type: attachment.contentType }],
      fileName: attachment.fileName,
      download,
    };
  }

  return {
    src: attachment.url,
    alt: attachment.fileName,
    fileName: attachment.fileName,
    download,
  };
}

export function useAttachmentPreview<T extends PreviewableAttachment>({
  attachments,
  onDownload,
}: UseAttachmentPreviewOptions<T>) {
  const [previewTarget, setPreviewTarget] = useState<T | null>(null);
  const textTarget =
    previewTarget && isPreviewableText(previewTarget) ? previewTarget : null;

  const tryOpenPreview = useCallback((attachment: T) => {
    if (
      !isPreviewableMedia(attachment.contentType, attachment.url) &&
      !isPreviewableText(attachment)
    ) {
      return false;
    }

    setPreviewTarget(attachment);
    return true;
  }, []);

  const previewableAttachments = useMemo(
    () => attachments.filter(isPreviewableAttachment),
    [attachments]
  );

  const slides = useMemo<AttachmentLightboxSlide[]>(
    () => previewableAttachments.map(toLightboxSlide),
    [previewableAttachments]
  );

  const initialIndex = useMemo(() => {
    if (!previewTarget) {
      return 0;
    }

    const index = previewableAttachments.findIndex((attachment) =>
      isSamePreviewAttachment(attachment, previewTarget)
    );
    return index >= 0 ? index : 0;
  }, [previewTarget, previewableAttachments]);

  const handleDownload = useCallback(
    (index: number) => {
      const attachment = previewableAttachments[index];
      if (!attachment) {
        return;
      }

      void onDownload(attachment);
    },
    [onDownload, previewableAttachments]
  );

  return {
    tryOpenPreview,
    lightboxProps: {
      open: previewTarget !== null && textTarget === null,
      slides,
      initialIndex,
      onClose: () => setPreviewTarget(null),
      onDownload: handleDownload,
      textPreview: textTarget
        ? {
            fileName: textTarget.fileName,
            url: textTarget.url,
            contentType: textTarget.contentType,
            onDownload: () => void onDownload(textTarget),
          }
        : null,
    },
  };
}
