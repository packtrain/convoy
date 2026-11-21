"use client";

import { useRef, useState, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AddTaskRow } from "../tasks/add-task-row";
import { ROW_HEIGHT } from "@/lib/tasks/constants";
import type { BoardTaskColumn } from "./groups";

export function GroupHeader({
  group,
  collapsed,
  count,
  toggle,
  mobile = false,
  onNavigate,
}: {
  group: BoardTaskColumn;
  collapsed: boolean;
  count: number;
  toggle: () => void;
  mobile?: boolean;
  onNavigate?: (direction: "prev" | "next") => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b bg-muted/40",
        mobile ? "px-3" : "px-6",
      )}
      style={{ height: ROW_HEIGHT }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          if ((event.key === "ArrowRight") === collapsed) toggle();
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          onNavigate?.(event.key === "ArrowUp" ? "prev" : "next");
        }
      }}
    >
      <button
        type="button"
        className="flex items-center justify-center w-5 h-5 hover:bg-muted rounded shrink-0 cursor-pointer"
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.title}`}
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-150 pointer-events-none",
            !collapsed && "rotate-90",
          )}
        />
      </button>
      {group.metadata}
      <span className="truncate text-sm font-medium">{group.title}</span>
      <span className="text-xs text-muted-foreground">{count}</span>
    </div>
  );
}

export function GroupAddRow({
  group,
  create,
  mobile = false,
  onNavigate,
  onFocusPrevious,
  style,
}: {
  group: BoardTaskColumn;
  style?: CSSProperties;
  create: (value: string) => boolean;
  mobile?: boolean;
  onNavigate?: (direction: "prev" | "next") => void;
  onFocusPrevious?: () => void;
}) {
  const [value, setValue] = useState("");
  const draft = useRef("");
  const change = (next: string) => {
    draft.current = next;
    setValue(next);
  };
  const commit = () => {
    if (draft.current.trim() && create(draft.current)) change("");
  };
  return (
    <div
      aria-label={`Add task to ${group.title}`}
      className={mobile ? "text-sm" : undefined}
      style={style}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <AddTaskRow
        contentInset={mobile ? 12 : undefined}
        clientId={`group-add:${group.id}`}
        value={value}
        onChange={change}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            onNavigate?.(event.key === "ArrowUp" ? "prev" : "next");
          }
          if (event.key === "Backspace" && value === "" && onFocusPrevious) {
            event.preventDefault();
            onFocusPrevious();
          }
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            change("");
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
