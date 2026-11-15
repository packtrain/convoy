"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";
import { toast } from "sonner";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { useEnterToSubmitTextarea } from "@/hooks/ui/use-enter-to-submit-textarea";

interface ArtifactCommentComposerProps {
  placeholder: string;
  initialValue?: string;
  onSubmit: (content: string) => Promise<void> | void;
  /** Called on Escape. */
  onCancel: () => void;
}

/**
 * One-line auto-growing composer (Textarea uses `field-sizing-content`).
 * Enter sends, Shift+Enter inserts a newline, Escape cancels. The send icon
 * lives inside the input (block-end addon); there is no cancel button.
 */
export function ArtifactCommentComposer({
  placeholder,
  initialValue = "",
  onSubmit,
  onCancel,
}: ArtifactCommentComposerProps) {
  const [draft, setDraft] = useState(initialValue);
  const [isBusy, setIsBusy] = useState(false);

  const submit = async () => {
    const content = draft.trim();
    if (!content || isBusy) return;
    setIsBusy(true);
    try {
      await onSubmit(content);
      setDraft("");
    } catch {
      // Keep the draft so the user can retry.
      toast.error("Failed to save comment");
    } finally {
      setIsBusy(false);
    }
  };

  const handleEnter = useEnterToSubmitTextarea({ onSubmit: submit });

  return (
    <InputGroup>
      <InputGroupTextarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
            return;
          }
          handleEnter(e);
        }}
        placeholder={placeholder}
        autoFocus
        rows={1}
        className="min-h-0 text-sm"
      />
      <InputGroupAddon align="block-end">
        <InputGroupButton
          size="icon-xs"
          variant="default"
          className="ml-auto cursor-pointer rounded-full"
          aria-label="Send"
          disabled={isBusy || !draft.trim()}
          onClick={submit}
        >
          <ArrowUp className="size-3.5" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
