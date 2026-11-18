"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { BookOpen, Check, ChevronDown, CircleAlert, FileText, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { GuideDetail, GuideSummary } from "@/convex/integrations/github/lib/validators";
import { usePatchDiffOptions } from "@/components/custom/diff/patch-file-sections";
import { EmptyState } from "@/components/custom/empty-state";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { Spinner } from "@/components/custom/spinner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { getCliModelOption, isCliType, renderCliIcon } from "@/lib/cli-runtime-ui/registry";
import { formatModelLabel } from "@/lib/costs/cost-summary";
import { formatCompactRelativeTime } from "@/lib/format-relative-time";
import { getMutationErrorMessage } from "@/lib/errors";
import { AppLink, appRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { DiffState, PullRequestDiff, PullRequestDiffFile } from "./github-patch";
import { PullRequestFileSection } from "./pull-request-file-section";
import type { useGenerateGuide } from "./run-pull-request-guide";
import type { useReviewedMarks } from "./use-reviewed-marks";

// The PR's Guide tab (docs/specs/github-integration.md → Guides → Reading and switching).

type Steps = { kind: "loaded"; guide: GuideDetail } | { kind: "error" };
export type PullRequestGuides = ReturnType<typeof usePullRequestGuides>;
type Launch = ReturnType<typeof useGenerateGuide>;

/** The PR's Guides, live, and the one on screen. A ready Guide never changes, so its steps are read once. */
export function usePullRequestGuides(args: { projectId: Id<"projects">; repositoryId: string; number: number } | "skip") {
  const guides = useQuery(api.integrations.github.guides.listForPullRequest, args);
  const convex = useConvex();
  const [steps, setSteps] = useState<ReadonlyMap<string, Steps>>(new Map());
  // The member's pick, else the newest; a deleted pick falls back to the newest.
  const [selected, select] = useState<Id<"integrationPullRequestGuides"> | null>(null);
  const shown = guides?.find((guide) => guide._id === selected) ?? guides?.[0] ?? null;
  const readyId = shown?.status === "ready" ? shown._id : null;
  const loaded = readyId ? steps.get(readyId) : undefined;
  useEffect(() => {
    if (!readyId || loaded) return;
    let live = true;
    const settle = (value: Steps) => live && setSteps((current) => new Map(current).set(readyId, value));
    convex
      .query(api.integrations.github.guides.get, { guideId: readyId })
      .then((guide) => settle(guide ? { kind: "loaded", guide } : { kind: "error" }))
      .catch(() => settle({ kind: "error" }));
    return () => {
      live = false;
    };
  }, [convex, readyId, loaded]);
  const retry = () =>
    setSteps((current) => {
      const next = new Map(current);
      if (readyId) next.delete(readyId);
      return next;
    });
  return { guides, shown, steps: loaded, retry, select };
}

/** The composer's label ("Sonnet 5.5"); an unknown slug shows as stored. */
const modelOf = ({ cliType, cliModel }: GuideSummary) =>
  !cliModel ? cliType : ((isCliType(cliType) ? getCliModelOption(cliType, cliModel)?.label : undefined) ?? formatModelLabel(cliModel));
/** "you" or the requester's name, mid-sentence; `capitalize` starts one. */
const requesterName = (guide: GuideSummary) => (guide.requester.isViewer ? "you" : (guide.requester.name ?? "a former member"));
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const shortSha = (guide: GuideSummary) => guide.headSha.slice(0, 7);

/** The short age, or "Failed" in its place: the row has no room for a status column. */
function GuideAge({ guide, className }: { guide: GuideSummary; className?: string }) {
  if (guide.status === "failed") return <span className={cn("shrink-0 text-xs text-destructive", className)}>Failed</span>;
  return <span className={cn("shrink-0 text-xs text-muted-foreground/70", className)}>{formatCompactRelativeTime(guide.createdAt)}</span>;
}

/** The requester's avatar; hovering it names them. */
function RequesterAvatar({ guide }: { guide: GuideSummary }) {
  const name = guide.requester.name ?? "A former member";
  return (
    <Avatar className="size-4 shrink-0" title={name}>
      {guide.requester.avatarUrl ? <AvatarImage src={guide.requester.avatarUrl} alt="" /> : null}
      <AvatarFallback className="text-[9px]">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/** One line per Guide, like a thread row: runtime icon, model, commit, and age. */
function GuideLine({ guide }: { guide: GuideSummary }) {
  // Delete takes the age's place on hover or focus.
  const swap = guide.canDelete && "group-hover:invisible group-has-[[data-variant=destructive]:focus]:invisible";
  return (
    <>
      {isCliType(guide.cliType) ? renderCliIcon(guide.cliType, "size-3.5 shrink-0 text-muted-foreground") : null}
      <span className="min-w-0 truncate">{modelOf(guide)}</span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{shortSha(guide)}</span>
      <span className="ml-auto shrink-0 pl-2">
        <RequesterAvatar guide={guide} />
      </span>
      <GuideAge guide={guide} className={swap || undefined} />
    </>
  );
}

/** The corner menu in the tab row: the Guide on screen, every Guide to switch to, Delete on each row, and New guide. */
export function GuideMenu({ state, launch }: { state: PullRequestGuides; launch: Launch }) {
  const { guides, shown, select } = state;
  // The Guide the member chose: the list is live, so the row may hold another one by the time they confirm.
  const [confirming, setConfirming] = useState<Id<"integrationPullRequestGuides"> | null>(null);
  const [deleting, setDeleting] = useState(false);
  const remove = useMutation(api.integrations.github.guides.remove);
  if (!guides || !shown) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="min-w-0 text-muted-foreground">
            {isCliType(shown.cliType) ? renderCliIcon(shown.cliType, "size-3.5 shrink-0") : null}
            <span className="truncate">{modelOf(shown)}</span>
            <span className="shrink-0 font-mono text-xs">{shortSha(shown)}</span>
            <RequesterAvatar guide={shown} />
            <GuideAge guide={shown} />
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
          {guides.map((guide) => (
            <div key={guide._id} className="group relative">
              <DropdownMenuItem
                onSelect={() => select(guide._id)}
                className={cn("cursor-pointer gap-2", guide._id === shown._id && "bg-accent/60")}
              >
                <GuideLine guide={guide} />
              </DropdownMenuItem>
              {guide.canDelete ? (
                // Over the age, shown on hover or focus, like a thread row's actions.
                <DropdownMenuItem
                  variant="destructive"
                  aria-label={`Delete guide for ${shortSha(guide)}`}
                  onSelect={() => setConfirming(guide._id)}
                  className="absolute top-1/2 right-1 size-6 -translate-y-1/2 cursor-pointer justify-center p-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 />
                </DropdownMenuItem>
              ) : null}
            </div>
          ))}
          {launch.allowed ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={launch.disabled}
                className="cursor-pointer"
                onSelect={() => {
                  // The new Guide lands first in the list, so show the newest.
                  select(null);
                  launch.start();
                }}
              >
                <Plus className="size-4" />
                New guide
                {/* A disabled item takes no pointer events, so a tooltip would never show. */}
                {launch.disabled && launch.reason ? <span className="ml-auto truncate pl-2 text-xs">{launch.reason}</span> : null}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Delete this guide?"
        description="Everyone in the project loses it. The thread that wrote it stays."
        busy={deleting}
        cancel={{ label: "Cancel" }}
        confirm={{
          label: "Delete",
          variant: "destructive",
          autoCloseOnClick: false,
          onClick: () => {
            if (!confirming) return;
            setDeleting(true);
            remove({ guideId: confirming })
              .then(() => setConfirming(null))
              .catch((error: unknown) => toast.error(getMutationErrorMessage(error, "Failed to delete the guide")))
              .finally(() => setDeleting(false));
          },
        }}
      />
    </>
  );
}

/** The Guide tab's body: No guide yet, Writing the guide, Failed, or the steps beside their files' diffs. */
export function PullRequestGuideTab({
  state,
  launch,
  diffState,
  onRetryDiff,
  marks,
  organizationSlug,
  projectAlias,
}: {
  state: PullRequestGuides;
  launch: Launch;
  /** The reader's diff read, for the steps' file diffs. */
  diffState: DiffState;
  onRetryDiff: () => void;
  marks: ReturnType<typeof useReviewedMarks>;
  organizationSlug: string;
  projectAlias: string;
}) {
  const { guides, shown, steps } = state;
  if (!guides || (shown?.status === "ready" && !steps)) return <GuideSkeleton />;
  if (!shown) {
    return (
      <EmptyState
        className="h-full min-h-80"
        icon={BookOpen}
        title="No guide yet"
        description="An agent can read the diff and split it into steps you review in order."
        action={
          launch.allowed ? (
            // A disabled button gets no pointer events, so the reason sits on its wrapper.
            <span title={launch.reason ?? undefined}>
              <Button variant="secondary" disabled={launch.disabled} onClick={() => launch.start()}>
                <Sparkles />
                Generate guide
              </Button>
            </span>
          ) : null
        }
      />
    );
  }
  const openThread = shown.threadId ? (
    <Button variant="secondary" size="sm" asChild>
      <AppLink href={appRoute.projectThreadDetail(organizationSlug, projectAlias, String(shown.threadId))}>Open thread</AppLink>
    </Button>
  ) : null;
  if (shown.status === "failed") {
    // Retry is the requester's: it reruns on their own CLI profile.
    const canRetry = shown.requester.isViewer && launch.allowed;
    return (
      <EmptyState
        className="h-full min-h-80"
        icon={CircleAlert}
        title="The guide could not be written"
        description={
          <>
            <span className="block">{shown.failureReason}</span>
            {shown.requester.isViewer ? null : <span className="block">Requested by {requesterName(shown)}.</span>}
          </>
        }
        actionClassName="flex gap-2"
        action={
          canRetry || openThread ? (
            <>
              {canRetry ? (
                <span title={launch.reason ?? undefined}>
                  <Button variant="secondary" size="sm" disabled={launch.disabled} onClick={() => launch.start(shown._id)}>
                    <RotateCcw />
                    Retry
                  </Button>
                </span>
              ) : null}
              {openThread}
            </>
          ) : null
        }
      />
    );
  }
  if (shown.status === "writing") {
    return (
      <EmptyState
        className="h-full min-h-80"
        icon={BookOpen}
        title={
          <span className="inline-flex items-center gap-2">
            <Spinner />
            Writing the guide
          </span>
        }
        description={`${shown.requester.isViewer ? "" : `Requested by ${requesterName(shown)}. `}An agent is reading the diff in a CLI thread. The guide appears here when it finishes.`}
        action={openThread}
      />
    );
  }
  if (steps?.kind !== "loaded") {
    return (
      <div className="m-4 flex items-center gap-3 rounded-md border px-3 py-2 text-sm text-destructive">
        <span className="flex-1">Could not load the guide.</span>
        <Button variant="outline" size="sm" onClick={state.retry}>
          <RotateCcw />
          Retry
        </Button>
      </div>
    );
  }
  return <GuideSteps guide={steps.guide} diffState={diffState} onRetryDiff={onRetryDiff} marks={marks} />;
}

const pad = (value: number) => String(value).padStart(2, "0");
const bounds = { min: 280, max: 720, default: 440, storageKey: "convoy:github:guide-width" };
const fromLeft = ({ clientX, containerRect }: { clientX: number; containerRect: DOMRect }) => clientX - containerRect.left;

/** Each step on the left, sticky, beside its files' diffs on the right. Reviewed files start collapsed. */
function GuideSteps({
  guide,
  diffState,
  onRetryDiff,
  marks,
}: {
  guide: GuideDetail;
  diffState: DiffState;
  onRetryDiff: () => void;
  marks: ReturnType<typeof useReviewedMarks>;
}) {
  const diff: PullRequestDiff | null = diffState.kind === "loaded" ? diffState.diff : null;
  const options = usePatchDiffOptions("unified", true);
  // A header click flips a file until its Reviewed mark changes.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const sections = useRef(new Map<string, HTMLElement>());
  const container = useRef<HTMLDivElement>(null);
  const { width, handleMouseDown, adjustWidthBy } = useResizePanel(container, { bounds, getWidthFromPointer: fromLeft });
  const registerSection = useCallback((path: string, element: HTMLElement | null) => {
    if (element) sections.current.set(path, element);
    else sections.current.delete(path);
  }, []);
  const files = new Map(diff?.files.map((file) => [file.path, file]));
  const flip = (path: string, on: boolean) =>
    setToggled((current) => {
      const next = new Set(current);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  const isCollapsed = (file: PullRequestDiffFile) => marks.isReviewed(file) !== toggled.has(file.path);
  const show = (file: PullRequestDiffFile) => {
    if (isCollapsed(file)) flip(file.path, !toggled.has(file.path));
    requestAnimationFrame(() => sections.current.get(file.path)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  return (
    <div ref={container} className="relative min-h-full" style={{ "--guide-left": `${width}px` } as React.CSSProperties}>
      <SidebarResizeHandle
        ariaLabel="Resize guide columns"
        currentWidth={width}
        bounds={bounds}
        expandDirection="right"
        onResizeMouseDown={handleMouseDown}
        onResizeByStep={adjustWidthBy}
        className="absolute inset-y-0 left-(--guide-left) z-20 hidden -translate-x-1/2 before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-border lg:block"
      />
      {diffState.kind === "error" ? (
        <div className="relative z-30 flex items-center gap-3 border-b bg-background px-5 py-2 text-sm text-destructive md:px-8">
          <span className="flex-1">{diffState.message}</span>
          <Button variant="outline" size="sm" onClick={onRetryDiff}>
            <RotateCcw />
            Retry
          </Button>
        </div>
      ) : null}
      {guide.steps.map((step, index) => (
        <section
          key={index}
          aria-labelledby={`guide-step-${index}`}
          className="bg-(--guide-row) lg:grid lg:grid-cols-[var(--guide-left)_minmax(0,1fr)]"
          style={{ "--guide-row": index % 2 ? "color-mix(in oklab, var(--muted) 40%, var(--background))" : "var(--background)" } as React.CSSProperties}
        >
          {/* The rule lines up with the files' top border; the tab bar already draws the first. */}
          <div className={index ? "border-t" : undefined}>
            <div className="px-5 pt-6 pb-8 md:px-8 lg:sticky lg:top-0">
              <p className="text-xs tabular-nums text-muted-foreground">
                {pad(index + 1)} / {pad(guide.steps.length)}
              </p>
              <h2 id={`guide-step-${index}`} className="mt-1 text-lg font-semibold">
                {step.title}
              </h2>
              <p className="mt-4 text-sm leading-6 whitespace-pre-line">{step.explanation}</p>
              {step.attention ? (
                <div className="mt-4 flex gap-2 rounded-md bg-muted px-3 py-2 text-sm leading-6">
                  {/* A box one line tall centres the icon on the first line, however the note wraps. */}
                  <span className="flex h-6 shrink-0 items-center">
                    <CircleAlert className="size-4" />
                  </span>
                  <p>
                    <span className="font-medium">{capitalize(step.attention.kind)}:</span>{" "}
                    <span className="text-muted-foreground">{step.attention.note}</span>
                  </p>
                </div>
              ) : null}
              <ul className="mt-5 space-y-1">
                {step.files.map(({ path, note }) => {
                  const file = files.get(path);
                  const slash = path.lastIndexOf("/");
                  return (
                    <li key={path}>
                      <button
                        type="button"
                        disabled={!file}
                        onClick={() => file && show(file)}
                        title={path}
                        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-left text-xs hover:bg-muted disabled:cursor-default disabled:hover:bg-muted/40"
                      >
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className={file?.status === "removed" ? "line-through" : undefined}>{path.slice(slash + 1)}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{path.slice(0, Math.max(slash, 0))}</span>
                        {file ? (
                          <span className="tabular-nums">
                            {file.additions ? <span className="text-success">+{file.additions}</span> : null}{" "}
                            {file.deletions ? <span className="text-destructive">-{file.deletions}</span> : null}
                          </span>
                        ) : null}
                        {file && marks.isReviewed(file) ? (
                          <Check aria-label={`${path} reviewed`} className="size-3.5 shrink-0 text-primary" />
                        ) : (
                          <span className="size-3.5 shrink-0" />
                        )}
                      </button>
                      {note ? <p className="px-2.5 pt-1 text-xs text-muted-foreground">{note}</p> : null}
                    </li>
                  );
                })}
              </ul>
              {step.questions.map((question, at) => (
                <p key={at} className="mt-4 text-xs text-muted-foreground">
                  Question: {question}
                </p>
              ))}
            </div>
          </div>
          {/* Files stack edge to edge like Diff; an expanded body closes with its own rule. */}
          <div className="min-w-0 pb-16">
            <div className={`[&>section:has(>:nth-child(2))]:border-b [&>section>div:first-child]:bg-(--guide-row) ${index ? "border-t" : ""}`}>
              {step.files.map(({ path }) => {
                const file = files.get(path);
                if (file && diff) {
                  return (
                    <PullRequestFileSection
                      key={path}
                      file={file}
                      htmlUrl={diff.htmlUrl}
                      options={options}
                      collapsed={isCollapsed(file)}
                      onToggle={() => flip(path, !toggled.has(path))}
                      registerSection={registerSection}
                      reviewed={marks.isReviewed(file)}
                      onReviewedChange={(reviewed) => {
                        marks.setReviewed(file, reviewed);
                        flip(path, false);
                      }}
                    />
                  );
                }
                if (diffState.kind === "loading") {
                  return <Skeleton key={path} className="m-4 h-24 rounded-lg" aria-label={`Loading ${path}`} />;
                }
                return (
                  <p key={path} className="border-b px-4 py-2 text-xs text-muted-foreground">
                    <code>{path}</code>
                    {diff ? (
                      <>
                        {" "}
                        isn&apos;t in the loaded diff.{" "}
                        <a href={`${diff.htmlUrl}/files`} target="_blank" rel="noreferrer" className="underline">
                          Open on GitHub
                        </a>
                      </>
                    ) : null}
                  </p>
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/** Two columns, as the steps lay out once they load. */
export function GuideSkeleton() {
  return (
    <div aria-label="Loading guide" className="lg:grid lg:grid-cols-[440px_minmax(0,1fr)]">
      <div className="space-y-3 px-5 pt-6 md:px-8">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    </div>
  );
}
