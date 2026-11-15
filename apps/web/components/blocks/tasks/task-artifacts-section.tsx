"use client";

import { Fragment, useState, type DragEvent } from "react";
import { Copy, ExternalLink, FileText, Paperclip, Plus } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/custom/spinner";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Pill,
  PillAction,
  PillContent,
  PillIcon,
  PillMeta,
  PillText,
} from "@/components/ui/pill";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { AttachmentLightbox } from "@/components/blocks/tasks/attachment-lightbox";
import {
  AppLink,
  appRoute,
  href,
  shouldHandleInPlaceNavigation,
  useRouteParams,
} from "@/lib/navigation";
import {
  setResourceDragPayload,
  type ResourceDragKind,
} from "@/lib/tasks/resource-drag";
import { formatFileSize, getFileIcon, downloadFile } from "@/lib/tasks/files";
import type { Id } from "@/convex/_generated/dataModel";
import type { TaskAttachment, UploadProgress } from "@/lib/tasks/types";
import { cn } from "@/lib/utils";
import { useAttachmentPreview } from "@/hooks/uploads/use-attachment-preview";

interface TaskArtifactSummary {
  _id: Id<"taskArtifacts">;
  name: string;
  contentType?: "markdown" | "html";
  createdAt: number;
}

interface TaskArtifactsSectionProps {
  // Both set: artifact pills become drag sources for a move to another task
  // (OS-1711). Absent on hosts without task/project context.
  projectId?: Id<"projects">;
  taskId?: Id<"tasks">;
  attachments: TaskAttachment[] | undefined;
  uploading: UploadProgress[];
  onDeleteAttachment: (id: Id<"taskAttachments">) => void;
  onAttachFilesClick: () => void;
  artifacts: TaskArtifactSummary[] | undefined;
  selectedArtifactId: string | null;
  onSelectArtifact: (artifactId: Id<"taskArtifacts">) => void;
  onDeleteArtifact: (artifactId: Id<"taskArtifacts">) => Promise<void>;
  onCreateArtifact: () => void;
  disabled?: boolean;
}

export function TaskArtifactsSection({
  projectId,
  taskId,
  artifacts,
  attachments,
  uploading,
  onDeleteAttachment,
  onAttachFilesClick,
  selectedArtifactId,
  onSelectArtifact,
  onDeleteArtifact,
  onCreateArtifact,
  disabled = false,
}: TaskArtifactsSectionProps) {
  const orderedArtifacts = artifacts
    ? [...artifacts].sort((left, right) => left.createdAt - right.createdAt)
    : [];

  // Dragging moves the resource, which edits both tasks — archived tasks can't.
  const dragSource =
    !disabled && projectId && taskId ? { projectId, taskId } : null;

  const getResourceDragProps = (
    kind: ResourceDragKind,
    resourceId: string,
    name: string
  ) => ({
    draggable: dragSource !== null,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (!dragSource) return;
      setResourceDragPayload(event.dataTransfer, {
        ...dragSource,
        kind,
        resourceId,
        name,
      });
      event.dataTransfer.effectAllowed = "move";
    },
  });

  const params = useRouteParams<{
    organizationSlug?: string;
    projectAlias?: string;
  }>();
  const artifactPageHref = (artifactId: Id<"taskArtifacts">) =>
    params?.organizationSlug && params?.projectAlias
      ? href(
          appRoute.projectArtifact(
            params.organizationSlug,
            params.projectAlias,
            artifactId
          )
        )
      : null;

  const [deleteTarget, setDeleteTarget] = useState<TaskAttachment | null>(null);
  const [deleteArtifactTarget, setDeleteArtifactTarget] =
    useState<TaskArtifactSummary | null>(null);
  const [downloadTarget, setDownloadTarget] = useState<TaskAttachment | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = async (attachment: TaskAttachment) => {
    if (!attachment.url || downloadingId) return;
    setDownloadingId(attachment._id);
    const success = await downloadFile(attachment.url, attachment.fileName);
    if (!success) {
      toast.error(`Download failed: ${attachment.fileName}`);
    }
    setDownloadingId(null);
  };

  const { tryOpenPreview, lightboxProps } = useAttachmentPreview<TaskAttachment>({
    attachments: attachments ?? [],
    onDownload: handleDownload,
  });

  const activeUploads = uploading.filter(
    (item) =>
      item.status !== "done" &&
      !attachments?.some((attachment) => attachment.fileName === item.fileName)
  );

  const hasResources =
    (artifacts && artifacts.length > 0) ||
    (attachments && attachments.length > 0) ||
    activeUploads.length > 0;

  const handleAttachmentClick = (attachment: TaskAttachment) => {
    if (tryOpenPreview(attachment)) {
      return;
    }

    setDownloadTarget(attachment);
  };

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-1">
        <h3 className="text-sm font-medium text-foreground">Resources</h3>
        {!disabled && (
          <TooltipExt content="Attach files">
            <button
              type="button"
              onClick={onAttachFilesClick}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Attach files"
              title="Attach files"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </button>
          </TooltipExt>
        )}
      </div>

      {!hasResources && disabled ? (
        <div className="text-sm text-muted-foreground pb-2">No resources</div>
      ) : !hasResources ? (
        <div className="text-sm text-muted-foreground pb-2">
          Drop files here, or{" "}
          <button
            type="button"
            onClick={onCreateArtifact}
            className="cursor-pointer underline underline-offset-2 hover:text-foreground"
          >
            create an artifact
          </button>
          .
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {attachments?.map((attachment) => {
            const Icon = getFileIcon(attachment.contentType);
            return (
              <TooltipExt
                key={attachment._id}
                content={`${attachment.fileName} (${formatFileSize(attachment.fileSize)})`}
              >
                <Pill className="max-w-[200px]">
                  <PillContent asChild>
                    <button
                      type="button"
                      disabled={downloadingId === attachment._id}
                      onClick={() => handleAttachmentClick(attachment)}
                      className="cursor-pointer disabled:cursor-wait disabled:opacity-70"
                      {...getResourceDragProps(
                        "attachment",
                        attachment._id,
                        attachment.fileName
                      )}
                    >
                      <PillIcon>
                        {downloadingId === attachment._id ? (
                          <Spinner className="size-4 text-muted-foreground" />
                        ) : (
                          <Icon className="size-4 text-muted-foreground" />
                        )}
                      </PillIcon>
                      <PillText>{attachment.fileName}</PillText>
                    </button>
                  </PillContent>
                  {!disabled && downloadingId !== attachment._id ? (
                    <PillAction
                      onClick={() => setDeleteTarget(attachment)}
                      aria-label={`Delete ${attachment.fileName}`}
                    />
                  ) : null}
                </Pill>
              </TooltipExt>
            );
          })}

          {activeUploads.map((item) => {
            const Icon = getFileIcon(item.fileName.split(".").pop() || "");
            return (
              <Pill
                key={item.id}
                tone="muted"
                className="max-w-[200px] pr-3"
              >
                <PillContent>
                  <PillIcon>
                    {item.status === "error" ? (
                      <Icon className="size-4 text-destructive" />
                    ) : (
                      <Spinner className="size-4 text-muted-foreground" />
                    )}
                  </PillIcon>
                  <PillText
                    className={cn(
                      item.status === "error"
                        ? "text-destructive"
                        : "text-muted-foreground"
                    )}
                    title={item.status === "error" ? item.error : undefined}
                  >
                    {item.fileName}
                  </PillText>
                </PillContent>
              </Pill>
            );
          })}

          {orderedArtifacts.map((artifact) => {
            const isSelected = selectedArtifactId === artifact._id;
            const pageHref = artifactPageHref(artifact._id);
            const dragProps = getResourceDragProps(
              "artifact",
              artifact._id,
              artifact.name
            );
            const body = (
              <>
                <PillIcon>
                  <FileText className="size-4 text-muted-foreground" />
                </PillIcon>
                <PillText title={artifact.name}>{artifact.name}</PillText>
                <PillMeta variant="badge" className="mt-px">
                  {artifact.contentType === "html" ? "html" : "md"}
                </PillMeta>
              </>
            );

            // Opening is a read: stays enabled on archived tasks, which get the
            // panel read-only (docs/specs/task-artifacts.md).
            const pill = (
              <Pill
                tone={isSelected ? "selected" : "default"}
                className="max-w-[220px]"
              >
                <PillContent asChild>
                  {pageHref ? (
                    // A real link to the full page, so middle click and
                    // ⌘/ctrl-click open a tab; a plain click opens the panel.
                    <ContextMenuTrigger asChild>
                      <AppLink
                        href={pageHref}
                        onClick={(event) => {
                          if (!shouldHandleInPlaceNavigation(event)) return;
                          event.preventDefault();
                          onSelectArtifact(artifact._id);
                        }}
                        className="cursor-pointer"
                        {...dragProps}
                      >
                        {body}
                      </AppLink>
                    </ContextMenuTrigger>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectArtifact(artifact._id)}
                      className="cursor-pointer"
                      {...dragProps}
                    >
                      {body}
                    </button>
                  )}
                </PillContent>
                {!disabled ? (
                  <PillAction
                    onClick={() => setDeleteArtifactTarget(artifact)}
                    aria-label="Delete artifact"
                    title="Delete artifact"
                    className="ml-2"
                  />
                ) : null}
              </Pill>
            );

            // No project route params (the playground): plain non-link pill.
            if (!pageHref) {
              return <Fragment key={artifact._id}>{pill}</Fragment>;
            }

            return (
              // Radix opens this on long-press on touch devices too.
              <ContextMenu key={artifact._id}>
                {pill}
                <ContextMenuContent className="w-48">
                  <ContextMenuItem asChild>
                    <a href={pageHref} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open in new page
                    </a>
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      void navigator.clipboard.writeText(artifact._id);
                      toast.success("Artifact ID copied to clipboard");
                    }}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy ID
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}

          {!disabled && (
            <TooltipExt content="Create document">
              <button
                type="button"
                onClick={onCreateArtifact}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Create document"
                title="Create document"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipExt>
          )}
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete attachment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteTarget?.fileName}&quot;.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  onDeleteAttachment(deleteTarget._id as Id<"taskAttachments">);
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AttachmentLightbox {...lightboxProps} />

      <AlertDialog
        open={!!deleteArtifactTarget}
        onOpenChange={() => setDeleteArtifactTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete artifact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteArtifactTarget?.name}
              &quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteArtifactTarget) return;
                void onDeleteArtifact(deleteArtifactTarget._id);
                setDeleteArtifactTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!downloadTarget}
        onOpenChange={() => setDownloadTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Preview unavailable</AlertDialogTitle>
            <AlertDialogDescription>
              File preview is not available yet. Do you want to download
              &nbsp;&quot;{downloadTarget?.fileName}&quot;?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!downloadTarget) return;
                void handleDownload(downloadTarget);
                setDownloadTarget(null);
              }}
            >
              Download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
