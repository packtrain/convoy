"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

function sanitizeLineBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

function normalizeTitle(value: string): string {
  return sanitizeLineBreaks(value).trim().replace(/\s+/g, " ");
}

export interface TaskTitleEditorProps {
  value: string;
  onCommit: (nextValue: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Selectable but not editable, and not greyed out like `disabled`. */
  readOnly?: boolean;
  /** Tooltip, e.g. why the title is read-only. */
  title?: string;
  isClosed?: boolean;
}

export function TaskTitleEditor({
  value,
  onCommit,
  placeholder = "Task name",
  className,
  disabled = false,
  readOnly = false,
  title,
  isClosed = false,
}: TaskTitleEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isCancellingRef = useRef(false);
  const [draftValue, setDraftValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  // Read-only never holds a draft: it shows the live value and commits nothing.
  const displayValue = isFocused && !readOnly ? draftValue : value;

  const handleBlur = () => {
    setIsFocused(false);

    if (readOnly) {
      setDraftValue(value);
      return;
    }

    if (isCancellingRef.current) {
      isCancellingRef.current = false;
      setDraftValue(value);
      return;
    }

    const normalizedDraft = normalizeTitle(draftValue);
    const normalizedServer = normalizeTitle(value);

    if (!normalizedDraft) {
      setDraftValue(value);
      return;
    }

    if (normalizedDraft === normalizedServer) {
      setDraftValue(value);
      return;
    }

    setDraftValue(normalizedDraft);
    onCommit(normalizedDraft);
  };

  return (
    <textarea
      ref={textareaRef}
      aria-label="Task name"
      value={displayValue}
      placeholder={placeholder}
      rows={1}
      disabled={disabled}
      readOnly={readOnly}
      title={title}
      onFocus={() => {
        setDraftValue(value);
        setIsFocused(true);
      }}
      onChange={(event) => {
        setDraftValue(sanitizeLineBreaks(event.target.value));
        if (!isFocused) {
          setIsFocused(true);
        }
      }}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          isCancellingRef.current = true;
          setDraftValue(value);
          textareaRef.current?.blur();
          return;
        }

        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
        }
      }}
      className={cn(
        // `field-sizing-content`, not a measured height: the browser re-sizes on
        // every re-wrap, so a pane resize can't leave a cropped title (OS-1874).
        "w-full field-sizing-content min-h-10 max-h-40 overflow-y-auto bg-transparent outline-none resize-none whitespace-pre-wrap break-words disabled:cursor-not-allowed disabled:opacity-50",
        isClosed ? "text-muted-foreground line-through" : "text-foreground",
        className
      )}
    />
  );
}
