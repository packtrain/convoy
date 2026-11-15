"use client";

import Image from "next/image";
import { useContext, useState, type ReactElement } from "react";
import type { FileUIPart } from "ai";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { isPreviewableImageAttachment } from "@/lib/tasks/files";
import { AttachmentPreviewContext } from "./provider";

export function AttachmentReferencePreview({
  file,
  children,
  openOnClick = false,
  onRequestPreview,
  onPreview,
  status,
}: {
  file?: FileUIPart & { id: string };
  children: ReactElement;
  openOnClick?: boolean;
  onRequestPreview?: () => void;
  onPreview?: (id: string) => void;
  status?: "loading" | "unavailable";
}) {
  const [open, setOpen] = useState(false);
  const openPreview = useContext(AttachmentPreviewContext);
  if (!file || (!status && (!file.url || !isPreviewableImageAttachment(file.mediaType, file.url)))) return children;
  const name = file.filename ?? "attachment";
  const showLightbox = () => {
    onRequestPreview?.();
    setOpen(!file.url);
    (onPreview ?? openPreview)(file.id);
  };

  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onRequestPreview?.();
      }}
      openDelay={250}
      closeDelay={100}
    >
      <HoverCardTrigger
        asChild
        onClick={(event) => {
          if (openOnClick) {
            event.stopPropagation();
            showLightbox();
          }
        }}
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="pointer-events-auto z-[110] w-96 max-w-[calc(100vw-24px)] p-2"
        onMouseDown={(event) => event.preventDefault()}
      >
        {status ? (
          <span role="status" className="text-muted-foreground">
            {status === "loading" ? "Loading preview…" : "Image unavailable"}
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Open ${name} in lightbox`}
            className="block w-full cursor-zoom-in rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation();
              showLightbox();
            }}
          >
            <Image
              unoptimized
              src={file.url}
              alt={name}
              width={368}
              height={256}
              className="max-h-[min(16rem,60vh)] w-full rounded object-contain"
            />
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
