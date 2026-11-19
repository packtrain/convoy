"use client";

import { useId, useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { DiffLineAnnotation, SelectedLineRange, SelectionSide } from "@pierre/diffs";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, Pencil, SquareArrowOutUpRight, Trash2, X } from "lucide-react";
import { Spinner } from "@/components/custom/spinner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioIndicator } from "@/components/ui/radio-indicator";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getHotkeyKeycaps } from "@/lib/browser/hotkeys";
import { readLocalJson, removeLocalValue, writeLocalJson } from "@/lib/browser/local-storage";
import { showConvexErrorToast } from "@/lib/errors";
import { isRecord } from "@/lib/type-guards";
import { cn } from "@/lib/utils";
import { GithubMarkdown } from "./github-markdown";
import { AssignPicker } from "./pull-request-assignees";
import type { GithubCommenting } from "./pull-request-comments";
import type { PullRequestOverview } from "./types";

// Reviews as the member's Linked GitHub account: inline comments on diff lines, the header's Review popover,
// and requesting reviewers (docs/specs/github-integration.md → Reviews).

type Side = "LEFT" | "RIGHT";
/** One line, or `startLine` through `line` when the comment spans a range. */
type LineAnchor = { path: string; side: Side; line: number; startLine?: number; startSide?: Side };
type PendingComment = LineAnchor & { id: string; body: string };
/** Kept in local storage per member until it is submitted; inline comments belong to the revision they were left on. */
type Draft = { headSha: string; body: string; comments: PendingComment[] };
type ReviewEvent = FunctionArgs<typeof api.integrations.github.reviews.submit>["event"];
export type SubmittedReview = FunctionReturnType<typeof api.integrations.github.reviews.submit>;
type PostedComment = PullRequestOverview["reviewComments"][number];

const SIDES: Record<SelectionSide, Side> = { additions: "RIGHT", deletions: "LEFT" };
const ANNOTATION_SIDES: Record<Side, SelectionSide> = { RIGHT: "additions", LEFT: "deletions" };
const short = (sha: string) => sha.slice(0, 7);
/** "Line 5", or "Lines 40–43" for a range. */
const lineLabel = ({ startLine, line }: LineAnchor) => (startLine === undefined ? `Line ${line}` : `Lines ${startLine}–${line}`);
const toInline = ({ path, startLine, startSide, line, side, body }: PendingComment) => ({
  path,
  ...(startLine === undefined ? {} : { startLine, startSide }),
  line,
  side,
  body,
});

function isPendingComment(value: unknown): value is PendingComment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.path === "string" &&
    (value.side === "LEFT" || value.side === "RIGHT") &&
    typeof value.line === "number" &&
    (value.startLine === undefined || typeof value.startLine === "number") &&
    (value.startSide === undefined || value.startSide === "LEFT" || value.startSide === "RIGHT") &&
    typeof value.body === "string"
  );
}

function readDraft(key: string | null): Draft | null {
  const value = key ? readLocalJson(key) : null;
  if (!isRecord(value) || typeof value.headSha !== "string" || typeof value.body !== "string" || !Array.isArray(value.comments)) return null;
  return { headSha: value.headSha, body: value.body, comments: value.comments.filter(isPendingComment) };
}

/** Why the member can't review, or null. GitHub lets anyone who can read the repository review, at a revision they read. */
function reviewBlocker({ account, noAccess, archived }: GithubCommenting, headSha: string | null): string | null {
  if (!account) return "Connect GitHub first";
  if (account.status !== "active") return "Reconnect GitHub first";
  if (archived) return "This pull request is archived";
  if (noAccess) return `@${account.login} has no access to this repository on GitHub`;
  if (!headSha) return "The changes haven't loaded yet";
  return null;
}

/** The member's review draft for one PR, and the writes that submit it. `headSha` is the displayed revision. */
export function usePullRequestReview({
  projectId,
  repositoryId,
  number,
  commenting,
  draftKey,
  headSha,
  author,
  onSubmitted,
}: {
  projectId: Id<"projects">;
  repositoryId: string;
  number: number;
  commenting: GithubCommenting;
  /** Each member's draft sits under their GitHub account id. */
  draftKey: string;
  headSha: string | null;
  author: string;
  onSubmitted: (submitted: SubmittedReview) => void;
}) {
  const submitReview = useAction(api.integrations.github.reviews.submit);
  const account = commenting.account;
  const key = account ? `${draftKey}:${account.githubUserId}` : null;
  const [held, setHeld] = useState(() => ({ key, draft: readDraft(key) }));
  if (held.key !== key) setHeld({ key, draft: readDraft(key) });
  const draft = held.key === key ? held.draft : readDraft(key);
  const save = (next: Draft | null) => {
    setHeld({ key, draft: next });
    if (!key) return;
    if (next && (next.body || next.comments.length)) writeLocalJson(key, next);
    else removeLocalValue(key);
  };
  const comments = draft?.comments ?? [];
  // Comments left on an older revision post there, so they stay on the lines they were written for.
  const staleHead = comments.length && draft && draft.headSha !== headSha ? draft.headSha : null;
  const post = (event: ReviewEvent, body: string, inline: PendingComment[], at: string) =>
    submitReview({ projectId, repositoryId, number, headSha: at, event, body, comments: inline.map(toInline) }).then(
      onSubmitted,
      (error: unknown) => {
        showConvexErrorToast(error, "Could not submit the review");
        throw error;
      }
    );
  const blocker = reviewBlocker(commenting, headSha);
  return {
    blocker,
    headSha,
    /** GitHub lets an author only comment on their own PR. */
    isAuthor: account?.login.toLowerCase() === author.toLowerCase(),
    body: draft?.body ?? "",
    comments,
    staleHead,
    /** Pending comments on the displayed revision, shown on their lines. */
    pending: staleHead ? [] : comments,
    setBody: (body: string) => headSha && save({ headSha: draft?.headSha ?? headSha, comments, body }),
    add: (anchor: LineAnchor, body: string) =>
      headSha && save({ headSha: comments.length ? (draft?.headSha ?? headSha) : headSha, body: draft?.body ?? "", comments: [...comments, { ...anchor, body, id: crypto.randomUUID() }] }),
    edit: (id: string, body: string) => draft && save({ ...draft, comments: comments.map((comment) => (comment.id === id ? { ...comment, body } : comment)) }),
    remove: (id: string) => draft && save({ ...draft, comments: comments.filter((comment) => comment.id !== id) }),
    /** Discard review: drops the body and every pending comment. */
    discard: () => save(null),
    /** Add single comment: a comment review holding just this line's comment. */
    postSingle: (anchor: LineAnchor, body: string) =>
      headSha ? post("comment", "", [{ ...anchor, body, id: "" }], headSha) : Promise.reject(new Error("The changes haven't loaded yet")),
    submit: (event: ReviewEvent) => {
      const at = staleHead ?? headSha;
      if (!at) return Promise.reject(new Error("The changes haven't loaded yet"));
      const body = draft?.body ?? "";
      const sent = new Set(comments.map((comment) => comment.id));
      // Clears only what was sent: text typed while GitHub answered stays, read back from storage.
      return post(event, body, comments, at).then(() => {
        const latest = readDraft(key);
        save(latest && { ...latest, body: latest.body === body ? "" : latest.body, comments: latest.comments.filter((comment) => !sent.has(comment.id)) });
      });
    },
  };
}

export type PullRequestReview = ReturnType<typeof usePullRequestReview>;

const EVENTS: { event: ReviewEvent; label: string; description: string; own: string }[] = [
  { event: "comment", label: "Comment", description: "Submit general feedback without explicit approval.", own: "" },
  { event: "approve", label: "Approve", description: "Give your approval to merge these changes.", own: "You can't approve your own pull request." },
  {
    event: "request_changes",
    label: "Request changes",
    description: "Submit feedback that must be addressed before merging.",
    own: "You can't request changes on your own pull request.",
  },
];

const pendingLabel = (count: number) => (count === 1 ? "1 pending comment" : `${count} pending comments`);

/** The header's Submit review button and GitHub's Finish your review popover: body, verdict, and the pending comments. */
export function ReviewButton({ review, onJump }: { review: PullRequestReview; onJump: (comment: PendingComment) => void }) {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>("comment");
  const [submitting, setSubmitting] = useState(false);
  const titleId = useId();
  const count = review.comments.length;
  const trigger = (
    <Button variant="outline" size="sm" className="gap-1.5" disabled={review.blocker !== null} title={review.blocker ?? (count ? pendingLabel(count) : undefined)}>
      Submit review
      {count ? (
        <>
          <Badge aria-hidden className="h-4 px-1.5 text-[10px] tabular-nums">
            {count}
          </Badge>
          <span className="sr-only">, {pendingLabel(count)}</span>
        </>
      ) : null}
    </Button>
  );
  if (review.blocker) return trigger;
  const picked = review.isAuthor ? "comment" : event;
  const body = review.body.trim();
  const ready = picked === "approve" || (picked === "request_changes" ? body : body || count);
  const submit = () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    review
      .submit(picked)
      .then(() => setOpen(false))
      .catch(() => {})
      .finally(() => setSubmitting(false));
  };
  return (
    <Popover open={open} onOpenChange={(next) => !submitting && setOpen(next)}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId} className="w-[30rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <h2 id={titleId} className="text-sm font-semibold">
            Finish your review
          </h2>
          <Button variant="ghost" size="icon-sm" className="-mr-1.5 size-7" aria-label="Close" onClick={() => setOpen(false)} disabled={submitting}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-4 p-4">
          <Textarea
            aria-label="Review comment"
            placeholder="Leave a comment"
            value={review.body}
            onChange={(change) => review.setBody(change.target.value)}
            onKeyDown={(key) => {
              if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) {
                key.preventDefault();
                submit();
              }
            }}
            className="min-h-28 text-sm"
          />
          <fieldset className="space-y-3" aria-label="Review verdict">
            {EVENTS.map((option) => {
              const disabled = review.isAuthor && option.event !== "comment";
              return (
                <label key={option.event} className="flex cursor-pointer items-start gap-2.5 has-disabled:cursor-default has-disabled:opacity-60">
                  <input
                    type="radio"
                    name="review-event"
                    aria-label={option.label}
                    className="sr-only"
                    checked={picked === option.event}
                    disabled={disabled}
                    onChange={() => setEvent(option.event)}
                  />
                  <RadioIndicator checked={picked === option.event} disabled={disabled} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{disabled ? option.own : option.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {count ? <PendingComments review={review} onJump={(comment) => {
                setOpen(false);
                onJump(comment);
              }} /> : null}
        </div>
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <Button variant="destructive" size="sm" disabled={submitting || !(review.body || count)} onClick={review.discard}>
            Discard review
          </Button>
          <Button variant="outline" size="sm" className="ml-auto" disabled={submitting} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready || submitting} onClick={submit} aria-keyshortcuts="Meta+Enter Control+Enter">
            {submitting ? <Spinner /> : null}
            Submit review
            <Kbd aria-hidden className="bg-primary-foreground/15 text-primary-foreground">
              {getHotkeyKeycaps("Mod")[0]}↵
            </Kbd>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The popover's list of pending comments, as on GitHub: each opens to its text and jumps to its line. */
function PendingComments({ review, onJump }: { review: PullRequestReview; onJump: (comment: PendingComment) => void }) {
  const [listOpen, setListOpen] = useState(false);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setShown((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <section aria-label="Pending comments" className="space-y-2">
      <button type="button" className="flex items-center gap-1.5 text-sm font-medium" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
        <ChevronRight className={cn("size-4 transition-transform", listOpen && "rotate-90")} />
        Pending comments
        <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">
          {review.comments.length}
        </Badge>
      </button>
      {listOpen ? (
        <div className="divide-y overflow-hidden rounded-md border">
          {review.comments.map((comment) => (
            <div key={comment.id}>
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 shrink-0"
                  aria-label={`Show comment on ${comment.path}`}
                  aria-expanded={shown.has(comment.id)}
                  onClick={() => toggle(comment.id)}
                >
                  <ChevronRight className={cn("size-3.5 transition-transform", shown.has(comment.id) && "rotate-90")} />
                </Button>
                <span className="min-w-0 truncate font-mono font-medium" title={comment.path}>
                  {comment.path}
                </span>
                <span className="shrink-0 text-muted-foreground">{lineLabel(comment)}</span>
                {/* An older revision's comments aren't on the displayed lines. */}
                {review.staleHead ? null : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto size-6 shrink-0"
                    aria-label={`Go to comment on ${comment.path}`}
                    title="Go to comment"
                    onClick={() => onJump(comment)}
                  >
                    <SquareArrowOutUpRight className="size-3.5" />
                  </Button>
                )}
              </div>
              {shown.has(comment.id) ? <p className="px-10 pb-2 text-sm whitespace-pre-wrap">{comment.body}</p> : null}
            </div>
          ))}
          {review.staleHead ? (
            <p className="bg-warning-soft px-3 py-1.5 text-xs text-warning">
              Written on {short(review.staleHead)}, before the latest push. They post on that commit.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const anchorOf = ({ path, line, side, startLine, startSide }: LineEditor): LineAnchor =>
  startLine === undefined ? { path, line, side } : { path, line, side, startLine, startSide };

/** The comment editor open on a line, or on a pending comment being edited. */
export type LineEditor = LineAnchor & { editing?: string };
type LineThread = { anchor: LineAnchor; posted: PostedComment[]; pending: PendingComment[]; editor: LineEditor | null };

/** Opens the editor from the diff's gutter "+": a click is one line, a drag (either way) a range. */
export function toLineEditor(path: string, range: SelectedLineRange): LineEditor {
  const first = { line: range.start, side: SIDES[range.side ?? "additions"] };
  const last = { line: range.end, side: SIDES[range.endSide ?? range.side ?? "additions"] };
  // ponytail: orders by line number, which misorders a drag across sides in a unified diff; GitHub refuses that one.
  const [start, end] = first.line > last.line ? [last, first] : [first, last];
  const single = start.line === end.line && start.side === end.side;
  return { path, ...end, ...(single ? {} : { startLine: start.line, startSide: start.side }) };
}

/** One file's inline comments as diff annotations: GitHub's on the displayed revision, the pending ones, and the open editor. */
export function fileLineComments({
  path,
  posted,
  review,
  editor,
  onEditorChange,
}: {
  path: string;
  posted: PostedComment[];
  review: PullRequestReview;
  editor: LineEditor | null;
  onEditorChange: (editor: LineEditor | null) => void;
}) {
  const threads = new Map<string, LineThread>();
  const thread = (anchor: LineAnchor) => {
    const key = `${anchor.side}:${anchor.line}`;
    const existing = threads.get(key) ?? { anchor: { path, side: anchor.side, line: anchor.line }, posted: [], pending: [], editor: null };
    threads.set(key, existing);
    return existing;
  };
  for (const comment of posted) if (comment.path === path && !comment.outdated && comment.line !== null) thread({ ...comment, line: comment.line }).posted.push(comment);
  for (const comment of review.pending) if (comment.path === path) thread(comment).pending.push(comment);
  if (editor?.path === path) thread(editor).editor = editor;
  const annotations: DiffLineAnnotation<LineThread>[] = [...threads.values()].map((metadata) => ({
    side: ANNOTATION_SIDES[metadata.anchor.side],
    lineNumber: metadata.anchor.line,
    metadata,
  }));
  const renderAnnotation = ({ metadata }: DiffLineAnnotation<LineThread>) => (
    <LineThreadView thread={metadata} review={review} onEditorChange={onEditorChange} />
  );
  // The open editor's lines stay highlighted, as a drag leaves them.
  const selectedLines: SelectedLineRange | null =
    editor?.path === path
      ? { start: editor.startLine ?? editor.line, side: ANNOTATION_SIDES[editor.startSide ?? editor.side], end: editor.line, endSide: ANNOTATION_SIDES[editor.side] }
      : null;
  return { annotations, renderAnnotation, selectedLines };
}

function LineThreadView({ thread, review, onEditorChange }: { thread: LineThread; review: PullRequestReview; onEditorChange: (editor: LineEditor | null) => void }) {
  const close = () => onEditorChange(null);
  const { editor } = thread;
  return (
    <div className="mx-3 my-2 space-y-2 font-sans">
      {thread.posted.map((comment) => (
        <LineComment key={comment.id} author={comment.author} avatarUrl={comment.authorAvatarUrl} meta={<a href={comment.url} target="_blank" rel="noreferrer" className="hover:underline">{formatDistanceToNow(comment.createdAt, { addSuffix: true })}</a>}>
          <GithubMarkdown>{comment.body}</GithubMarkdown>
        </LineComment>
      ))}
      {thread.pending.map((comment) =>
        editor?.editing === comment.id ? (
          <LineCommentEditor
            key={comment.id}
            initial={comment.body}
            onCancel={close}
            actions={(body) => [{ label: "Save", primary: true, run: async () => {
                  review.edit(comment.id, body);
                  close();
                }, }]}
          />
        ) : (
          <LineComment
            key={comment.id}
            author="You"
            avatarUrl={null}
            data-pending-comment={comment.id}
            meta={
              <>
                <Badge variant="outline" className="h-4 px-1.5 text-[10px]">Pending</Badge>
                {comment.startLine === undefined ? null : <span>{lineLabel(comment)}</span>}
              </>
            }
            actions={
              <>
                <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Edit pending comment" onClick={() => onEditorChange({ path: comment.path, line: comment.line, side: comment.side, startLine: comment.startLine, startSide: comment.startSide, editing: comment.id })}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Delete pending comment" onClick={() => review.remove(comment.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            }
          >
            <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
          </LineComment>
        )
      )}
      {editor && !editor.editing ? (
        <LineCommentEditor
          initial=""
          heading={editor.startLine === undefined ? undefined : `Commenting on lines ${editor.startLine}–${editor.line}`}
          onCancel={close}
          actions={(body) => [
            { label: "Add single comment", run: () => review.postSingle(anchorOf(editor), body).then(close) },
            {
              label: review.comments.length ? "Add review comment" : "Start a review",
              primary: true,
              blocked: review.staleHead ? `Submit or discard your pending comments on ${short(review.staleHead)} first` : undefined,
              run: async () => {
                review.add(anchorOf(editor), body);
                close();
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}

function LineComment({
  author,
  avatarUrl,
  meta,
  actions,
  children,
  ...data
}: { author: string; avatarUrl: string | null; meta: ReactNode; actions?: ReactNode; children: ReactNode; "data-pending-comment"?: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2.5 shadow-sm" {...data}>
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <Avatar className="size-4">
          <AvatarImage src={avatarUrl ?? undefined} />
          <AvatarFallback className="text-[8px]">{author.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="font-medium text-foreground">{author}</span>
        {meta}
        {actions ? <span className="-my-1 ml-auto flex gap-0.5">{actions}</span> : null}
      </div>
      {children}
    </div>
  );
}

type EditorAction = { label: string; primary?: boolean; blocked?: string; run: () => Promise<void> };

function LineCommentEditor({
  initial,
  heading,
  onCancel,
  actions,
}: {
  initial: string;
  /** Names a range; a single line needs none. */
  heading?: string;
  onCancel: () => void;
  actions: (body: string) => EditorAction[];
}) {
  const [body, setBody] = useState(initial);
  const [running, setRunning] = useState<string | null>(null);
  const text = body.trim();
  const buttons = actions(text);
  const run = (action: EditorAction) => {
    setRunning(action.label);
    action.run().catch(() => setRunning(null));
  };
  return (
    <InputGroup className="bg-background shadow-sm dark:bg-background">
      {heading ? (
        <InputGroupAddon align="block-start" className="border-b text-xs text-muted-foreground">
          {heading}
        </InputGroupAddon>
      ) : null}
      <InputGroupTextarea
        autoFocus
        aria-label="Line comment"
        value={body}
        // What a post sends is what it shows, so nothing typed while it runs is lost.
        disabled={running !== null}
        onChange={(change) => setBody(change.target.value)}
        placeholder="Leave a comment on GitHub..."
        className="min-h-16 text-sm"
        onKeyDown={(key) => {
          if (key.key === "Escape") {
            key.preventDefault();
            onCancel();
          }
        }}
      />
      <InputGroupAddon align="block-end" className="justify-end">
        <InputGroupButton onClick={onCancel} disabled={running !== null}>
          Cancel
        </InputGroupButton>
        {buttons.map((action) => (
          <InputGroupButton
            key={action.label}
            variant={action.primary ? "default" : "outline"}
            disabled={!text || running !== null || action.blocked !== undefined}
            title={action.blocked}
            onClick={() => run(action)}
          >
            {running === action.label ? <Spinner /> : null}
            {action.label}
          </InputGroupButton>
        ))}
      </InputGroupAddon>
    </InputGroup>
  );
}

const REVIEWER_MARKS = { all: "review requested", some: "review requested on some", none: "not requested" };

/** The Overview's Reviewers edit button; GitHub's answer replaces the held requested reviewers. */
export function ReviewersButton({
  projectId,
  repositoryId,
  number,
  author,
  requested,
  blocker,
  onChange,
}: {
  projectId: Id<"projects">;
  repositoryId: string;
  number: number;
  author: string;
  requested: string[];
  /** Why the member can't request reviews, or null. */
  blocker: string | null;
  onChange: (requested: string[]) => void;
}) {
  const request = useAction(api.integrations.github.reviews.requestReviewer);
  // One write at a time, as for assignees: each answer replaces the whole list.
  const [pending, setPending] = useState(false);
  const button = (
    <Button variant="ghost" size="icon-sm" aria-label="Request reviewers" title={blocker ?? "Request reviewers"} disabled={blocker !== null || pending} className="-my-1.5 size-7">
      {pending ? <Spinner /> : <Pencil className="size-3.5" />}
    </Button>
  );
  if (blocker) return button;
  return (
    <AssignPicker
      projectId={projectId}
      sources={[{ repositoryId, number }]}
      assignments={[requested]}
      labels={REVIEWER_MARKS}
      omit={author}
      onToggle={(login, requesting) => {
        setPending(true);
        request({ projectId, repositoryId, number, login, requested: requesting })
          .then(onChange, (error: unknown) => showConvexErrorToast(error, "Could not change the reviewers"))
          .finally(() => setPending(false));
      }}
    >
      {button}
    </AssignPicker>
  );
}
