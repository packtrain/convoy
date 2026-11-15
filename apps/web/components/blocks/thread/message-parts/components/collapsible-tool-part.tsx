"use client";

import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Bug, ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useShowToolCallDebug } from "@/lib/dev-mode/use-dev-mode";
import { cn } from "@/lib/utils";
import { ToolStateIcon, type ToolPartState } from "./tool-state-icon";

interface CollapsibleToolPartProps {
  icon?: LucideIcon;
  iconNode?: ReactNode;
  iconClassName?: string;
  /** Drives the leading icon: spinner while pending, alert + tooltip on error. */
  state?: ToolPartState;
  errorText?: string;
  title: string;
  /** Rich replacement for the title span (e.g. title with an inline link). */
  titleNode?: ReactNode;
  trailing?: ReactNode;
  /** Overrides the default gap between the trigger row and the body. */
  contentClassName?: string;
  defaultOpen?: boolean;
  /** Eager children (always mounted). */
  children?: ReactNode;
  /** Lazy children — only called when expanded. Avoids expensive work on mount. */
  renderChildren?: () => ReactNode;
  /** With no children at all the row is plain text — nothing to disclose. */
  hasBody?: boolean;
  /** Copies the raw tool call JSON; shown only under the tool-call debug developer setting. */
  onDebug?: () => void;
}

/** Shown only under the tool-call debug developer setting. */
export function ToolDebugButton({ onDebug }: { onDebug: () => void }) {
  const showToolCallDebug = useShowToolCallDebug();
  if (!showToolCallDebug) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onDebug}
      className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-muted-foreground focus-visible:opacity-100 group-hover/tool:opacity-100"
      title="Copy raw tool call JSON"
      aria-label="Copy raw tool call JSON"
    >
      <Bug className="size-3" />
    </button>
  );
}

export function CollapsibleToolPart({
  icon: Icon,
  iconNode,
  iconClassName,
  state,
  errorText,
  title,
  titleNode,
  trailing,
  contentClassName,
  defaultOpen = false,
  children,
  renderChildren,
  hasBody = true,
  onDebug,
}: CollapsibleToolPartProps) {
  const [open, setOpen] = useState(defaultOpen);

  const rowContent = (
    <>
      <ToolStateIcon
        state={state}
        errorText={errorText}
        icon={Icon}
        iconNode={iconNode}
        iconClassName={iconClassName}
      />
      {titleNode ?? <span className="truncate whitespace-nowrap">{title}</span>}
      {trailing}
    </>
  );

  if (!hasBody) {
    return (
      <div className="group/tool flex w-full min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
          {rowContent}
        </div>
        {onDebug && <ToolDebugButton onDebug={onDebug} />}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/tool w-full">
      <div className="flex w-full min-w-0 items-center gap-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center justify-start gap-2 text-left text-sm text-muted-foreground hover:text-foreground"
          >
            {rowContent}
            <ChevronRight
              aria-hidden="true"
              data-slot="tool-chevron"
              className={cn(
                "size-3 shrink-0 opacity-0 transition-[opacity,transform] group-hover/tool:opacity-100 group-focus-within/tool:opacity-100",
                open && "rotate-90 opacity-100"
              )}
            />
          </button>
        </CollapsibleTrigger>
        {onDebug && <ToolDebugButton onDebug={onDebug} />}
      </div>
      <CollapsibleContent className={cn("mt-1", contentClassName)}>
        {renderChildren ? (open ? renderChildren() : null) : children}
      </CollapsibleContent>
    </Collapsible>
  );
}
