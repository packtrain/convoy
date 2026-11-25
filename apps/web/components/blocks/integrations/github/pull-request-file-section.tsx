"use client";

import { useMemo, type ReactNode } from "react";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { FileText } from "lucide-react";
import { PatchFileSection, type usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toSectionFile, toUnifiedPatch, type PullRequestDiffFile } from "./github-patch";

/** Why a file has no diff here; GitHub doesn't say which, so name every cause. */
function NoTextDiff({ file, filesUrl }: { file: PullRequestDiffFile; filesUrl: string }) {
  const renamedOnly = file.status === "renamed" && file.additions + file.deletions === 0;
  return (
    <p className="px-4 py-2 text-xs text-muted-foreground">
      {renamedOnly ? (
        <>
          Renamed from <code>{file.previousPath}</code>. File contents are unchanged.
        </>
      ) : (
        <>
          GitHub sent no text diff for this file: it may be binary, too large, or over this view&apos;s limit.{" "}
          <a href={filesUrl} target="_blank" rel="noreferrer" className="underline">
            Open on GitHub
          </a>
        </>
      )}
    </p>
  );
}

/** A file's inline comments as diff annotations; `onComment` (stable, or the gutter re-renders) adds the "+" that opens an editor, and null closes it. */
export type FileLineComments<T> = {
  annotations: DiffLineAnnotation<T>[];
  renderAnnotation: (annotation: DiffLineAnnotation<T>) => ReactNode;
  /** The lines the open editor comments on. */
  selectedLines?: SelectedLineRange | null;
  onComment?: (path: string, range: SelectedLineRange | null) => void;
};

/** Pierre tints the row under a selection; the comment editor there keeps the page's background. */
const EDITOR_ROW_CSS = "[data-line-annotation][data-selected-line] [data-annotation-content] { background-color: unset; }";

/** One changed file as a collapsible section with its Reviewed mark; the Diff, Guide, and Commits tabs share it. */
export function PullRequestFileSection<T>({
  file,
  filesUrl,
  options,
  collapsed,
  onToggle,
  registerSection,
  reviewed,
  onReviewedChange,
  onOpen,
  lineComments,
}: {
  file: PullRequestDiffFile;
  /** GitHub's page with every file, linked when a file has no text diff. */
  filesUrl: string;
  options: ReturnType<typeof usePatchDiffOptions>;
  collapsed: boolean;
  onToggle: (path: string) => void;
  registerSection: (path: string, element: HTMLElement | null) => void;
  /** The checkbox is left out without `onReviewedChange`, as in the Commits tab. */
  reviewed?: boolean;
  onReviewedChange?: (reviewed: boolean) => void;
  /** Opens the whole file; the button is left out without it. */
  onOpen?: () => void;
  /** The Diff tab's inline comments; the Guide tab has none. */
  lineComments?: FileLineComments<T>;
}) {
  const patch = toUnifiedPatch(file);
  const onComment = lineComments?.onComment;
  const path = file.path;
  const diffOptions = useMemo(
    () =>
      onComment
        ? {
            ...options,
            enableGutterUtility: true,
            onGutterUtilityClick: (range: SelectedLineRange) => onComment(path, range),
            // Line selection highlights a drag of the "+"; selecting by line numbers moves the editor too, so the two never part.
            enableLineSelection: true,
            onLineSelectionEnd: (range: SelectedLineRange | null) => onComment(path, range),
            unsafeCSS: EDITOR_ROW_CSS,
          }
        : options,
    [options, onComment, path]
  );
  return (
    <PatchFileSection
      file={toSectionFile(file)}
      patch={patch ?? undefined}
      collapsed={collapsed}
      onToggle={onToggle}
      registerSection={registerSection}
      actions={
        <>
          {onReviewedChange ? (
            <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox aria-label={`Reviewed ${file.path}`} checked={reviewed} onCheckedChange={(checked) => onReviewedChange(checked === true)} />
              Reviewed
            </label>
          ) : null}
          {onOpen ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6"
              aria-label={`Open ${file.path}`}
              title={file.status === "removed" ? "File before deletion" : "Open file"}
              onClick={onOpen}
            >
              <FileText className="size-3.5" />
            </Button>
          ) : null}
        </>
      }
    >
      {file.previousPath && patch ? (
        <p className="px-4 py-1.5 text-xs text-muted-foreground">
          Renamed from <code>{file.previousPath}</code>
        </p>
      ) : null}
      {patch ? (
        <PatchDiff<T>
          patch={patch}
          options={diffOptions}
          lineAnnotations={lineComments?.annotations}
          renderAnnotation={lineComments?.renderAnnotation}
          selectedLines={lineComments?.selectedLines}
        />
      ) : (
        <NoTextDiff file={file} filesUrl={filesUrl} />
      )}
    </PatchFileSection>
  );
}
