"use client";

import { GitPullRequest, Paperclip, SquareCheckBig } from "lucide-react";
import {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { DropdownMenuShortcut } from "@/components/ui/dropdown-menu";
import {
  THREAD_ATTACH_FILES_SHORTCUT,
  formatHotkeyForPlatformLabel,
} from "@/lib/browser/hotkeys";

interface ThreadAttachmentMenuProps {
  disabled?: boolean;
  attachTaskDisabled?: boolean;
  onAttachTask: () => void;
  /** Shown only when set: the GitHub integration is on and the composer has a project. */
  onAttachPullRequest?: () => void;
}

export function ThreadAttachmentMenu({
  disabled = false,
  attachTaskDisabled = false,
  onAttachTask,
  onAttachPullRequest,
}: ThreadAttachmentMenuProps) {
  const { openFileDialog } = usePromptInputAttachments();

  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger
        aria-label="Open attach menu"
        className="size-7"
        disabled={disabled}
        title="Attach"
      />
      <PromptInputActionMenuContent className="w-48">
        <PromptInputActionMenuItem onSelect={() => openFileDialog()}>
          <Paperclip className="size-4" />
          <span className="min-w-0 flex-1 truncate pr-0 transition-[padding-right] group-hover/dropdown-menu-item:pr-12 group-focus/dropdown-menu-item:pr-12">
            Attach files or photos
          </span>
          <DropdownMenuShortcut className="pointer-events-none absolute right-1.5 opacity-0 transition-opacity group-hover/dropdown-menu-item:opacity-100 group-focus/dropdown-menu-item:opacity-100">
            {formatHotkeyForPlatformLabel(THREAD_ATTACH_FILES_SHORTCUT)}
          </DropdownMenuShortcut>
        </PromptInputActionMenuItem>
        <PromptInputActionMenuItem
          onSelect={onAttachTask}
          disabled={attachTaskDisabled}
        >
          <SquareCheckBig className="size-4" />
          <span className="min-w-0 flex-1 truncate">
            Attach task
          </span>
        </PromptInputActionMenuItem>
        {onAttachPullRequest ? (
          <PromptInputActionMenuItem onSelect={onAttachPullRequest}>
            <GitPullRequest className="size-4" />
            <span className="min-w-0 flex-1 truncate">Attach pull request</span>
          </PromptInputActionMenuItem>
        ) : null}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}
