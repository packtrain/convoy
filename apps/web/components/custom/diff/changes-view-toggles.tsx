"use client";

import { ChevronsDownUp, ChevronsUpDown, Columns2, PanelLeft, PanelRight, Rows2, WrapText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFileTreeSide } from "@/lib/threads/changes-view-prefs";
import { cn } from "@/lib/utils";

function ToolbarIconButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  /** Highlights on/off toggles (buttons whose icon doesn't flip). */
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "cursor-pointer",
        active ? "bg-muted text-foreground" : "text-muted-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export interface ChangesViewTogglesProps {
  /** True when every file section is collapsed via the toolbar toggle. */
  allCollapsed: boolean;
  onToggleCollapseAll: () => void;
  diffStyle: "unified" | "split";
  onToggleDiffStyle: () => void;
  wordWrap: boolean;
  onToggleWordWrap: () => void;
  /** Omit to leave out the file tree toggle (e.g. on mobile). */
  fileTreeOpen?: boolean;
  onToggleFileTree?: () => void;
}

/**
 * Collapse-all, split/unified and word-wrap toggles of a changes view. Shared
 * by the thread Changes tab and the worktree changes view (OS-2036).
 */
export function ChangesViewToggles({
  allCollapsed,
  onToggleCollapseAll,
  diffStyle,
  onToggleDiffStyle,
  wordWrap,
  onToggleWordWrap,
  fileTreeOpen = false,
  onToggleFileTree,
}: ChangesViewTogglesProps) {
  const FileTreeIcon = useFileTreeSide() === "left" ? PanelLeft : PanelRight;
  return (
    <>
      <ToolbarIconButton
        label={allCollapsed ? "Expand all files" : "Collapse all files"}
        onClick={onToggleCollapseAll}
      >
        {allCollapsed ? (
          <ChevronsUpDown />
        ) : (
          <ChevronsDownUp />
        )}
      </ToolbarIconButton>
      <ToolbarIconButton
        label={diffStyle === "unified" ? "Split diff" : "Unified diff"}
        onClick={onToggleDiffStyle}
      >
        {diffStyle === "unified" ? (
          <Columns2 />
        ) : (
          <Rows2 />
        )}
      </ToolbarIconButton>
      <ToolbarIconButton
        label={wordWrap ? "Disable word wrap" : "Enable word wrap"}
        active={wordWrap}
        onClick={onToggleWordWrap}
      >
        <WrapText />
      </ToolbarIconButton>
      {onToggleFileTree && (
        <ToolbarIconButton
          label={fileTreeOpen ? "Hide file tree" : "Show file tree"}
          active={fileTreeOpen}
          onClick={onToggleFileTree}
        >
          <FileTreeIcon />
        </ToolbarIconButton>
      )}
    </>
  );
}
