"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { AttachmentLightbox } from "@/components/blocks/tasks/attachment-lightbox";
import { AttachmentReferencePreview } from "@/components/blocks/thread/attachment-references";
import type { ThreadMessageAttachment } from "@/components/blocks/thread/response-attachments";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SlashCommandDisplayText, splitSlashCommandDisplayLinks } from "@/lib/slash-commands/display";
import { splitAttachmentReferences } from "@/lib/threads/message-attachments";
import { downloadFile, isPreviewableImageAttachment } from "@/lib/tasks/files";

type DisplayPart = ReturnType<typeof splitSlashCommandDisplayLinks>[number] | ReturnType<typeof splitAttachmentReferences>[number];

interface Props {
  text: string;
  messageId: string;
  attachments: ThreadMessageAttachment[];
}

export function SentMessageText({ text, messageId, attachments }: Props) {
  const [requested, setRequested] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const resolved = useQuery(api.cli.messages.getMessageAttachmentUrls, requested ? { messageId: messageId as Id<"cliMessages"> } : "skip");
  const files = useMemo(
    () =>
      attachments.map((attachment) => ({
        type: "file" as const,
        id: attachment.storageId,
        filename: attachment.fileName,
        mediaType: attachment.contentType,
        url: resolved?.find((file) => file.storageId === attachment.storageId)?.url ?? "",
      })),
    [attachments, resolved]
  );
  const images = files.filter((file) => file.url && isPreviewableImageAttachment(file.mediaType, file.url));
  const index = images.findIndex((file) => file.id === previewId);
  const parts = useMemo(
    () =>
      splitSlashCommandDisplayLinks(text).flatMap<DisplayPart>((part) => {
        if (part.type === "slash-command") return [part];
        return splitAttachmentReferences(
          part.value,
          attachments.map((file) => file.fileName)
        );
      }),
    [text, attachments]
  );

  return (
    <>
      <span className="whitespace-pre-wrap">
        {parts.map((part, partIndex) => {
          if (part.type === "slash-command") {
            const scheme = part.isSkill ? "skill" : "command";
            const key = part.isSkill ? part.canonicalKey.slice(6) : part.canonicalKey;
            return <SlashCommandDisplayText key={partIndex} text={`[${part.label}](convoy://${scheme}/${key})`} />;
          }
          if (part.type === "text") return part.value;
          const file = files.find((file) => file.filename === part.filename)!;
          const className = "inline rounded bg-primary/10 px-1 py-0.5 font-medium text-primary break-all";
          if (!file.mediaType.startsWith("image/")) {
            return (
              <span key={partIndex} data-attachment-reference className={className}>
                #{file.filename}
              </span>
            );
          }
          return (
            <AttachmentReferencePreview
              key={partIndex}
              file={file}
              openOnClick
              onRequestPreview={() => setRequested(true)}
              onPreview={setPreviewId}
              status={!resolved ? "loading" : !file.url ? "unavailable" : undefined}
            >
              <button
                type="button"
                data-attachment-reference
                aria-label={`Preview ${file.filename}`}
                className={`${className} cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              >
                #{file.filename}
              </button>
            </AttachmentReferencePreview>
          );
        })}
      </span>
      {index >= 0 ? (
        <AttachmentLightbox
          open
          initialIndex={index}
          slides={images.map((file) => ({
            src: file.url,
            alt: file.filename,
            fileName: file.filename,
            download: { url: file.url, filename: file.filename },
          }))}
          onClose={() => setPreviewId(null)}
          onDownload={async (slideIndex) => {
            const file = images[slideIndex];
            if (file && !(await downloadFile(file.url, file.filename))) toast.error(`Download failed: ${file.filename}`);
          }}
        />
      ) : null}
    </>
  );
}
