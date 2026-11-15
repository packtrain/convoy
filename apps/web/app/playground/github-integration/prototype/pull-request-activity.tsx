import { useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, GitCommitHorizontal, Github, GitPullRequest, Layers, MessageSquare, MessageSquareMore } from "lucide-react";
import { CommentInput, CommentItem } from "@/components/blocks/tasks/comments";
import { TimelineHeader, type TimelineComposerMode } from "@/components/blocks/tasks/task-timeline";
import { CompactThreadRowContent } from "@/components/blocks/thread/compact-thread-row-content";
import { ThreadComposer } from "@/components/blocks/thread/thread-composer";
import type { WorkingDirectorySelectorProfile } from "@/components/blocks/thread/working-directory-selector";
import type { Id } from "@/convex/_generated/dataModel";
import type { TimelineSources } from "@/convex/tasks/lib/timeline/validators";
import type { TimelineSortDirection } from "@/lib/tasks/timeline/rows";
import type { Comment } from "@/lib/tasks/types";
import type { CliTypeSlug, ThreadStatus } from "@/lib/threads/types";
import { cn } from "@/lib/utils";
import { CommitSha } from "./controls";
import { avatarUrl, displayName } from "./people-picker";
import { commitsFor, prKey, reviewsFor, type PrComment, type PullRequest } from "./fixtures";

const ago = (at: number) => formatDistanceToNow(at, { addSuffix: true });

export type Thread = { id: string; title: string; status: ThreadStatus; cliType: CliTypeSlug; at: number };

type Entry =
  | { kind: "activity"; key: string; at: number; icon: ReactNode; text: ReactNode }
  | { kind: "comment"; key: string; at: number; comment: PrComment }
  | { kind: "thread"; key: string; at: number; thread: Thread };

/** A thread prompt pushed in from outside, e.g. a check card's Fix; a new `key` re-seeds the composer. */
export type ComposerSeed = { text: string; key: number };

// ponytail: one offline profile so the real selectors have something to show.
const PROFILE: WorkingDirectorySelectorProfile = {
  _id: "playground-profile" as Id<"cliProfiles">,
  name: "workstation",
  hostname: "workstation.local",
  isOnline: true,
  paths: [{ id: "p1", path: "~/src/convoy", label: "convoy" }],
};

// The task sidebar's timeline (docs/specs/task-timeline.md) over GitHub's conversation:
// the same header, composer swap, and rows, on prototype state.
export function PullRequestActivity({
  pr,
  refreshed,
  comments,
  currentUser,
  mode,
  onModeChange,
  seed,
  focusKey,
  threads,
  onThreadStarted,
  onCommentsChange,
  onConnect,
  onExternal,
  onNotice,
}: {
  pr: PullRequest;
  refreshed: boolean;
  comments: PrComment[];
  currentUser: string | null;
  mode: TimelineComposerMode;
  onModeChange: (mode: TimelineComposerMode) => void;
  seed?: ComposerSeed;
  /** Changes when something outside asks to focus the thread composer. */
  focusKey: number;
  threads: Thread[];
  onThreadStarted: (text: string) => void;
  onCommentsChange: (comments: PrComment[]) => void;
  onConnect: () => void;
  onExternal: () => void;
  onNotice: (message: string) => void;
}) {
  const [sources, setSources] = useState<TimelineSources>({ comments: true, threads: true, activity: true });
  const [sort, setSort] = useState<TimelineSortDirection>("desc");
  const opened = commitsFor(pr, false);
  const entries: Entry[] = [
    ...(sources.activity
      ? [
          { kind: "activity" as const, key: "opened", at: pr.createdAt, icon: <GitPullRequest className="size-3.5 text-green-600" />, text: `${displayName(pr.author)} opened this with ${opened.length} commits` },
          ...(pr.stack ? [{ kind: "activity" as const, key: "stack", at: pr.createdAt + 1, icon: <Layers className="size-3.5" />, text: `Added to stack #${pr.stack}` }] : []),
          ...commitsFor(pr, refreshed).map((commit) => ({
            kind: "activity" as const,
            key: `commit:${commit.sha}`,
            at: commit.committedAt,
            icon: <GitCommitHorizontal className="size-3.5" />,
            text: <>{displayName(commit.author)} committed <span className="text-foreground">{commit.message}</span> <CommitSha sha={commit.sha} onExternal={onExternal} /></>,
          })),
          ...reviewsFor(pr)
            .filter((review) => review.state === "approved")
            .map((review) => ({ kind: "activity" as const, key: `review:${review.reviewer}`, at: review.at, icon: <Check className="size-3.5 text-green-600" />, text: `${displayName(review.reviewer)} approved these changes` })),
        ]
      : []),
    ...(sources.comments ? comments.map((comment) => ({ kind: "comment" as const, key: comment.id, at: comment.createdAt, comment })) : []),
    ...(sources.threads ? threads.map((thread) => ({ kind: "thread" as const, key: thread.id, at: thread.at, thread })) : []),
  ].sort((a, b) => (sort === "asc" ? a.at - b.at : b.at - a.at));

  // Consecutive activity rows share one rail, as in the task timeline.
  const blocks: Entry[][] = [];
  for (const entry of entries) {
    const last = blocks.at(-1);
    if (entry.kind === "activity" && last?.[0].kind === "activity") last.push(entry);
    else blocks.push([entry]);
  }

  const toComment = (comment: PrComment): Comment => ({
    _id: comment.id as Id<"taskComments">,
    _creationTime: comment.createdAt,
    taskId: prKey(pr) as Id<"tasks">,
    authorId: comment.author as Id<"users">,
    authorName: displayName(comment.author),
    authorAvatarUrl: avatarUrl(comment.author),
    content: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.createdAt,
    isEdited: !!comment.edited,
    attachments: [],
    canEdit: !pr.archived && comment.author === currentUser,
    canDelete: !pr.archived && comment.author === currentUser,
  });

  const stream = (
    <div key="stream">
      {!sources.activity && !sources.comments && !sources.threads ? (
        <p className="py-4 text-sm text-muted-foreground">Every source is hidden. Turn one on to see this pull request&apos;s activity.</p>
      ) : null}
      {blocks.map((block) => {
        const first = block[0];
        if (first.kind === "activity") return <ActivityGroup key={first.key} entries={block} />;
        if (first.kind === "comment") {
          return (
            <div key={first.key} className="py-3">
              <CommentItem
                comment={toComment(first.comment)}
                onUpdate={async (id, body) => onCommentsChange(comments.map((comment) => (comment.id === id ? { ...comment, body, edited: true } : comment)))}
                onDelete={async (id) => onCommentsChange(comments.filter((comment) => comment.id !== id))}
              />
            </div>
          );
        }
        return <ThreadRow key={first.key} thread={first.thread} onOpen={() => onNotice(`This would open ${first.thread.title}.`)} />;
      })}
    </div>
  );

  const composer = (
    <Composer
      key="composer"
      pr={pr}
      // Comments post to GitHub as the user, so without an account only threads remain.
      mode={currentUser ? mode : "thread"}
      canComment={!!currentUser}
      sort={sort}
      seed={seed}
      focusKey={focusKey}
      onModeChange={onModeChange}
      onConnect={onConnect}
      onNotice={onNotice}
      onComment={(body) => currentUser && onCommentsChange([...comments, { id: `${prKey(pr)}:${Date.now()}`, author: currentUser, body, createdAt: Date.now() }])}
      onThread={onThreadStarted}
    />
  );

  return (
    <div className="flex flex-col">
      <div className="-mx-4">
        <TimelineHeader
          sources={sources}
          sortDirection={sort}
          onToggleSource={(source, enabled) => setSources({ ...sources, [source]: enabled })}
          onSortDirectionChange={setSort}
          hasThreadSource
        />
      </div>
      {sort === "asc" ? [stream, composer] : [composer, stream]}
    </div>
  );
}

function ActivityGroup({ entries }: { entries: Entry[] }) {
  return (
    <div className="relative py-1 pl-8">
      <span aria-hidden className="absolute top-4 bottom-4 left-[13px] w-px bg-border" />
      {entries.map((entry) =>
        entry.kind === "activity" ? (
          <div key={entry.key} className="flex items-start gap-2 py-1.5">
            <span className="absolute left-1 flex size-5 items-center justify-center bg-background text-muted-foreground">{entry.icon}</span>
            <p className="text-sm leading-5 text-muted-foreground">
              {entry.text}
              <span className="text-xs whitespace-nowrap"> · {ago(entry.at)}</span>
            </p>
          </div>
        ) : null,
      )}
    </div>
  );
}

function ThreadRow({ thread, onOpen }: { thread: Thread; onOpen: () => void }) {
  return (
    <div className="py-1">
      <div className="group relative rounded-md border border-border bg-card transition-colors hover:bg-muted">
        <button type="button" onClick={onOpen} className="absolute inset-0 z-0 cursor-pointer" aria-label={`Open thread ${thread.title}`} />
        <CompactThreadRowContent title={thread.title} status={thread.status} cliType={thread.cliType} lastActivityAt={thread.at} forceStatusIndicator />
      </div>
    </div>
  );
}

/** One composer open at a time, the other collapsed to a trigger row facing the stream. */
function Composer({
  pr,
  mode,
  canComment,
  sort,
  seed,
  focusKey,
  onModeChange,
  onConnect,
  onNotice,
  onComment,
  onThread,
}: {
  pr: PullRequest;
  mode: TimelineComposerMode;
  canComment: boolean;
  sort: TimelineSortDirection;
  seed?: ComposerSeed;
  focusKey: number;
  onModeChange: (mode: TimelineComposerMode) => void;
  onConnect: () => void;
  onNotice: (message: string) => void;
  onComment: (body: string) => void;
  onThread: (text: string) => void;
}) {
  const [cliType, setCliType] = useState<CliTypeSlug>("claude-code");
  const [threadKey, setThreadKey] = useState(0);
  if (pr.archived) {
    return <p key="composer" className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">This pull request is archived. Unarchive it to comment.</p>;
  }
  const trigger = !canComment ? (
    <Trigger key="trigger" icon={Github} label="Connect GitHub to comment..." onClick={onConnect} />
  ) : mode === "thread" ? (
    <Trigger key="trigger" icon={MessageSquare} label="Add comment..." onClick={() => onModeChange("comment")} />
  ) : (
    <Trigger key="trigger" icon={MessageSquareMore} label="Start a thread..." onClick={() => onModeChange("thread")} />
  );
  // Both stay mounted so switching keeps the drafts.
  const composers = (
    <div key="composers">
      {canComment ? (
        <div className={mode === "comment" ? "block" : "hidden"}>
          <CommentInput
            placeholder="Leave a comment…"
            pendingAttachments={[]}
            onAddFiles={() => onNotice("GitHub's API can't upload comment attachments. Convoy would host the file and link it in the comment.")}
            onRemoveAttachment={() => {}}
            onSubmit={async (body) => onComment(body)}
          />
        </div>
      ) : null}
      <div className={mode === "thread" ? "block" : "hidden"}>
        <ThreadComposer
          key={threadKey}
          initialInput={seed?.text}
          seedKey={seed ? String(seed.key) : undefined}
          focusRequestKey={focusKey}
          onSubmit={({ text }) => {
            if (!text.trim()) return;
            onThread(text.trim());
            setThreadKey((value) => value + 1);
          }}
          textareaPlaceholder={`Start a thread about #${pr.number}...`}
          containerClassName="p-0"
          contentClassName="max-w-none"
          textareaClassName="min-h-[88px] p-3"
          selectorsProps={{
            profiles: [PROFILE],
            profileId: String(PROFILE._id),
            pathId: "p1",
            cliType,
            mode: undefined,
            cliModel: undefined,
            onCliTypeChange: setCliType,
            onModeChange: () => {},
          }}
        />
      </div>
    </div>
  );
  return <div className={cn("space-y-2", sort === "asc" ? "pt-2" : "pb-2")}>{sort === "asc" ? [trigger, composers] : [composers, trigger]}</div>;
}

function Trigger({ icon: Icon, label, onClick }: { icon: typeof MessageSquare; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex cursor-pointer items-center gap-2.5 py-1 pl-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}
