"use client";

import { createContext, useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { usePromptInputAttachments } from "@/components/ai-elements/prompt-input";
import { AttachmentLightbox } from "@/components/blocks/tasks/attachment-lightbox";
import { downloadFile, isPreviewableImageAttachment } from "@/lib/tasks/files";

type AttachmentStatuses = readonly {
  filePartId?: string;
  status: "uploading" | "uploaded" | "error";
  error?: string;
}[];

export const AttachmentStatusContext = createContext<AttachmentStatuses>([]);
export const AttachmentPreviewContext = createContext<(id: string) => void>(() => undefined);

export function AttachmentReferenceProvider({ value, children }: { value: AttachmentStatuses; children: ReactNode }) {
  const { files } = usePromptInputAttachments();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const images = useMemo(() => files.filter((file) => file.url && isPreviewableImageAttachment(file.mediaType, file.url)), [files]);
  const slides = useMemo(
    () =>
      images.map((file) => ({
        src: file.url,
        alt: file.filename ?? "attachment",
        fileName: file.filename ?? "attachment",
        download: { url: file.url, filename: file.filename ?? "attachment" },
      })),
    [images]
  );
  const index = images.findIndex((file) => file.id === previewId);
  const openPreview = useCallback(
    (id: string) => {
      if (images.some((file) => file.id === id)) setPreviewId(id);
    },
    [images]
  );
  const onDownload = useCallback(
    async (index: number) => {
      const image = images[index];
      if (image && !(await downloadFile(image.url, image.filename ?? "attachment"))) {
        toast.error(`Download failed: ${image.filename ?? "attachment"}`);
      }
    },
    [images]
  );

  return (
    <AttachmentStatusContext.Provider value={value}>
      <AttachmentPreviewContext.Provider value={openPreview}>
        {children}
        {index >= 0 ? (
          <AttachmentLightbox open slides={slides} initialIndex={index} onClose={() => setPreviewId(null)} onDownload={onDownload} />
        ) : null}
      </AttachmentPreviewContext.Provider>
    </AttachmentStatusContext.Provider>
  );
}
