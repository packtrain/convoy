"use client";

import type { LucideIcon } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { formatFileSize } from "@/lib/tasks/files";
import { cn } from "@/lib/utils";

interface ThreadAttachmentCardProps {
  fileName: string;
  fileSize: number;
  icon: LucideIcon;
  state?: "idle" | "loading" | "error";
  onClick: () => void;
}

/** A sent file in a thread message: type icon, name, and size. Opens or downloads on click. */
export function ThreadAttachmentCard({ fileName, fileSize, icon: Icon, state = "idle", onClick }: ThreadAttachmentCardProps) {
  const isError = state === "error";
  return (
    <button
      type="button"
      data-attachment-name={fileName}
      title={fileName}
      disabled={state === "loading"}
      onClick={onClick}
      className="flex max-w-full cursor-pointer items-center gap-2.5 rounded-lg bg-muted py-1.5 ps-1.5 pe-2.5 text-left transition-colors hover:bg-muted/70 disabled:cursor-wait"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background">
        {state === "loading" ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : (
          <Icon className={cn("size-4", isError ? "text-destructive" : "text-muted-foreground")} strokeWidth={1.5} />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn("max-w-36 truncate text-xs font-medium", isError && "text-destructive")}>{fileName}</span>
        <span className="text-xs text-muted-foreground">{isError ? "Unavailable" : formatFileSize(fileSize)}</span>
      </span>
    </button>
  );
}
