"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TaskTagsEditor } from "@/components/blocks/tasks/task-detail-sidebar/task-tags-editor";
import { EmptyValue, TagBadge } from "../badges";

interface TagsCellProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  isEditable?: boolean;
}

/** Tags cell: chips in the row, the sidebar tag editor in a popover. */
export function TagsCell({ tags, onTagsChange, isEditable = true }: TagsCellProps) {
  const [open, setOpen] = useState(false);
  const content =
    tags.length > 0 ? (
      <span className="flex min-w-0 gap-1 overflow-hidden">
        {tags.map((tag) => (
          <TagBadge key={tag} tag={tag} />
        ))}
      </span>
    ) : (
      <EmptyValue />
    );
  const cellClassName = "flex h-9 w-full min-w-0 items-center overflow-hidden px-2";

  if (!isEditable) {
    return <div className={cellClassName}>{content}</div>;
  }

  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={tags.length > 0 ? `Tags: ${tags.join(", ")}` : "Add tags"}
          className={`${cellClassName} cursor-pointer focus:outline-none`}
          onClick={(event) => event.stopPropagation()}
        >
          {content}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-2"
        onClick={(event) => event.stopPropagation()}
      >
        <TaskTagsEditor tags={tags} onTagsChange={onTagsChange} />
      </PopoverContent>
    </Popover>
  );
}
