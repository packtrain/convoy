"use client";

import { useRef, useState } from "react";
import { useAppUser } from "@/lib/auth/hooks";
import { CornerDownLeft, Paperclip, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { InputGroupButton } from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/custom/spinner";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import {
  Pill,
  PillAction,
  PillContent,
  PillIcon,
  PillText,
} from "@/components/ui/pill";
import { getFileIcon, formatFileSize } from "@/lib/tasks/files";
import { getClipboardImageFiles } from "@/lib/browser/clipboard";
import { useEnterToSubmitTextarea } from "@/hooks/ui/use-enter-to-submit-textarea";
import { cn } from "@/lib/utils";

const EMPTY_ATTACHMENTS: CommentPendingAttachment[] = [];

/** Pills shown inline in the footer; the rest go behind the "N more" dropdown. */
const INLINE_ATTACHMENT_COUNT = 2;

export interface CommentPendingAttachment {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: "uploading" | "uploaded" | "error";
  error?: string;
}

interface CommentInputProps {
  onSubmit: (content: string) => Promise<void>;
  pendingAttachments: CommentPendingAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Plain helper (not a component) so the icon lookup stays out of a render body. */
function renderAttachmentIcon(attachment: CommentPendingAttachment, size: string) {
  if (attachment.status === "uploading") {
    return <Spinner className={cn(size, "shrink-0 text-muted-foreground")} />;
  }

  const Icon = getFileIcon(attachment.contentType);
  return (
    <Icon
      className={cn(
        size,
        "shrink-0",
        attachment.status === "error" ? "text-destructive" : "text-muted-foreground"
      )}
      strokeWidth={1.5}
    />
  );
}

function AttachmentPill({
  attachment,
  onRemove,
}: {
  attachment: CommentPendingAttachment;
  onRemove: (id: string) => void;
}) {
  return (
    <TooltipExt
      content={`${attachment.fileName} (${formatFileSize(attachment.fileSize)})`}
    >
      <Pill size="compact" className="min-w-0 max-w-[140px] shrink">
        <PillContent className="gap-1">
          <PillIcon>{renderAttachmentIcon(attachment, "size-3")}</PillIcon>
          <PillText
            className={cn(attachment.status === "error" && "text-destructive")}
          >
            {attachment.fileName}
          </PillText>
        </PillContent>
        <PillAction
          onClick={() => onRemove(attachment.id)}
          aria-label={`Remove ${attachment.fileName}`}
        />
      </Pill>
    </TooltipExt>
  );
}

export function CommentInput({
  onSubmit,
  pendingAttachments = EMPTY_ATTACHMENTS,
  onAddFiles,
  onRemoveAttachment,
  disabled,
  placeholder = "Add a comment...",
}: CommentInputProps) {
  const { user } = useAppUser();
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const visibleAttachments = pendingAttachments.slice(0, INLINE_ATTACHMENT_COUNT);
  const overflowAttachments = pendingAttachments.slice(INLINE_ATTACHMENT_COUNT);

  const hasContent = content.trim().length > 0 || pendingAttachments.length > 0;
  const hasBlockingPendingAttachments = pendingAttachments.some(
    (attachment) => attachment.status === "uploading" || attachment.status === "error"
  );

  const handleSubmit = async () => {
    if (!hasContent || hasBlockingPendingAttachments || isSubmitting || disabled) return;

    setIsSubmitting(true);
    try {
      await onSubmit(content.trim());
      setContent("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = useEnterToSubmitTextarea({
    onSubmit: handleSubmit,
    enabled: !disabled && !isSubmitting,
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onAddFiles(Array.from(files));
      // Reset the input
      e.target.value = "";
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isSubmitting) {
      return;
    }

    const imageFiles = getClipboardImageFiles(e.clipboardData);
    if (imageFiles.length === 0) {
      return;
    }

    // Preserve normal text paste behavior when clipboard has both text and images.
    const pastedText = e.clipboardData.getData("text/plain");
    if (!pastedText) {
      e.preventDefault();
    }

    onAddFiles(imageFiles);
  };

  // Get user initials
  const userInitials = user?.firstName
    ? `${user.firstName.charAt(0)}${user.lastName?.charAt(0) ?? ""}`.toUpperCase()
    : "ME";

  return (
    <div>
      {/* Same surface as ThreadComposer's input group so both composers match. */}
      <div className="flex gap-2 rounded-lg border border-input bg-thread-composer-input p-2.5 focus-within:border-ring transition-colors">
        <Avatar className="size-8 shrink-0">
          <AvatarImage src={user?.imageUrl} />
          <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            data-task-comment-input="true"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled || isSubmitting}
            rows={1}
            className="w-full resize-none bg-transparent px-1 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            style={{ minHeight: "36px", maxHeight: "120px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "36px";
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />

          {/* Actions bar */}
          <div className="flex items-center gap-1">
            {/* Attachments stay on one line; the rest collapse into a dropdown. */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              {visibleAttachments.map((attachment) => (
                <AttachmentPill
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={onRemoveAttachment}
                />
              ))}

              {overflowAttachments.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 cursor-pointer px-1.5 text-xs text-muted-foreground"
                    >
                      {overflowAttachments.length} more
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    {overflowAttachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          className="group flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          {renderAttachmentIcon(attachment, "size-3.5")}
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              attachment.status === "error" && "text-destructive"
                            )}
                          >
                            {attachment.fileName}
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${attachment.fileName}`}
                            onClick={() => onRemoveAttachment(attachment.id)}
                            className="shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <TooltipExt content="Attach file">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Attach file"
                className="shrink-0 opacity-50 hover:opacity-100"
                disabled={disabled || isSubmitting}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip />
              </Button>
            </TooltipExt>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />

            {/* Send button — same control as ThreadComposer's PromptInputSubmit. */}
            <InputGroupButton
              type="button"
              variant="default"
              size="icon-sm"
              aria-label="Send comment"
              disabled={
                !hasContent || hasBlockingPendingAttachments || isSubmitting || disabled
              }
              onClick={handleSubmit}
              className="shrink-0 cursor-pointer"
            >
              {isSubmitting ? <Spinner /> : <CornerDownLeft className="size-4" />}
            </InputGroupButton>
          </div>
        </div>
      </div>
      {/*
        `pl-[7px]` lines the hint up with the composer's own text rather than
        its border: the input group pads 2.5 (10px) and the textarea another
        `px-1` (4px) past the 1px border, so the placeholder starts ~15px in
        while the avatar column shifts the visual left edge. 7px is the offset
        that reads as aligned under the field without indenting it further.
      */}
      <p className="mt-1 pl-[7px] text-xs text-muted-foreground">
        Press Enter to send. Shift+Enter for a new line.
      </p>
    </div>
  );
}
