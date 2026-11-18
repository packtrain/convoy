"use client";

import { useEffect, useRef, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { ComposerSlashCommandItem, SlashCommandCatalogItem } from "@/lib/slash-commands/composer";

const OPEN_DELAY_MS = 1000;
// Lets the pointer cross the gap between the menu and the card.
const CLOSE_DELAY_MS = 150;

type HoveredPrompt = { item: SlashCommandCatalogItem; anchor: HTMLElement };

/**
 * Hover state for the `/` menu's prompt preview; `items` is the open menu's
 * rows, or null when it is closed (docs/specs/slash-commands.md#composer-behavior).
 */
export function useSlashCommandPreview(items: readonly ComposerSlashCommandItem[] | null) {
  const [hovered, setHovered] = useState<HoveredPrompt | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Read the listed row, so a closed menu or a filtered-out row drops the card.
  const listed = hovered && items?.find((item) => item.canonicalKey === hovered.item.canonicalKey);
  if (hovered && !listed) setHovered(null);
  const preview = listed && listed.scope !== "runtime" && listed.scope !== "skill" ? { item: listed, anchor: hovered.anchor } : null;

  const hover = (item: ComposerSlashCommandItem, anchor: HTMLElement) => {
    window.clearTimeout(timer.current);
    if (item.scope === "runtime" || item.scope === "skill") return setHovered(null);
    const next = { item, anchor };
    // Only the first open waits; an open card follows the pointer at once.
    if (preview) setHovered(next);
    else timer.current = window.setTimeout(() => setHovered(next), OPEN_DELAY_MS);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHovered(null), CLOSE_DELAY_MS);
  };
  const stay = () => window.clearTimeout(timer.current);
  const close = () => {
    window.clearTimeout(timer.current);
    setHovered(null);
  };
  return { preview, hover, leave, stay, close };
}

export function SlashCommandPreview({
  preview,
  onPointerEnter,
  onPointerLeave,
  onClose,
}: {
  preview: HoveredPrompt | null;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onClose: () => void;
}) {
  if (!preview) return null;
  const { item, anchor } = preview;
  return (
    <Popover open modal={false} onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={{ current: anchor }} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        aria-label={`Preview of ${item.displayLabel}`}
        className="pointer-events-auto z-[110] w-80 gap-2 p-3"
        // The composer keeps focus, or the editor's blur would close the menu.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate font-semibold text-foreground">{item.displayLabel}</p>
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              {item.scope === "project" ? "Project" : "Organization"}
            </span>
          </div>
          {item.description ? <p className="mt-1 text-xs text-muted-foreground">{item.description}</p> : null}
        </div>
        <div className="-mx-3 max-h-80 overflow-y-auto border-t border-border px-3 pt-2">
          <MessageResponse className="text-sm">{item.content}</MessageResponse>
        </div>
      </PopoverContent>
    </Popover>
  );
}
