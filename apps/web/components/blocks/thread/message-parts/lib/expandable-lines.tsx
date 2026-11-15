"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Default cap for terminal output and raw tool payloads. */
export const TOOL_OUTPUT_LINE_LIMIT = 40;

function truncateLines(text: string, lineLimit: number) {
  const lines = text.split("\n");
  if (lines.length <= lineLimit) {
    return {
      displayText: text,
      totalLines: lines.length,
      isTruncated: false,
    };
  }

  return {
    displayText: lines.slice(0, lineLimit).join("\n"),
    totalLines: lines.length,
    isTruncated: true,
  };
}

interface ExpandableLinesProps {
  text: string;
  lineLimit: number;
  className: string;
  footer?: ReactNode;
  children: (displayText: string) => ReactNode;
}

export function ExpandableLines({
  text,
  lineLimit,
  className,
  footer,
  children,
}: ExpandableLinesProps) {
  const [expanded, setExpanded] = useState(false);
  const { displayText, totalLines, isTruncated } = useMemo(
    () => truncateLines(text, lineLimit),
    [lineLimit, text]
  );

  return (
    <div className={className}>
      {children(expanded ? text : displayText)}
      {footer}
      {isTruncated && !expanded && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(true)}
          className="w-full cursor-pointer rounded-none border-0 border-t border-border text-xs text-muted-foreground"
        >
          <ChevronDown className="mr-1.5 size-3" />
          Show all {totalLines} lines
        </Button>
      )}
    </div>
  );
}
