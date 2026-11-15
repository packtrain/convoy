"use client";

import { X } from "lucide-react";
import { fileIconSrc } from "@/lib/file-icons";
import { cn } from "@/lib/utils";
import { splitPath } from "./patch-file-sections";

interface FileTabStripProps {
  /** `null` is the Changes tab; a path is an open file tab. */
  activeTab: string | null;
  openPaths: readonly string[];
  changesLabel?: string;
  onSelect: (tab: string | null) => void;
  onClose: (path: string) => void;
}

/**
 * Changes + closable file tabs above a diff viewer (OS-1143, OS-2041). Renders
 * nothing without file tabs: the hosting tab already names the Changes view.
 */
export function FileTabStrip({ activeTab, openPaths, changesLabel = "Changes", onSelect, onClose }: FileTabStripProps) {
  if (openPaths.length === 0) {
    return null;
  }
  const tabClass = (active: boolean) =>
    cn(
      "flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2.5 text-xs",
      active ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
    );
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <button type="button" className={tabClass(activeTab === null)} onClick={() => onSelect(null)}>
          {changesLabel}
        </button>
        {openPaths.map((path) => (
          <span key={path} className={tabClass(activeTab === path)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileIconSrc(path)} alt="" className="size-3.5 shrink-0" />
            <button type="button" className="min-w-0 cursor-pointer truncate font-mono" title={path} onClick={() => onSelect(path)}>
              {splitPath(path).base}
            </button>
            <button
              type="button"
              aria-label={`Close ${path}`}
              className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => onClose(path)}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
