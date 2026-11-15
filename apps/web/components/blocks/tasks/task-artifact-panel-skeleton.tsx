import { Skeleton } from "@/components/ui/skeleton";

/** Editor body placeholder: a heading line and a few text lines. */
export function ArtifactEditorSkeleton() {
  return (
    <div className="space-y-3 p-3" aria-label="Loading editor">
      <Skeleton className="h-6 w-64 max-w-full rounded-sm" />
      <Skeleton className="h-4 w-full rounded-sm" />
      <Skeleton className="h-4 w-5/6 rounded-sm" />
      <Skeleton className="h-4 w-2/3 rounded-sm" />
    </div>
  );
}

/** Artifact panel placeholder: the name header row above the editor body. */
export function TaskArtifactPanelSkeleton() {
  return (
    <div aria-label="Loading artifact" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-1">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 pr-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-4 w-48 max-w-full rounded-sm" />
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
      </div>
      <ArtifactEditorSkeleton />
    </div>
  );
}
