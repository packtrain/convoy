"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CliRunDiffFile } from "@/convex/lib/contracts/validators";
import type { ChangesDiffStyle } from "@/lib/threads/changes-view-prefs";
import { useDiffTheme } from "@/lib/threads/hooks/use-diff-theme";
import { cn } from "@/lib/utils";

// Per-file diff presentation shared by the thread Changes tab and the worktree
// changes view (OS-2040, docs/specs/cli-thread-run-diffs.md → UI).

/** Base `PatchDiff` options every diff surface shares: theme, style, wrap, no library header. */
export function usePatchDiffOptions(diffStyle: ChangesDiffStyle, wrapLines: boolean) {
  const diffTheme = useDiffTheme();
  return useMemo(
    () => ({ ...diffTheme, diffStyle, disableFileHeader: true, overflow: (wrapLines ? "wrap" : "scroll") as "wrap" | "scroll" }),
    [diffTheme, diffStyle, wrapLines]
  );
}

export function splitPath(path: string): { dir: string; base: string } {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dir: "", base: path };
  }
  return { dir: path.slice(0, lastSlash + 1), base: path.slice(lastSlash + 1) };
}

/** ~20px per diff row; close enough to keep the scrollbar honest. */
function estimatePatchHeight(patch: string): number {
  return patch.split("\n").length * 20;
}

/**
 * Mounts children once the placeholder nears the viewport. A whole-range
 * diff can hold dozens of PatchDiff sections whose highlight + DOM cost
 * froze the tab on open; lazy mounting renders only what's (almost) visible.
 * ponytail: not true windowing — sections stay mounted once shown; move to
 * the installed @tanstack/react-virtual if huge threads still crawl.
 */
function LazyPatchBody({ estimatedHeight, children }: { estimatedHeight: number; children: ReactNode }) {
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  // Fail-soft (jsdom / old browsers without IntersectionObserver): eager.
  const [mounted, setMounted] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (mounted) {
      return;
    }
    const element = placeholderRef.current;
    if (!element) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted]);

  if (!mounted) {
    return <div ref={placeholderRef} style={{ height: estimatedHeight }} />;
  }
  return <>{children}</>;
}

interface PatchFileSectionProps {
  file: CliRunDiffFile;
  /** The file's patch, for the lazy-mount height estimate; omit when the body is a note. */
  patch?: string;
  collapsed: boolean;
  onToggle: (path: string) => void;
  /** Lets the host scroll to a file; called with null on unmount. */
  registerSection: (path: string, element: HTMLElement | null) => void;
  /** Header buttons after the ±counts. */
  actions?: ReactNode;
  /** Expanded body of a non-binary file: the `PatchDiff` or a note. */
  children?: ReactNode;
  /** Replaces the default note for a binary file. */
  binaryBody?: ReactNode;
}

/** One collapsible per-file section with a sticky header: chevron, path, ±counts, actions. */
export function PatchFileSection({ file, patch, collapsed, onToggle, registerSection, actions, children, binaryBody }: PatchFileSectionProps) {
  const { dir, base } = splitPath(file.path);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section ref={(element) => registerSection(file.path, element)}>
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border bg-background px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
          onClick={() => onToggle(file.path)}
          aria-expanded={!collapsed}
        >
          <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono text-xs" title={file.path}>
            <span className="text-muted-foreground">{dir}</span>
            <span className={cn(file.kind === "deleted" && "line-through")}>{base}</span>
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
          {file.binary ? (
            <span className="text-muted-foreground">binary</span>
          ) : (
            <>
              <span className="text-success">+{file.additions}</span>
              <span className="text-destructive">-{file.deletions}</span>
            </>
          )}
        </span>
        {actions}
      </div>
      {!collapsed &&
        (file.binary ? (
          binaryBody ?? <p className="px-4 py-2 text-xs text-muted-foreground">Binary file — no diff to show.</p>
        ) : patch !== undefined ? (
          <LazyPatchBody estimatedHeight={estimatePatchHeight(patch)}>{children}</LazyPatchBody>
        ) : (
          children
        ))}
    </section>
  );
}
