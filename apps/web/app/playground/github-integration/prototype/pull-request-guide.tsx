import { useCallback, useId, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { BookOpen, Check, ChevronDown, CircleAlert, FileText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/custom/empty-state";
import { Spinner } from "@/components/custom/spinner";
import { SidebarResizeHandle } from "@/components/custom/sidebar-resize-handle";
import { useResizePanel } from "@/hooks/ui/use-resize-panel";
import { ReviewedFileSection } from "./reviewed-file-section";
import { Picker } from "./controls";
import { displayName, PersonAvatar } from "./people-picker";
import { guideFor, guideOptions, statsFor, type ChangedFile, type Guide, type GuideSettings, type PullRequest } from "./fixtures";

const pad = (value: number) => String(value).padStart(2, "0");
const bounds = { min: 280, max: 720, default: 440, storageKey: "playground:github:guide-width" };
const fromLeft = ({ clientX, containerRect }: { clientX: number; containerRect: DOMRect }) => clientX - containerRect.left;

// Before a guide exists: the user asks for one, then an agent writes it in a CLI thread.
export function GuidePending({ generating, requester, onGenerate, onOpenThread }: {
  generating: boolean;
  requester?: string;
  onGenerate: () => void;
  onOpenThread: () => void;
}) {
  return generating ? (
    <Empty className="h-full min-h-80">
      <EmptyHeader>
        <Spinner size="large" />
        <EmptyTitle className="mt-2">Writing the guide</EmptyTitle>
        <EmptyDescription>{requester ? `Requested by ${requester}. ` : ""}A Convoy agent is reading the diff in a CLI thread. The guide appears here when it finishes.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={onOpenThread}>Open thread</Button>
      </EmptyContent>
    </Empty>
  ) : (
    <Empty className="h-full min-h-80">
      <EmptyHeader>
        <EmptyMedia variant="icon"><BookOpen /></EmptyMedia>
        <EmptyTitle className="mt-2">No guide yet</EmptyTitle>
        <EmptyDescription>A Convoy agent can read the diff and split it into steps you review in order.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="secondary" onClick={onGenerate}><Sparkles />Generate guide</Button>
      </EmptyContent>
    </Empty>
  );
}

const ago = (at: number) => formatDistanceToNow(at, { addSuffix: true });

// The corner menu: the guide on screen, the others on request, and New guide.
export function GuideMenu({ guides, shown, currentUser, onSelect, onNew }: {
  guides: Guide[];
  shown: Guide;
  currentUser: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState(false);
  const latest = shown.id === guides.at(-1)?.id;
  const who = (guide: Guide) => (guide.requester === currentUser ? "you" : displayName(guide.requester));
  const rest = guides.filter((guide) => guide.id !== shown.id).reverse();
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); setOthers(false); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" aria-label={`Guide by ${who(shown)}`} className="min-w-0 text-muted-foreground">
          <PersonAvatar id={shown.requester} compact />
          <span className="truncate">{[latest ? null : "Older", shown.requester === currentUser ? "You" : displayName(shown.requester), shown.model, ago(shown.createdAt)].filter(Boolean).join(" · ")}</span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Guides" className="w-80 max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="space-y-1 border-b px-4 py-3 text-xs text-muted-foreground">
          <p className="text-sm font-medium text-foreground">{latest ? "Latest guide" : "Older guide"}</p>
          <p className="flex items-center gap-1.5"><PersonAvatar id={shown.requester} compact />Requested by {who(shown)} · {ago(shown.createdAt)}</p>
          <p>{shown.writing ? `${shown.model} is writing it` : `Written by ${shown.model}`}</p>
          <p className="font-mono">{`Written for ${shown.revision}`}</p>
          {shown.base ? <p>{`Follow-up of ${shown.base.requester === currentUser ? "your" : `${displayName(shown.base.requester)}'s`} guide`}</p> : null}
        </div>
        {rest.length ? (
          <div className="border-b p-1">
            {others ? rest.map((guide) => (
              <button key={guide.id} onClick={() => { onSelect(guide.id); setOpen(false); }} className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted/50">
                <PersonAvatar id={guide.requester} compact />
                <span className="min-w-0 flex-1 truncate"><span className="text-foreground">{guide.requester === currentUser ? "You" : displayName(guide.requester)}</span> · {guide.model} · {ago(guide.createdAt)}</span>
                <span className="font-mono text-muted-foreground">{guide.revision}</span>
              </button>
            )) : (
              <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setOthers(true)}>
                {latest ? "See older guides" : "See other guides"} ({rest.length})
              </Button>
            )}
          </div>
        ) : null}
        <div className="p-2">
          <Button variant="outline" size="sm" onClick={() => { setOpen(false); onNew(); }}><Sparkles />New guide</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Asks where the agent runs; the choices are kept for guides only, apart from thread defaults.
export function GuideLauncher({ title, initial, onClose, onGenerate }: {
  title: string;
  initial: GuideSettings;
  onClose: () => void;
  onGenerate: (settings: GuideSettings) => void;
}) {
  const [settings, setSettings] = useState(initial);
  const worktreeId = useId();
  const field = (key: "profile" | "path" | "model", label: string) => (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Picker label={label} value={settings[key]} onChange={(value) => setSettings({ ...settings, [key]: value })} options={guideOptions[key].map((value) => ({ value, label: value }))} />
    </div>
  );
  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>A Convoy agent checks out this PR with gh in a CLI thread on your machine. Everyone in the project can read the guide.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {field("profile", "CLI profile")}
          {field("path", "Working path")}
          <div className="flex items-center gap-2">
            <Checkbox id={worktreeId} checked={settings.worktree} onCheckedChange={(checked) => setSettings({ ...settings, worktree: checked === true })} />
            <Label htmlFor={worktreeId} className="font-normal">Run in a new worktree</Label>
          </div>
          {field("model", "Model")}
        </div>
        <p className="text-xs text-muted-foreground">These choices are remembered only for guides. Your thread defaults don&apos;t change.</p>
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancel</Button></DialogClose>
          <Button size="sm" onClick={() => onGenerate(settings)}><Sparkles />Generate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Linear-style walkthrough: each step explains a group of files beside their diffs.
export function PullRequestGuide({ pr, guide, currentUser, files, reviewed, reviewBlocked, onReviewedChange, onExternal }: {
  pr: PullRequest;
  guide: Guide;
  currentUser: string | null;
  files: ChangedFile[];
  reviewed: string[];
  reviewBlocked?: string;
  onReviewedChange: (paths: string[]) => void;
  onExternal: () => void;
}) {
  const steps = guideFor(pr);
  // A follow-up keeps its base's steps word for word; the simulated push only touches the first.
  const changeOf = (index: number) => (guide.base ? (index ? "Unchanged" : "Updated") : undefined);
  const [onlyChanged, setOnlyChanged] = useState(false);
  // Reviewed files start collapsed; a header click flips one until its mark changes.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const sections = useRef(new Map<string, HTMLElement>());
  const container = useRef<HTMLDivElement>(null);
  const { width, handleMouseDown, adjustWidthBy } = useResizePanel(container, { bounds, getWidthFromPointer: fromLeft });
  const registerSection = useCallback((path: string, element: HTMLElement | null) => {
    if (element) sections.current.set(path, element);
    else sections.current.delete(path);
  }, []);
  const flip = (path: string, on: boolean) => setToggled((current) => {
    const next = new Set(current);
    if (on) next.add(path);
    else next.delete(path);
    return next;
  });
  const isCollapsed = (path: string) => reviewed.includes(path) !== toggled.has(path);
  const show = (path: string) => {
    if (isCollapsed(path)) flip(path, !toggled.has(path));
    requestAnimationFrame(() => sections.current.get(path)?.scrollIntoView({ block: "start", behavior: "smooth" }));
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
      {guide.base ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-2.5 text-xs text-muted-foreground md:px-8">
          <span>{`Follow-up of ${guide.base.requester === currentUser ? "your" : `${displayName(guide.base.requester)}'s`} guide for ${guide.base.revision}`} · 1 updated, {steps.length - 1} unchanged</span>
          <label className="flex items-center gap-2"><Switch checked={onlyChanged} onCheckedChange={setOnlyChanged} aria-label="Only what changed" />Only what changed</label>
        </div>
      ) : null}
      {steps.map((step, index) => onlyChanged && changeOf(index) === "Unchanged" ? null : (
        <section key={step.title} aria-labelledby={`guide-step-${index}`} className="bg-(--guide-row) lg:grid lg:grid-cols-[var(--guide-left)_minmax(0,1fr)]" style={{ "--guide-row": index % 2 ? "color-mix(in oklab, var(--muted) 40%, var(--background))" : "var(--background)" } as React.CSSProperties}>
          {/* The rule lines up with the files' top border; the tab bar already draws the first. */}
          <div className={index ? "border-t" : undefined}>
            <div className="px-5 pt-6 pb-8 md:px-8 lg:sticky lg:top-0">
              <p className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                {pad(index + 1)} / {pad(steps.length)}
                {changeOf(index) ? <Badge variant={changeOf(index) === "Updated" ? "default" : "secondary"}>{changeOf(index)}</Badge> : null}
              </p>
              <h2 id={`guide-step-${index}`} className="mt-1 text-lg font-semibold">{step.title}</h2>
              {changeOf(index) === "Updated" ? <p className="mt-3 rounded-md border px-3 py-2 text-xs">{`What changed since ${guide.base!.revision}: ${step.change}`}</p> : null}
              <p className="mt-4 text-sm leading-6">{step.body}</p>
              {step.attention ? (
                <div className="mt-4 flex gap-2 rounded-md bg-muted px-3 py-2 text-xs">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <p><span className="font-medium">{step.attention.kind}</span><span className="text-muted-foreground"> · {step.attention.note}</span></p>
                </div>
              ) : null}
              <ul className="mt-5 space-y-1">
                {step.paths.map((path) => {
                  const file = files.find((item) => item.path === path)!;
                  const { additions, deletions } = statsFor(file);
                  const slash = path.lastIndexOf("/");
                  return (
                    <li key={path}>
                      <button onClick={() => show(path)} title={path} className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-left text-xs hover:bg-muted">
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className={file.kind === "deleted" ? "line-through" : undefined}>{path.slice(slash + 1)}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{path.slice(0, slash)}</span>
                        {file.kind === "binary" || file.kind === "large" ? <span className="text-muted-foreground">{file.kind}</span> : <span className="tabular-nums">
                          {additions ? <span className="text-green-600">+{additions}</span> : null} {deletions ? <span className="text-destructive">-{deletions}</span> : null}
                        </span>}
                        {reviewed.includes(path) ? <Check aria-label={`${path} reviewed`} className="size-3.5 shrink-0 text-primary" /> : <span className="size-3.5 shrink-0" />}
                      </button>
                      {step.notes?.[path] ? <p className="px-2.5 pt-1 text-xs text-muted-foreground">{step.notes[path]}</p> : null}
                    </li>
                  );
                })}
              </ul>
              {step.questions?.map((question) => <p key={question} className="mt-4 text-xs text-muted-foreground">Question: {question}</p>)}
            </div>
          </div>
          {/* Files stack edge to edge like Diff; an expanded body closes with its own rule. */}
          <div className="min-w-0 pb-16">
            {/* Sticky headers stay opaque but take the row's color. */}
            <div className={`[&>section:has(>:nth-child(2))]:border-b [&>section>div:first-child]:bg-(--guide-row) ${index ? "border-t" : ""}`}>
              {step.paths.map((path) => (
                <ReviewedFileSection
                  key={path}
                  file={files.find((item) => item.path === path)!}
                  collapsed={isCollapsed(path)}
                  onToggle={(value) => flip(value, !toggled.has(value))}
                  registerSection={registerSection}
                  reviewed={reviewed.includes(path)}
                  reviewBlocked={reviewBlocked}
                  onReviewed={(checked) => {
                    onReviewedChange(checked ? [...reviewed, path] : reviewed.filter((value) => value !== path));
                    flip(path, false);
                  }}
                  onExternal={onExternal}
                  style="unified"
                  wrap
                />
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
