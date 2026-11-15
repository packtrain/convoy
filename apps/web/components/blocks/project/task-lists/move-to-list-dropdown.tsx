"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoveToListMenuContent, type MoveToListHandler } from "./move-to-list-menu-content";
import type { TaskListResultsController } from "./use-task-list-results";

interface MoveToListDropdownProps {
  projectId?: Id<"projects">;
  resultsController?: TaskListResultsController;
  selectedListRef?: string | null;
  trigger: ReactNode;
  onMoveToList: MoveToListHandler;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
}

export function MoveToListDropdown({
  projectId,
  resultsController,
  selectedListRef = null,
  trigger,
  onMoveToList,
  align = "center",
  side = "top",
  sideOffset = 8,
}: MoveToListDropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resultsController?.resetQuery();
        }
      }}
    >
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="w-auto p-0"
      >
        <MoveToListMenuContent
          projectId={projectId}
          resultsController={resultsController}
          selectedListRef={selectedListRef}
          autoFocusSearch
          onMoveToList={onMoveToList}
          onAfterSelect={() => setOpen(false)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
