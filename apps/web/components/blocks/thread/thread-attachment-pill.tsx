"use client";

import type { LucideIcon } from "lucide-react";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { Spinner } from "@/components/custom/spinner";
import {
  Pill,
  PillAction,
  PillContent,
  PillIcon,
  PillText,
} from "@/components/ui/pill";
import { cn } from "@/lib/utils";

type ThreadAttachmentPillState = "idle" | "loading" | "error";

interface ThreadAttachmentPillProps {
  fileName: string;
  icon: LucideIcon;
  state?: ThreadAttachmentPillState;
  tooltipContent?: string;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  clickLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
}

export function ThreadAttachmentPill({
  fileName,
  icon: Icon,
  state = "idle",
  tooltipContent,
  disabled = false,
  className,
  onClick,
  clickLabel,
  onRemove,
  removeLabel,
}: ThreadAttachmentPillProps) {
  const isLoading = state === "loading";
  const isError = state === "error";
  const content = (
    <>
      <PillIcon>
        {isLoading ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : (
          <Icon
            className={cn(
              "size-4",
              isError ? "text-destructive" : "text-muted-foreground"
            )}
          />
        )}
      </PillIcon>
      <PillText className={cn(isError && "text-destructive")}>
        {fileName}
      </PillText>
    </>
  );

  if (onClick && onRemove) {
    return (
      <TooltipExt content={tooltipContent ?? fileName}>
        <Pill className={cn("max-w-[240px]", className)}>
          <PillContent asChild>
            <button
              type="button"
              aria-label={clickLabel}
              className="min-w-0 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait"
              disabled={disabled || isLoading}
              onClick={onClick}
            >
              {content}
            </button>
          </PillContent>
          <PillAction
            aria-label={removeLabel ?? `Remove ${fileName}`}
            onClick={onRemove}
          />
        </Pill>
      </TooltipExt>
    );
  }

  return (
    <TooltipExt content={tooltipContent ?? fileName}>
      {onClick ? (
        <Pill
          asChild
          className={cn(
            "max-w-[240px] cursor-pointer pr-2 hover:bg-muted disabled:cursor-wait disabled:opacity-70",
            className
          )}
        >
          <button
            type="button"
            aria-label={clickLabel}
            disabled={disabled || isLoading}
            onClick={onClick}
          >
            <PillContent>{content}</PillContent>
          </button>
        </Pill>
      ) : (
        <Pill className={cn("max-w-[240px]", className)}>
          <PillContent>{content}</PillContent>
          {onRemove ? (
            <PillAction
              aria-label={removeLabel ?? `Remove ${fileName}`}
              onClick={onRemove}
            />
          ) : null}
        </Pill>
      )}
    </TooltipExt>
  );
}
