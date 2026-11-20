"use client";

import { useId, useRef, useState } from "react";
import { useAppUser } from "@/lib/auth/hooks";
import { CornerDownLeft, Paperclip, X } from "lucide-react";
import { AttachmentDropZone } from "@/components/blocks/attachment-drop-zone";
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

/** Someone `@` can mention; inserted as `@login`. */
export interface CommentMention {
  login: string;
  avatarUrl: string | null;
}

const MENTION_LIMIT = 8;
// Split keeps both groups: [text, boundary, @login, text, ...], so every third part is a login.
const MENTION_TOKEN = /(^|\W)(@[A-Za-z\d][A-Za-z\d-]*)/g;

/** The `@query` ending at the caret, when it starts a word, as GitHub reads mentions. */
function mentionAt(text: string, caret: number | null) {
  if (caret === null) return null;
  const match = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length - 1, query: match[2].toLowerCase() } : null;
}

interface CommentInputProps {
  onSubmit: (content: string) => Promise<void>;
  pendingAttachments?: CommentPendingAttachment[];
  /** Absent: no attach button, and pasted images are ignored. */
  onAddFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Controls the text, for a host that keeps the draft itself; otherwise the input holds it. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Offered by typing `@`; absent, `@` is plain text. */
  mentions?: CommentMention[];
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
  onRemoveAttachment = () => {},
  disabled,
  placeholder = "Add a comment...",
  value,
  onValueChange,
  mentions,
}: CommentInputProps) {
  const { user } = useAppUser();
  const [ownContent, setOwnContent] = useState("");
  const content = value ?? ownContent;
  const setContent = (next: string) => (onValueChange ? onValueChange(next) : setOwnContent(next));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [activeMention, setActiveMention] = useState(0);
  const [dismissedMention, setDismissedMention] = useState<number | null>(null);
  const mentionListId = useId();
  const mention = mentions ? mentionAt(content, caret) : null;
  const mentionOpen = mention !== null && mention.start !== dismissedMention;
  const mentionMatches = mentionOpen
    ? mentions!.filter(({ login }) => login.toLowerCase().includes(mention.query)).slice(0, MENTION_LIMIT)
    : [];
  const highlighted = mentionMatches.length ? activeMention % mentionMatches.length : 0;

  const trackCaret = (textarea: HTMLTextAreaElement) =>
    setCaret(textarea.selectionStart === textarea.selectionEnd ? textarea.selectionStart : null);

  const insertMention = (login: string) => {
    if (!mention || caret === null) return;
    // Replaces the whole token, so picking inside an existing login leaves no tail.
    const rest = content.slice(caret).replace(/^[\w-]*/, "");
    const inserted = /^\s/.test(rest) ? `@${login}` : `@${login} `;
    const next = content.slice(0, mention.start) + inserted + rest;
    const at = mention.start + inserted.length + (inserted.endsWith(" ") ? 0 : 1);
    // Written to the textarea first, so React keeps the caret where it lands.
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.value = next;
      textarea.setSelectionRange(at, at);
    }
    setContent(next);
    setCaret(at);
  };

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

  const handleSubmitKeys = useEnterToSubmitTextarea({
    onSubmit: handleSubmit,
    enabled: !disabled && !isSubmitting,
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && !e.nativeEvent.isComposing) {
      const close = { Escape: () => setDismissedMention(mention.start) };
      // With no matches only Escape is the picker's; Enter still sends.
      const moves: Record<string, () => void> = mentionMatches.length
        ? {
            ...close,
            ArrowDown: () => setActiveMention(highlighted + 1),
            ArrowUp: () => setActiveMention(highlighted + mentionMatches.length - 1),
            Enter: () => insertMention(mentionMatches[highlighted].login),
            Tab: () => insertMention(mentionMatches[highlighted].login),
          }
        : close;
      const move = e.shiftKey ? undefined : moves[e.key];
      if (move) {
        e.preventDefault();
        move();
        return;
      }
    }
    handleSubmitKeys(e);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onAddFiles?.(Array.from(files));
      // Reset the input
      e.target.value = "";
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isSubmitting || !onAddFiles) {
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
      {/* Same surface as ThreadComposer's input group so both composers match. The box alone takes drops. */}
      <AttachmentDropZone onDrop={(files) => onAddFiles?.(files)} disabled={!onAddFiles || disabled} className="rounded-lg">
        <div className="flex gap-2 rounded-lg border border-input bg-thread-composer-input p-2.5 focus-within:border-ring transition-colors">
          <Avatar className="size-8 shrink-0">
            <AvatarImage src={user?.imageUrl} />
            <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
          </Avatar>

          <div className="relative min-w-0 flex-1">
            <div className="relative">
              {/* A textarea can't style its text: it goes see-through over a copy that bolds each @login. */}
              {mentions ? (
                <div
                  ref={highlightRef}
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-0 overflow-hidden px-1 py-1.5 text-sm break-words whitespace-pre-wrap text-foreground",
                    (disabled || isSubmitting) && "opacity-50"
                  )}
                >
                  {content.split(MENTION_TOKEN).map((part, index) =>
                    index % 3 === 2 ? (
                      // A stroke, not font-weight, so the copy keeps the textarea's letter widths and caret.
                      <span key={index} data-mention className="[-webkit-text-stroke:0.4px_currentColor]">
                        {part}
                      </span>
                    ) : (
                      part
                    )
                  )}{" "}
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                data-task-comment-input="true"
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  trackCaret(e.target);
                  setActiveMention(0);
                  // Escape holds for the token it closed; a bare `@` is a new one.
                  const next = mentionAt(e.target.value, e.target.selectionStart);
                  if (!next || !next.query) setDismissedMention(null);
                }}
                onSelect={(e) => trackCaret(e.currentTarget)}
                onScroll={(e) => {
                  if (highlightRef.current) highlightRef.current.scrollTop = e.currentTarget.scrollTop;
                }}
                onBlur={() => setCaret(null)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                aria-autocomplete={mentions ? "list" : undefined}
                aria-controls={mentionMatches.length ? mentionListId : undefined}
                aria-activedescendant={mentionMatches.length ? `${mentionListId}-${highlighted}` : undefined}
                placeholder={placeholder}
                disabled={disabled || isSubmitting}
                rows={1}
                className={cn(
                  "relative w-full resize-none bg-transparent px-1 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
                  mentions && "text-transparent caret-foreground"
                )}
                style={{ minHeight: "36px", maxHeight: "120px" }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "36px";
                  target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
                }}
              />
            </div>

            {mentionOpen ? (
              <div
                id={mentionListId}
                role="listbox"
                aria-label="Mention"
                className="absolute top-10 left-0 z-50 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {mentionMatches.length ? null : (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    {mention.query ? `No matches for @${mention.query}` : "No one to mention"}
                  </div>
                )}
                {mentionMatches.map(({ login, avatarUrl }, index) => (
                  <div
                    key={login}
                    id={`${mentionListId}-${index}`}
                    role="option"
                    aria-selected={index === highlighted}
                    // Keeps focus, and the caret, in the textarea.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertMention(login)}
                    onMouseEnter={() => setActiveMention(index)}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent"
                  >
                    <Avatar aria-hidden className="size-5 shrink-0">
                      <AvatarImage src={avatarUrl ?? undefined} />
                      <AvatarFallback className="text-[10px]">{login.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{login}</span>
                  </div>
                ))}
              </div>
            ) : null}

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

              {onAddFiles ? (
                <>
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
                </>
              ) : null}

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
      </AttachmentDropZone>
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
