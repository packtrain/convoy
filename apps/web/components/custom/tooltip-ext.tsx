"use client";

import { useLayoutEffect, useRef } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/** A trigger with no text, aria-label or aria-labelledby takes the tooltip as its name. */
function needsTooltipName(trigger: HTMLElement): boolean {
  if (trigger.hasAttribute("aria-label") || trigger.hasAttribute("aria-labelledby")) return false;
  if (trigger.getAttribute("aria-hidden") === "true") return false;
  return !trigger.textContent?.trim();
}

export function TooltipExt({ children, content, delayDuration }: { children: React.ReactNode, content: string, delayDuration?: number }) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Checked on the rendered DOM because asChild children are often components.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger || !needsTooltipName(trigger)) return;
    trigger.setAttribute("aria-label", content);
    return () => {
      if (trigger.getAttribute("aria-label") === content) trigger.removeAttribute("aria-label");
    };
  });

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipTrigger ref={triggerRef} asChild>{children}</TooltipTrigger>
      <TooltipContent className="whitespace-pre-line">{content}</TooltipContent>
    </Tooltip>
  );
}
