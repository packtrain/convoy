"use client";

import type { ReactNode } from "react";
import type { DynamicToolUIPart } from "ai";
import { CircleAlert, type LucideIcon } from "lucide-react";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { cn } from "@/lib/utils";
import { ToolLoadingIndicator } from "./tool-loading-indicator";

export type ToolPartState = DynamicToolUIPart["state"];

interface ToolStateIconProps {
  /** Omitted for parts that are not tool calls (notices, groups). */
  state?: ToolPartState;
  errorText?: string;
  icon?: LucideIcon;
  /** Rich replacement for the resting icon. */
  iconNode?: ReactNode;
  iconClassName?: string;
}

/**
 * A tool row's leading icon carries the call state (OS-1769): a spinner while
 * in progress, a red alert whose tooltip is the error message on failure, and
 * the tool's own icon once output is available.
 */
export function ToolStateIcon({
  state,
  errorText,
  icon: Icon,
  iconNode,
  iconClassName,
}: ToolStateIconProps) {
  if (state === "output-error") {
    return (
      <TooltipExt content={errorText ?? "Tool call failed"}>
        {/* A span, not the icon: the tooltip trigger must accept a ref, and the
            row is often a button already. */}
        <span
          className="flex shrink-0 items-center"
          aria-label={errorText ?? "Tool call failed"}
        >
          <CircleAlert className="size-3.5 text-destructive" />
        </span>
      </TooltipExt>
    );
  }

  if (state && state !== "output-available") {
    return <ToolLoadingIndicator label="" loaderClassName="size-3.5 shrink-0" />;
  }

  return (
    iconNode ??
    (Icon ? <Icon className={cn("size-3.5 shrink-0", iconClassName)} /> : null)
  );
}
