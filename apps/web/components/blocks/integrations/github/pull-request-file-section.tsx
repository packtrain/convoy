"use client";

import { PatchDiff } from "@pierre/diffs/react";
import { FileText } from "lucide-react";
import { PatchFileSection, type usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toSectionFile, toUnifiedPatch, type PullRequestDiffFile } from "./github-patch";

/** Why a file has no diff here; GitHub doesn't say which, so name every cause. */
function NoTextDiff({ file, htmlUrl }: { file: PullRequestDiffFile; htmlUrl: string }) {
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
          <a href={`${htmlUrl}/files`} target="_blank" rel="noreferrer" className="underline">
            Open on GitHub
          </a>
        </>
      )}
    </p>
  );
}

/** One changed file as a collapsible section with its Reviewed mark; the Diff and Guide tabs share it. */
export function PullRequestFileSection({
  file,
  htmlUrl,
  options,
  collapsed,
  onToggle,
  registerSection,
  reviewed,
  onReviewedChange,
  onOpen,
}: {
  file: PullRequestDiffFile;
  htmlUrl: string;
  options: ReturnType<typeof usePatchDiffOptions>;
  collapsed: boolean;
  onToggle: (path: string) => void;
  registerSection: (path: string, element: HTMLElement | null) => void;
  reviewed: boolean;
  onReviewedChange: (reviewed: boolean) => void;
  /** Opens the whole file; the button is left out without it. */
  onOpen?: () => void;
}) {
  const patch = toUnifiedPatch(file);
  return (
    <PatchFileSection
      file={toSectionFile(file)}
      patch={patch ?? undefined}
      collapsed={collapsed}
      onToggle={onToggle}
      registerSection={registerSection}
      actions={
        <>
          <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox aria-label={`Reviewed ${file.path}`} checked={reviewed} onCheckedChange={(checked) => onReviewedChange(checked === true)} />
            Reviewed
          </label>
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
      {patch ? <PatchDiff patch={patch} options={options} /> : <NoTextDiff file={file} htmlUrl={htmlUrl} />}
    </PatchFileSection>
  );
}
