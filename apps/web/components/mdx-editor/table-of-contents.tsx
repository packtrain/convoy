"use client";

import type { MdxTocHeading } from "./lib/extract-mdx-headings";
import { useMdxTableOfContents } from "./lib/use-mdx-table-of-contents";
import { cn } from "@/lib/utils";

export type MdxTableOfContentsProps = {
  headings: MdxTocHeading[];
  editorRootRef: React.RefObject<HTMLElement | null>;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  topOffset?: number;
  title?: string;
  updateHash?: boolean;
  action?: React.ReactNode;
  headerClassName?: string;
  headerStyle?: React.CSSProperties;
  onHeadingSelect?: () => void;
};

const defaultTopOffset = 96;

export function MdxTableOfContents({
  headings,
  editorRootRef,
  scrollContainerRef,
  className,
  topOffset = defaultTopOffset,
  title = "Table of contents",
  updateHash = true,
  action,
  headerClassName,
  headerStyle,
  onHeadingSelect,
}: MdxTableOfContentsProps) {
  const { scrollToHeading, visibleActiveHeadingId } = useMdxTableOfContents({
    headings,
    editorRootRef,
    scrollContainerRef,
    topOffset,
    updateHash,
  });

  return (
    <aside
      className={cn(
        "min-w-0 rounded-[20px] border border-border bg-card shadow-[var(--shadow-soft)] lg:sticky lg:top-4",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border bg-muted px-4 py-3",
          headerClassName
        )}
        style={headerStyle}
      >
        <h2 className="m-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        {action}
      </div>

      {headings.length === 0 ? (
        <p className="m-0 px-4 py-4 text-sm leading-6 text-muted-foreground">
          Add headings in the editor to populate this outline.
        </p>
      ) : (
        <nav aria-label={title} className="p-2">
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
                    onClick={() => {
                      scrollToHeading(index);
                      onHeadingSelect?.();
                    }}
                  >
                    <span className="min-w-0 truncate">{heading.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
    </aside>
  );
}
