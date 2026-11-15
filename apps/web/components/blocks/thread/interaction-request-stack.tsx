"use client";

import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type StackItem = {
  id: string;
  label: string;
  render: (inactive: boolean) => ReactNode;
};

function RequestStackCard({
  item, depth, expanded, reducedMotion, onSelect, onPreviewFocus, onPreviewBlur, registerBody,
}: {
  item: StackItem;
  depth: number;
  expanded: boolean;
  reducedMotion: boolean;
  onSelect: () => void;
  onPreviewFocus: () => void;
  onPreviewBlur: () => void;
  registerBody: (node: HTMLDivElement | null) => void;
}) {
  const present = useIsPresent();
  const active = depth === 0 && present;
  const visible = depth < 4;
  return (
    <motion.div
      hidden={!visible}
      aria-hidden={!present || !visible}
      inert={!present || !visible}
      className={cn("min-w-0 origin-top rounded-lg bg-card shadow-sm", active ? "relative" : "absolute inset-0")}
      style={{ zIndex: 10 - depth, gridArea: "1 / 1" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, y: -Math.min(depth, 4) * (expanded ? 44 : 12), scale: 1 - Math.min(depth, 4) * (expanded ? 0.012 : 0.025) }}
      exit={{ opacity: 0, x: reducedMotion ? 0 : 28, y: reducedMotion ? 0 : -16 }}
      transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 29, mass: 0.85 }}
    >
      {depth > 0 ? (
        <div className="absolute inset-0 overflow-hidden rounded-lg border border-border bg-card">
          <button type="button" aria-label={`Open request: ${item.label}`} title={item.label}
            disabled={!present} onClick={onSelect} onFocus={onPreviewFocus} onBlur={onPreviewBlur}
            className="flex h-11 w-full cursor-pointer items-center gap-2 bg-muted/40 px-3 text-left text-xs font-medium hover:bg-muted/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span aria-hidden="true" className="shrink-0 font-normal text-muted-foreground">Open</span>
          </button>
        </div>
      ) : null}
      <div ref={registerBody} role="group" aria-label={`Pending request: ${item.label}`}
        data-request-body hidden={!active} inert={!active} tabIndex={-1} className="outline-none">
        {item.render(!active)}
      </div>
    </motion.div>
  );
}

/** Keeps request forms mounted while only the selected one can accept input. */
export function InteractionRequestStack({ items, noun, className }: {
  items: StackItem[];
  noun: "questions" | "requests";
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focusedPreviewId, setFocusedPreviewId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const bodies = useRef(new Map<string, HTMLDivElement>());
  const pickerSelection = useRef<string | null>(null);
  const reducedMotion = useReducedMotion() === true;
  const activeId = items.find(item => item.id === selectedId)?.id ?? items[0]?.id;
  const ordered = [activeId, ...items.filter(item => item.id !== activeId).map(item => item.id)];
  const expanded = hovered || items.some(item => item.id === focusedPreviewId && item.id !== activeId);

  function select(id: string) {
    setSelectedId(id);
    setHovered(false);
    setFocusedPreviewId(null);
    if (pickerOpen) {
      pickerSelection.current = id;
      setPickerOpen(false);
    } else {
      requestAnimationFrame(() => bodies.current.get(id)?.focus({ preventScroll: true }));
    }
  }

  return (
    <section aria-label="Pending requests" className={cn("relative min-w-0", className)}>
      <div data-testid="request-deck" data-expanded={expanded} className="relative isolate"
        style={{ paddingTop: Math.min(3, Math.max(0, items.length - 1)) * 12 }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div className="relative grid min-w-0">
          <AnimatePresence initial={false}>
            {items.map(item => (
              <RequestStackCard key={item.id} item={item} depth={ordered.indexOf(item.id)}
                expanded={expanded} reducedMotion={reducedMotion} onSelect={() => select(item.id)}
                onPreviewFocus={() => setFocusedPreviewId(item.id)} onPreviewBlur={() => setFocusedPreviewId(null)}
                registerBody={node => { if (node) bodies.current.set(item.id, node); else bodies.current.delete(item.id); }} />
            ))}
          </AnimatePresence>
        </div>
      </div>
      {items.length > 1 ? (
        <div className="mt-1 flex justify-start">
          <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="cursor-pointer text-xs text-muted-foreground">
                {items.length} pending {noun}<ChevronDown aria-hidden="true" className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-h-[min(16rem,var(--radix-dropdown-menu-content-available-height))]"
              onCloseAutoFocus={event => {
                if (pickerSelection.current) {
                  event.preventDefault();
                  bodies.current.get(pickerSelection.current)?.focus({ preventScroll: true });
                  pickerSelection.current = null;
                }
              }}>
              <DropdownMenuRadioGroup value={activeId} onValueChange={select}>
                {items.map(item => (
                  <DropdownMenuRadioItem key={item.id} value={item.id} title={item.label}>
                    <span className="min-w-0 truncate">{item.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </section>
  );
}
