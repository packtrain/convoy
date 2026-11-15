"use client";

import { Heading1, Heading2, Heading3, Heading4, Pilcrow } from "lucide-react";

import { cn } from "@/lib/utils";

const blockTypeOptions = [
  { icon: Pilcrow, label: "Paragraph", value: "paragraph" },
  { icon: Heading1, label: "Heading 1", value: "h1" },
  { icon: Heading2, label: "Heading 2", value: "h2" },
  { icon: Heading3, label: "Heading 3", value: "h3" },
  { icon: Heading4, label: "Heading 4", value: "h4" },
] as const;

export function MdxEditorBlockTypeMenuPreview() {
  return (
    <div className="w-full max-w-[220px] rounded-[16px] border border-border bg-card p-2 shadow-[var(--shadow-soft)]">
      {blockTypeOptions.map((option) => (
        <div
          key={option.value}
          className={cn(
            "relative flex h-9 w-full items-center rounded-[12px] px-3 py-0 text-sm leading-none text-foreground",
            option.value === "h2" && "bg-muted text-foreground [&_svg]:text-primary"
          )}
        >
          <span className="inline-flex h-full items-center gap-2 leading-none">
            <option.icon className="mr-2 size-4 shrink-0" />
            <span className="inline-flex items-center leading-none">{option.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
