"use client";

import { BookOpen } from "lucide-react";
import { Marker, MarkerContent } from "@/components/ui/marker";
import type { MemoryRecallPart as MemoryRecallPartModel } from "@/lib/cli-stream-ui";
import { cn } from "@/lib/utils";
import { CollapsibleToolPart } from "./components/collapsible-tool-part";
import { ToolSurface } from "./components/tool-surface";

interface MemoryRecallPartProps {
  part: MemoryRecallPartModel;
}

/** Last path segment — the whole path is noise in a one-line summary. */
function memoryFileName(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

function buildSummary(part: MemoryRecallPartModel): string {
  if (part.mode === "synthesis") {
    return "Recalled from memory";
  }

  const count = part.memories.length;
  return `Recalled ${count} ${count === 1 ? "memory" : "memories"}`;
}

/**
 * A memory recall changes *how* the answer was produced, so it reads as a
 * timeline separator (the same treatment as context compaction) rather than a
 * tool card, with the memories themselves behind a disclosure.
 */
export function MemoryRecallPart({ part }: MemoryRecallPartProps) {
  const summary = buildSummary(part);

  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <Marker variant="separator" className="my-1 text-xs">
        <MarkerContent>{summary}</MarkerContent>
      </Marker>
      <CollapsibleToolPart
        icon={BookOpen}
        title={
          part.mode === "synthesis"
            ? "Memory synthesis"
            : part.memories
                .map((memory) =>
                  memory.path ? memoryFileName(memory.path) : "memory"
                )
                .join(", ")
        }
        renderChildren={() => (
          <ToolSurface className="flex flex-col gap-2">
            {part.memories.map((memory, index) => (
              <div key={index} className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  {memory.scope && (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                        memory.scope === "team"
                          ? "bg-info-soft text-info"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {memory.scope}
                    </span>
                  )}
                  {memory.path && (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {memory.path}
                    </span>
                  )}
                </div>
                {memory.content && (
                  <p className="text-xs leading-5 whitespace-pre-wrap text-foreground">
                    {memory.content}
                  </p>
                )}
              </div>
            ))}
          </ToolSurface>
        )}
      />
    </div>
  );
}
