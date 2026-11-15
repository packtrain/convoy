"use client";

import { useEffect, useState } from "react";

import { Pin } from "lucide-react";

import type { MdxTocHeading } from "./lib/extract-mdx-headings";
import { useMdxTableOfContents } from "./lib/use-mdx-table-of-contents";
import { cn } from "@/lib/utils";

export type MdxInlineTableOfContentsProps = {
  headings: MdxTocHeading[];
  editorRootRef: React.RefObject<HTMLElement | null>;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  position?: "left" | "right";
  topOffset?: number;
  title?: string;
  updateHash?: boolean;
  onPin?: () => void;
};

const defaultTopOffset = 96;
const defaultInlineInset = 16;
const markerHeight = 2;
const maxRailHeight = 360;

function markerGap(markerCount: number) {
  if (markerCount < 2) {
    return 0;
  }

  const gap = (maxRailHeight - markerCount * markerHeight) / (markerCount - 1);

  return Math.min(10, Math.max(2, gap));
}

export function MdxInlineTableOfContents({
  headings,
  editorRootRef,
  scrollContainerRef,
  className,
  position = "left",
  topOffset = defaultTopOffset,
  title = "Table of contents",
  updateHash = true,
  onPin,
}: MdxInlineTableOfContentsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [scrollportHeight, setScrollportHeight] = useState<number | null>(null);
  const { scrollToHeading, visibleActiveHeadingId } = useMdxTableOfContents({
    headings,
    editorRootRef,
    scrollContainerRef,
    topOffset,
    updateHash,
  });

  // Only the scrollport's size is measured (never its scroll offset), so the
  // rail never has to be repositioned while scrolling.
  useEffect(() => {
    const scrollContainer = scrollContainerRef?.current;

    if (!scrollContainer) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      setScrollportHeight(entry.contentRect.height);
    });

    observer.observe(scrollContainer);

    return () => observer.disconnect();
  }, [scrollContainerRef]);

  if (headings.length === 0) {
    return null;
  }

  return (
    // Spans the editor root so a scrollport-tall sticky box can hold the rail centered through CSS
    // alone — nothing recomputes per frame, so it can't lag behind scrolling. Absolute, not fixed,
    // so overlay surfaces with transformed ancestors don't shift the rail's containing block.
    <div
      className={cn("pointer-events-none absolute inset-y-0 z-30 hidden md:block", className)}
      style={{ [position]: defaultInlineInset }}
    >
      <div
        className="sticky top-0 flex items-center"
        style={{ height: scrollportHeight ?? "100dvh" }}
      >
        <div
          className={cn(
            "pointer-events-auto relative flex max-h-[min(60vh,420px)] items-start",
            position === "left" ? "justify-start" : "justify-end"
          )}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget;

            if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
              return;
            }

            setIsOpen(false);
          }}
          onClick={() => setIsOpen(true)}
          onFocus={() => setIsOpen(true)}
          onMouseEnter={() => setIsOpen(true)}
          onMouseLeave={() => setIsOpen(false)}
        >
          <div
            aria-hidden="true"
            className={cn(
              "relative z-10 flex flex-col justify-center rounded-full px-1.5 py-2",
              position === "left" ? "items-start" : "items-end"
            )}
            // Every heading gets a marker so the rail maps the whole document;
            // the gap tightens as headings pile up to keep it from overflowing.
            style={{ gap: markerGap(headings.length) }}
          >
            {headings.map((heading) => {
              const depthOffset = Math.min(heading.depth - 1, 3) * 4;
              const width = Math.max(8, 18 - depthOffset);
              const isActive = heading.id === visibleActiveHeadingId;

              return (
                <span
                  key={`${heading.id}-${heading.line}`}
                  className={cn(
                    "h-0.5 rounded-full transition-colors",
                    isActive ? "bg-primary" : "bg-primary/25"
                  )}
                  style={{
                    width,
                  }}
                />
              );
            })}
          </div>

          <nav
            aria-label={title}
            className={cn(
              "absolute top-[-10px] z-20 w-[248px] px-2.5 transition-all duration-200",
              position === "left" ? "left-5" : "right-5",
              isOpen
                ? "pointer-events-auto translate-x-0 opacity-100"
                : cn(
                    "pointer-events-none opacity-0",
                    position === "left" ? "-translate-x-2" : "translate-x-2"
                  )
            )}
          >
            <div className="max-h-96 overflow-auto rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-[var(--shadow-elevated)]">
              {onPin && (
                <div className="mb-1 flex justify-end">
                  <button
                    type="button"
                    aria-label="Pin table of contents"
                    title="Pin table of contents"
                    className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={onPin}
                  >
                    <Pin className="size-3.5" />
                  </button>
                </div>
              )}
              <ol className="m-0 grid list-none gap-1 p-0">
                {headings.map((heading, index) => {
                  const isActive = heading.id === visibleActiveHeadingId;

                  return (
                    <li key={`${heading.id}-${heading.line}`} className="min-w-0">
                      <button
                        type="button"
                        aria-current={isActive ? "location" : undefined}
                        title={heading.title}
                        className={cn(
                          "flex min-h-8 w-full cursor-pointer items-center rounded-md px-2 py-1.5 text-left text-sm leading-5 transition-colors",
                          "text-muted-foreground hover:bg-accent hover:text-foreground",
                          isActive && "bg-accent text-foreground",
                          heading.depth === 2 && "pl-5",
                          heading.depth === 3 && "pl-8",
                          heading.depth >= 4 && "pl-11"
                        )}
                        onClick={() => scrollToHeading(index)}
                      >
                        <span className="min-w-0 truncate">{heading.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
