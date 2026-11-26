"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { showConvexErrorToast } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { THREAD_TITLE_MAX_LENGTH } from "@/lib/threads/constants";
import {
  SlashCommandDisplayText,
  slashCommandDisplayText,
} from "@/lib/slash-commands/display";
import { PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THREAD_LIST_TOGGLE_HOTKEY } from "@/lib/browser/hotkeys";
import { useThreadListCollapse } from "./thread-list-collapse-context";

interface ThreadHeaderProps {
  title: string;
  leading?: ReactNode;
  /**
   * Workspace tabs (full-width layout). When set they take the title's place
   * on the left — the thread itself is one of the tabs.
   */
  tabs?: ReactNode;
  /**
   * The tabs render as the header's title rather than as a tab row (the
   * collapsed mobile strip, OS-1479): no underline to drop onto the divider,
   * and no inset to cancel — the tab's own padding becomes the gap after the
   * back button.
   */
  tabsAsTitle?: boolean;
  /** Rendered after the title block (split-view add-to-group "+", OS-1477). */
  titleTrailing?: ReactNode;
  actions?: ReactNode;
  onTitleCommit?: (nextTitle: string) => Promise<void> | void;
  maxTitleLength?: number;
}

/** Reopens the collapsed thread list; renders nothing while it is open. */
function ThreadListReopenButton() {
  const threadList = useThreadListCollapse();
  if (!threadList?.collapsed) return null;
  const label = threadList.hasAttention ? "Show thread list (unread threads)" : "Show thread list";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={threadList.toggle}
      aria-label={label}
      title={`${label} (${THREAD_LIST_TOGGLE_HOTKEY})`}
      className="relative cursor-pointer max-md:hidden"
    >
      <PanelLeftOpen />
      {threadList.hasAttention ? (
        <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-info" />
      ) : null}
    </Button>
  );
}

export function ThreadHeader({
  title,
  leading: leadingProp,
  tabs,
  tabsAsTitle = false,
  titleTrailing,
  actions,
  onTitleCommit,
  maxTitleLength = THREAD_TITLE_MAX_LENGTH,
}: ThreadHeaderProps) {
  const isEditable = typeof onTitleCommit === "function";
  const showsReopenButton = useThreadListCollapse()?.collapsed === true;
  const leading = (
    <>
      <ThreadListReopenButton />
      {leadingProp}
    </>
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const previousExternalTitleRef = useRef(title);
  const initialEditTitleRef = useRef(title);
  const skipBlurCommitRef = useRef(false);
  const isSavingRef = useRef(false);
  const [isEditing, setIsEditing] = useState(false);
  const [pendingCommittedTitle, setPendingCommittedTitle] = useState<
    string | null
  >(null);
  const [draftTitle, setDraftTitle] = useState(() =>
    slashCommandDisplayText(title)
  );
  const displayTitle = pendingCommittedTitle ?? title;
  const plainDisplayTitle = slashCommandDisplayText(displayTitle);
  const plainTitle = slashCommandDisplayText(title);

  useEffect(() => {
    if (!isEditing) {
      setDraftTitle(plainDisplayTitle);
    }
  }, [isEditing, plainDisplayTitle]);

  useEffect(() => {
    if (title === previousExternalTitleRef.current) {
      return;
    }

    previousExternalTitleRef.current = title;
    setPendingCommittedTitle(null);
  }, [title]);

  const cancelEditing = useCallback(() => {
    setDraftTitle(initialEditTitleRef.current);
    setIsEditing(false);
  }, []);

  const commitTitle = useCallback(async () => {
    if (!isEditable || !onTitleCommit || isSavingRef.current) {
      return;
    }

    const trimmedTitle = draftTitle.trim();
    const trimmedInitialTitle = initialEditTitleRef.current.trim();
    if (trimmedTitle.length < 1 || trimmedTitle === trimmedInitialTitle) {
      setDraftTitle(initialEditTitleRef.current);
      setIsEditing(false);
      return;
    }

    isSavingRef.current = true;
    try {
      await onTitleCommit(trimmedTitle);
      setPendingCommittedTitle(trimmedTitle);
      setDraftTitle(trimmedTitle);
      setIsEditing(false);
    } catch (error) {
      showConvexErrorToast(error, "Failed to update thread title");
      setDraftTitle(initialEditTitleRef.current);
      setIsEditing(false);
    } finally {
      isSavingRef.current = false;
    }
  }, [draftTitle, isEditable, onTitleCommit]);

  const handleFocus = useCallback(() => {
    initialEditTitleRef.current = plainDisplayTitle;
    setIsEditing(true);
  }, [plainDisplayTitle]);

  const handleBlur = useCallback(() => {
    // Show the title's start again, not wherever the caret left it.
    if (inputRef.current) {
      inputRef.current.scrollLeft = 0;
    }
    if (!isEditing) {
      return;
    }

    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }

    void commitTitle();
  }, [commitTitle, isEditing]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        skipBlurCommitRef.current = true;
        void commitTitle();
        inputRef.current?.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        skipBlurCommitRef.current = true;
        cancelEditing();
        inputRef.current?.blur();
      }
    },
    [cancelEditing, commitTitle]
  );

  const titleInputClasses = cn(
    "absolute inset-0 block h-5 w-full cursor-text border-0 bg-transparent p-0 align-middle",
    "truncate text-sm font-medium leading-5 text-foreground",
    "focus-visible:outline-none focus-visible:ring-0"
  );

  // No percentage widths here: the wrappers are content-sized (so the title
  // hugs its text), and a max-w-full inside an intrinsically sized flex chain
  // resolves cyclically to 0. min-w-0 + truncate handles the tight case.
  const titleDisplayClasses =
    "block h-5 min-w-0 truncate text-left text-sm font-medium leading-5 text-foreground";

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between overflow-hidden border-b border-border px-4">
        {tabs ? (
          <>
            <div className="flex shrink-0 items-center gap-2 empty:hidden">{leading}</div>
            {/* -mb-px drops the active tab's underline onto the header's own
                divider instead of leaving it floating a pixel above; -ml-3
                cancels the first tab's padding so its content starts where
                the title would. Neither applies to a title-mode strip. Beside
                the reopen button, ml-4 repeats the header's edge inset. */}
            <div
              className={cn(
                "flex min-w-0 flex-1 items-stretch self-stretch",
                !tabsAsTitle && "-mb-px",
                !tabsAsTitle && (showsReopenButton ? "ml-4" : "-ml-3")
              )}
            >
              {tabs}
            </div>
          </>
        ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 empty:hidden">{leading}</div>
          {isEditable ? (
            // Keep the whole title block content-sized so `titleTrailing`
            // stays beside it. Always an input, so a click places the caret
            // natively (docs/specs/thread-header-title-input.md).
            <div className="flex min-w-0 -mt-px items-center gap-2">
              <div
                className="relative flex min-w-0 items-center"
                role="heading"
                aria-level={1}
                aria-label={plainDisplayTitle}
                title={plainDisplayTitle}
              >
                {/* This invisible copy sizes the block to the title. The input
                    overlays that footprint instead of expanding toward the
                    actions. */}
                <span
                  aria-hidden="true"
                  className={cn(titleDisplayClasses, "invisible")}
                >
                  {plainDisplayTitle}
                </span>
                <input
                  ref={inputRef}
                  aria-label="Thread title"
                  className={titleInputClasses}
                  maxLength={maxTitleLength}
                  onBlur={handleBlur}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onFocus={handleFocus}
                  onKeyDown={handleKeyDown}
                  type="text"
                  value={draftTitle}
                />
              </div>
            </div>
          ) : (
            <h1
              className="truncate pr-4 text-sm font-medium leading-5 text-foreground"
              title={plainTitle}
            >
              <SlashCommandDisplayText text={title} highlightCommands={false} />
            </h1>
          )}
          {titleTrailing ? (
            <div className="flex shrink-0 items-center">{titleTrailing}</div>
          ) : null}
        </div>
        )}
        {actions ? (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        ) : null}
      </header>
    </>
  );
}
