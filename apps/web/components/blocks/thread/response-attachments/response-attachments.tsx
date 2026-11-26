"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useConvex } from "convex/react";
import { toast } from "sonner";
import { AttachmentLightbox } from "@/components/blocks/tasks/attachment-lightbox";
import { ThreadAttachmentCard } from "@/components/blocks/thread/thread-attachment-card";
import { Spinner } from "@/components/custom/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AttachmentDisplay, ImageDimensions } from "@/convex/lib/contracts/validators";
import { useAttachmentPreview } from "@/hooks/uploads/use-attachment-preview";
import { downloadFile, getFileIcon } from "@/lib/tasks/files";
import { cn } from "@/lib/utils";
import { InlineHtmlAttachment } from "./inline-html-attachment";

/** Attachment metadata as it rides the message envelope; no signed `url` (OS-1600). */
export interface ThreadMessageAttachment {
  storageId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  uploadedAt: number;
  dimensions?: ImageDimensions;
  display?: AttachmentDisplay;
  caption?: string;
}

type ResolvedAttachment = ThreadMessageAttachment & { url: string | null };
type AttachmentGroup = { kind: "images" | "files"; items: ResolvedAttachment[] };

const MAX_GALLERY_THUMBNAILS = 4;
const MAX_INLINE_IMAGE_HEIGHT = 320;

/** An inline image's final box from its stored size, so neither the skeleton nor the loading image resizes. */
function inlineImageBox(dimensions: ImageDimensions | undefined): CSSProperties | undefined {
  if (!dimensions) return undefined;
  const { width, height } = dimensions;
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return undefined;
  return { width: Math.min(width, (MAX_INLINE_IMAGE_HEIGHT * width) / height), aspectRatio: `${width} / ${height}` };
}

/** Shown expanded, so their URLs are read on entering the viewport rather than on click. */
const isInlineHtml = (attachment: ThreadMessageAttachment) => attachment.display === "inline";
const isImage = (attachment: ThreadMessageAttachment) => attachment.contentType.startsWith("image/");

/**
 * Adjacent images share a group (one inline image or a gallery); adjacent files share a card row.
 * Inline html pages (OS-2220) are files here too: their card is where the reader downloads them.
 */
function groupInOrder(attachments: ResolvedAttachment[]): AttachmentGroup[] {
  const groups: AttachmentGroup[] = [];
  for (const attachment of attachments) {
    const kind = isImage(attachment) ? "images" : "files";
    const last = groups.at(-1);
    if (last?.kind === kind) last.items.push(attachment);
    else groups.push({ kind, items: [attachment] });
  }
  return groups;
}

/**
 * A message's files: an agent's reply (OS-2091) or a user's message. URLs are a one-shot read keyed
 * by the ordered attachment set: on entering the viewport when images or inline pages show, else on first click.
 * Spec: docs/specs/cli-message-attachments.md.
 */
export function ResponseAttachments({
  messageId,
  attachments,
  className,
  loadUrls,
}: {
  /** Keys the URL read; the default loader reads this message's URLs. */
  messageId: string;
  attachments: ThreadMessageAttachment[];
  className?: string;
  /** Replaces the thread-gated message read, e.g. task-gated check evidence. */
  loadUrls?: () => Promise<{ storageId: string; url: string | null }[]>;
}) {
  const convex = useConvex();
  const containerRef = useRef<HTMLDivElement>(null);
  const key = `${messageId}:${attachments.map((attachment) => attachment.storageId).join(",")}`;
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{ key: string; urls: Map<string, string | null> } | null>(null);
  const [pendingStorageIds, setPendingStorageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [downloadingStorageId, setDownloadingStorageId] = useState<string | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<ReadonlySet<string>>(() => new Set());
  const readsOnView = attachments.some((attachment) => isImage(attachment) || isInlineHtml(attachment));
  const urls = resolved?.key === key ? resolved.urls : null;
  const readFailed = failedKey === key;
  // Pending clicks keep the read alive across a new batch; a failed read waits for a click.
  const shouldRead = urls === null && !readFailed && (requestedKey === key || pendingStorageIds.size > 0);

  useEffect(() => {
    if (!readsOnView || requestedKey === key || readFailed) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setRequestedKey(key);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        setRequestedKey(key);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [readsOnView, key, readFailed, requestedKey]);

  useEffect(() => {
    if (!shouldRead) return;
    let current = true;
    const read = loadUrls ?? (() => convex.query(api.cli.messages.getMessageAttachmentUrls, { messageId: messageId as Id<"cliMessages"> }));
    read().then(
      (rows) => {
        if (current) setResolved({ key, urls: new Map(rows.map((row) => [row.storageId, row.url])) });
      },
      (error: unknown) => {
        if (!current) return;
        console.warn("Failed to load reply attachment URLs", error);
        setFailedKey(key);
        setPendingStorageIds(new Set());
        toast.error("Couldn't load attachments. Click a file to retry.");
      }
    );
    return () => {
      current = false;
    };
    // `loadUrls` is usually an inline closure; the key already names what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convex, key, messageId, shouldRead]);

  const resolvedAttachments = useMemo<ResolvedAttachment[]>(
    () => attachments.map((attachment) => ({ ...attachment, url: urls?.get(attachment.storageId) ?? null })),
    [attachments, urls]
  );
  const previewableAttachments = useMemo(
    () => resolvedAttachments.filter((attachment) => !failedImageIds.has(attachment.storageId)),
    [resolvedAttachments, failedImageIds]
  );

  const handleDownload = async (attachment: ResolvedAttachment) => {
    if (!attachment.url || downloadingStorageId) return;
    setDownloadingStorageId(attachment.storageId);
    if (!(await downloadFile(attachment.url, attachment.fileName))) {
      toast.error(`Download failed: ${attachment.fileName}`);
    }
    setDownloadingStorageId(null);
  };

  const { tryOpenPreview, lightboxProps } = useAttachmentPreview<ResolvedAttachment>({
    attachments: previewableAttachments,
    onDownload: handleDownload,
  });

  const openAttachment = (attachment: ResolvedAttachment) => {
    if (!attachment.url) {
      toast.error(`Attachment unavailable: ${attachment.fileName}`);
      return;
    }
    if (failedImageIds.has(attachment.storageId) || !tryOpenPreview(attachment)) {
      void handleDownload(attachment);
    }
  };

  // Replay the clicks that triggered resolution once the URLs land.
  useEffect(() => {
    if (pendingStorageIds.size === 0 || urls === null) return;
    const targets = resolvedAttachments.filter((attachment) => pendingStorageIds.has(attachment.storageId));
    setPendingStorageIds(new Set());
    targets.forEach(openAttachment);
    // `openAttachment` closes over render-scoped state; the pending ids and URLs gate this replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStorageIds, urls, resolvedAttachments]);

  const handleFileClick = (attachment: ResolvedAttachment) => {
    if (urls !== null) {
      openAttachment(attachment);
      return;
    }
    setFailedKey(null);
    setRequestedKey(key);
    setPendingStorageIds((previous) => new Set(previous).add(attachment.storageId));
  };

  /** The hidden images' entry point: the first one that can still preview, else the first hidden file. */
  const openOverflow = (hidden: ResolvedAttachment[]) => {
    const target = hidden.find((attachment) => attachment.url && !failedImageIds.has(attachment.storageId)) ?? hidden[0];
    if (target) openAttachment(target);
  };

  const isBusy = (attachment: ResolvedAttachment) =>
    downloadingStorageId === attachment.storageId || pendingStorageIds.has(attachment.storageId);

  const renderFileCard = (attachment: ResolvedAttachment, state?: "error") => (
    <ThreadAttachmentCard
      key={attachment.storageId}
      fileName={attachment.fileName}
      fileSize={attachment.fileSize}
      icon={getFileIcon(attachment.contentType)}
      state={state ?? (isBusy(attachment) ? "loading" : "idle")}
      onClick={() => handleFileClick(attachment)}
    />
  );

  /** A gallery cell that can't show its image keeps the cell's size: icon and name. */
  const renderFallbackTile = (attachment: ResolvedAttachment, className: string, state?: "error") => {
    const Icon = getFileIcon(attachment.contentType);
    return (
      <button
        key={attachment.storageId}
        type="button"
        data-attachment-name={attachment.fileName}
        title={attachment.fileName}
        disabled={isBusy(attachment)}
        onClick={() => handleFileClick(attachment)}
        className={cn(className, "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md bg-muted p-2 text-xs disabled:cursor-wait")}
      >
        {isBusy(attachment) ? (
          <Spinner className="size-5 text-muted-foreground" />
        ) : (
          <Icon className={cn("size-5", state === "error" ? "text-destructive" : "text-muted-foreground")} strokeWidth={1.5} />
        )}
        <span className={cn("max-w-full truncate", state === "error" && "text-destructive")}>{attachment.fileName}</span>
      </button>
    );
  };

  const renderImage = (attachment: ResolvedAttachment, className: string, inGallery: boolean, style?: CSSProperties) => {
    const fallback = (state?: "error") =>
      inGallery ? renderFallbackTile(attachment, className, state) : renderFileCard(attachment, state);
    if (urls === null) {
      if (readFailed) return fallback();
      return <Skeleton key={attachment.storageId} data-attachment-name={attachment.fileName} className={className} style={style} />;
    }
    if (!attachment.url) return fallback("error");
    if (failedImageIds.has(attachment.storageId)) return fallback();
    return (
      <button
        key={attachment.storageId}
        type="button"
        data-attachment-name={attachment.fileName}
        aria-label={`Open ${attachment.fileName}`}
        className="cursor-zoom-in overflow-hidden rounded-md border bg-muted"
        onClick={() => openAttachment(attachment)}
      >
        {/* Original upload, lazy-loaded; no thumbnail service (OS-2091). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.url}
          alt={attachment.fileName}
          loading="lazy"
          className={className}
          style={style}
          onError={() => setFailedImageIds((previous) => new Set(previous).add(attachment.storageId))}
        />
      </button>
    );
  };

  if (attachments.length === 0) return null;

  return (
    <div ref={containerRef} className={cn("flex flex-col items-start gap-2", className)}>
      {/* Inline pages sit above the other attachments; a failed or missing one leaves only its card. */}
      {urls !== null &&
        resolvedAttachments.map((attachment) =>
          isInlineHtml(attachment) && attachment.url ? (
            <InlineHtmlAttachment key={attachment.storageId} url={attachment.url} fileName={attachment.fileName} />
          ) : null
        )}
      {urls === null && !readFailed && attachments.some(isInlineHtml) && <Skeleton className="mt-4 h-60 w-full self-stretch" />}
      {groupInOrder(resolvedAttachments).map((group) => {
        const groupKey = group.items[0]?.storageId;
        if (group.kind === "files") {
          return (
            <div key={groupKey} className="flex flex-wrap gap-2">
              {group.items.map((attachment) => renderFileCard(attachment))}
            </div>
          );
        }
        const single = group.items.length === 1 ? group.items[0] : undefined;
        if (single) {
          const box = inlineImageBox(single.dimensions);
          return (
            <div key={groupKey} className="max-w-full">
              {renderImage(single, cn("block max-h-80 max-w-full object-contain", !box && urls === null && !readFailed && "h-48 w-72"), false, box)}
            </div>
          );
        }
        const visible = group.items.slice(0, MAX_GALLERY_THUMBNAILS);
        const hidden = group.items.slice(MAX_GALLERY_THUMBNAILS - 1);
        const remaining = group.items.length - visible.length;
        return (
          <div key={groupKey} data-response-gallery className="flex flex-wrap gap-1">
            {/* The `+N` wrapper is `flex`: a block wrapper would put the thumbnail on a line box and stretch the row by its descender gap. */}
            {visible.map((attachment, index) =>
              index === visible.length - 1 && remaining > 0 && urls !== null ? (
                <div key={attachment.storageId} className="relative flex">
                  {renderImage(attachment, "block size-32 object-cover", true)}
                  {/* Its own control, so the hidden images stay reachable when this thumbnail fails. */}
                  <button
                    type="button"
                    aria-label={`Show ${remaining} more`}
                    className="absolute inset-0 flex cursor-zoom-in items-center justify-center rounded-md bg-black/50 text-lg font-medium text-white"
                    onClick={() => openOverflow(hidden)}
                  >
                    +{remaining}
                  </button>
                </div>
              ) : (
                renderImage(attachment, "block size-32 object-cover", true)
              )
            )}
          </div>
        );
      })}
      <AttachmentLightbox {...lightboxProps} />
    </div>
  );
}
