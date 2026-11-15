import dynamic from "next/dynamic";
import { ArrowUpRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { PatchFileSection } from "@/components/custom/diff/patch-file-sections";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/custom/empty-state";
import { patchFor, summaryFor, type ChangedFile } from "./fixtures";

export const DiffView = dynamic(() => import("./diff-view"), {
  ssr: false,
  loading: () => (
    <div className="space-y-3 p-5">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  ),
});

// One changed file with GitHub's Viewed checkbox, shared by the Diff and Guide tabs.
export function ReviewedFileSection({ file, collapsed, onToggle, registerSection, reviewed, reviewBlocked, onReviewed, onOpen, onExternal, style, wrap }: {
  file: ChangedFile;
  collapsed: boolean;
  onToggle: (path: string) => void;
  registerSection: (path: string, element: HTMLElement | null) => void;
  reviewed: boolean;
  reviewBlocked?: string;
  onReviewed: (checked: boolean) => void;
  onOpen?: () => void;
  onExternal: () => void;
  style: "split" | "unified";
  wrap: boolean;
}) {
  const external = file.kind === "binary" || file.kind === "large";
  return (
    <PatchFileSection
      file={summaryFor(file)}
      patch={file.kind === "modified" || file.kind === "deleted" ? patchFor(file) : undefined}
      collapsed={collapsed}
      onToggle={onToggle}
      registerSection={registerSection}
      binaryBody={<FileUnavailable binary onExternal={onExternal} />}
      actions={<>
        <label title={reviewBlocked} className={`ml-2 flex items-center gap-1.5 text-xs text-muted-foreground ${reviewBlocked ? "" : "cursor-pointer"}`}>
          <Checkbox aria-label={`Reviewed ${file.path}`} disabled={!!reviewBlocked} checked={reviewed} onCheckedChange={(checked) => onReviewed(checked === true)} />
          Reviewed
        </label>
        {!external && onOpen ? <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Open ${file.path}`} title={file.kind === "deleted" ? "File before deletion" : "Open file"} onClick={onOpen}><FileText className="size-3.5" /></Button> : null}
      </>}
    >
      {file.kind === "large" ? <FileUnavailable onExternal={onExternal} /> :
        file.kind === "renamed" ? <p className="px-4 py-2 text-xs text-muted-foreground">Renamed from <code>{file.previousPath}</code>. File contents are unchanged.</p> :
        <DiffView file={file} style={style} wrap={wrap} whole={false} />}
    </PatchFileSection>
  );
}

// Binary and oversized files have no diff here, so the block points to GitHub.
export function FileUnavailable({ binary = false, onExternal }: { binary?: boolean; onExternal: () => void }) {
  return (
    <Empty className="py-10">
      <EmptyHeader className="gap-1">
        <EmptyTitle className="text-sm font-medium">{binary ? "Binary file" : "This file is too large to display"}</EmptyTitle>
        <EmptyDescription className="text-xs">{binary ? "There's no text diff to show." : "GitHub doesn't return diffs this large."}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onExternal}>View on GitHub<ArrowUpRight /></Button>
      </EmptyContent>
    </Empty>
  );
}
