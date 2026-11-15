"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Bot,
  Calendar,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  ListTree,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Tag,
  Tags,
  Trash2,
  Type,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageResponse } from "@/components/ai-elements/message";
import { useAppUser } from "@/lib/auth/hooks";
import { CommentInput, CommentItem } from "@/components/blocks/tasks/comments";
import type { CommentPendingAttachment } from "@/components/blocks/tasks/comments/comment-input";
import { PriorityIcon, StatusBadge, StatusIcon } from "@/components/blocks/tasks/task-table/badges";
import { TaskLabelChip } from "@/components/blocks/tasks/task-label-picker";
import { TaskType } from "@/components/blocks/tasks/task-ref-with-type";
import { resolveTaskTypeSummary } from "@/lib/tasks/task-types";
import { ThreadComposer } from "@/components/blocks/thread/thread-composer";
import type { WorkingDirectorySelectorProfile } from "@/components/blocks/thread/working-directory-selector";
import { CompactThreadRowContent } from "@/components/blocks/thread/compact-thread-row-content";
import { ThreadPrBadge } from "@/components/blocks/thread/thread-pr-badge";
import type { ThreadStatus } from "@/lib/threads/types";
import type { ThreadPullRequest } from "@/lib/threads/pull-request";
import { Status } from "@/lib/tasks/status";
import { Priority } from "@/lib/tasks/priority";
import type { Comment } from "@/lib/tasks/types";
import { CLI_TYPE_MAP, renderCliIcon, type CliTypeSlug } from "@/lib/cli-runtime-ui/registry";
import type { Id } from "@/convex/_generated/dataModel";

// ponytail: static seed data + local state only — no Convex, routing, or persistence.
// Replace the seed array with a merged (comments + threads + activity) query when wiring up.
// Everything inside a row is a real app component; only the row layout is new.

type TimelineEntry =
  | {
      kind: "activity";
      id: string;
      icon: ReactNode;
      text: ReactNode;
      time: string;
    }
  | { kind: "comment"; id: string; comment: Comment }
  | {
      kind: "thread";
      id: string;
      cliType: CliTypeSlug;
      pullRequest?: ThreadPullRequest;
      title: string;
      /** Markdown — rendered with the same renderer as agent messages. */
      summary: string;
      time: string;
    }
  | {
      kind: "compact-thread";
      id: string;
      cliType: CliTypeSlug;
      title: string;
      status: ThreadStatus;
      minutesAgo: number;
      /** Absent = the viewer's own thread, which needs no attribution. */
      owner?: { name: string };
    };

const activityIcon = "size-3.5 shrink-0 text-muted-foreground";

const SEED_PULL_REQUEST: ThreadPullRequest = {
  provider: "github",
  number: 4,
  title: "Corporate card decline logic",
  url: "https://github.com/example/rides/pull/4",
  state: "open",
  headBranch: "fix/card-decline-lock",
  baseBranch: "main",
  capturedAt: 0,
};

function seedComment(id: string, authorName: string, content: string, minutesAgo: number): Comment {
  const createdAt = Date.now() - minutesAgo * 60_000;
  return {
    _id: `${id}-comment` as Id<"taskComments">,
    _creationTime: createdAt,
    taskId: "seed-task" as Id<"tasks">,
    authorId: `${id}-author` as Id<"users">,
    authorName,
    authorAvatarUrl: null,
    content,
    createdAt,
    updatedAt: createdAt,
    isEdited: false,
    attachments: [],
    canEdit: false,
    canDelete: false,
  };
}

// Every row below maps to a real `taskActivityLogs` eventType — wording and
// icons mirror `components/blocks/activity/activity-item.tsx`. `comment_added`
// is deliberately absent: in a unified timeline the comment itself is the row.
const buildSeed = (): TimelineEntry[] => [
  {
    kind: "activity",
    id: "created",
    icon: <Plus className={activityIcon} />,
    text: <>Lena Ortiz created this task</>,
    time: "about 2 hours ago",
  },
  {
    kind: "activity",
    id: "name_edited",
    icon: <Type className={activityIcon} />,
    text: <>Lena Ortiz updated the name</>,
    time: "about 2 hours ago",
  },
  {
    kind: "activity",
    id: "description_edited",
    icon: <FileText className={activityIcon} />,
    text: <>Lena Ortiz updated the description</>,
    time: "about 2 hours ago",
  },
  {
    kind: "activity",
    id: "label_changed",
    icon: <Tag className={activityIcon} />,
    text: (
      <>
        Lena Ortiz set label to <TaskLabelChip label={{ name: "Bug", color: "#ef4444" }} />
      </>
    ),
    time: "about 2 hours ago",
  },
  {
    kind: "activity",
    id: "priority_changed",
    icon: <PriorityIcon priority={Priority.HIGH} />,
    text: (
      <>
        Lena Ortiz changed priority from <span className="text-foreground">None</span>{" "}
        <ArrowRight className="inline size-3" /> <span className="text-foreground">High</span>
      </>
    ),
    time: "about 2 hours ago",
  },
  {
    kind: "activity",
    id: "list_changed",
    icon: <ListTree className={activityIcon} />,
    text: (
      <>
        Lena Ortiz moved from <span className="text-foreground">Inbox</span>{" "}
        <ArrowRight className="inline size-3" /> <span className="text-foreground">Now</span>
      </>
    ),
    time: "about 1 hour ago",
  },
  {
    kind: "activity",
    id: "assignee_changed",
    icon: <User className={activityIcon} />,
    text: (
      <>
        Morgan Doe changed assignee from <span className="text-foreground">Unassigned</span>{" "}
        <ArrowRight className="inline size-3" /> <span className="text-foreground">Lena Ortiz</span>
      </>
    ),
    time: "about 1 hour ago",
  },
  {
    kind: "activity",
    id: "due_date_changed",
    icon: <Calendar className={activityIcon} />,
    text: (
      <>
        Morgan Doe changed due date from <span className="text-foreground">none</span>{" "}
        <ArrowRight className="inline size-3" /> <span className="text-foreground">Aug 3, 2026</span>
      </>
    ),
    time: "about 1 hour ago",
  },
  {
    kind: "comment",
    id: "c1",
    comment: seedComment(
      "c1",
      "Lena Ortiz",
      "Repro is only on shared corporate cards — the decline happens when two riders hit the same card inside the same second. Looks like we collapse both attempts into a single `memberId`.",
      58
    ),
  },
  {
    kind: "activity",
    id: "attachment_added",
    icon: <Paperclip className={activityIcon} />,
    text: (
      <>
        Lena Ortiz added attachment <span className="text-foreground">&quot;decline-trace.har&quot;</span>
      </>
    ),
    time: "55 minutes ago",
  },
  {
    kind: "activity",
    id: "attachment_removed",
    icon: <Paperclip className={activityIcon} />,
    text: (
      <>
        Lena Ortiz removed attachment <span className="text-foreground">&quot;decline-trace-old.har&quot;</span>
      </>
    ),
    time: "54 minutes ago",
  },
  {
    kind: "activity",
    id: "parent_changed",
    icon: <GitBranch className={activityIcon} />,
    text: (
      <>
        Morgan Doe moved from <span className="text-foreground">top-level</span>{" "}
        <ArrowRight className="inline size-3" />{" "}
        <span className="text-foreground">Payments hardening</span>
      </>
    ),
    time: "50 minutes ago",
  },
  {
    kind: "activity",
    id: "status_changed",
    icon: <StatusIcon status={Status.IN_PROGRESS} className="size-3.5" />,
    text: (
      <>
        Lena Ortiz changed status from <StatusBadge status={Status.TODO} />{" "}
        <ArrowRight className="inline size-3" /> <StatusBadge status={Status.IN_PROGRESS} />
      </>
    ),
    time: "40 minutes ago",
  },
  {
    kind: "activity",
    id: "delegation_changed",
    icon: <Bot className={activityIcon} />,
    text: (
      <>
        Lena Ortiz delegated to <span className="text-foreground">Payments Reviewer</span>
      </>
    ),
    time: "35 minutes ago",
  },
  // Planned events (OS-1455) — not logged today.
  {
    kind: "activity",
    id: "type_changed",
    icon: <TaskType taskType={resolveTaskTypeSummary("bug")} variant="icon" />,
    text: (
      <>
        Lena Ortiz changed type from <TaskType taskType={resolveTaskTypeSummary("task")} />{" "}
        <ArrowRight className="inline size-3" /> <TaskType taskType={resolveTaskTypeSummary("bug")} />
      </>
    ),
    time: "33 minutes ago",
  },
  {
    kind: "activity",
    id: "tags_changed",
    icon: <Tags className={activityIcon} />,
    text: (
      <>
        Lena Ortiz added tags <span className="text-foreground">payments</span>,{" "}
        <span className="text-foreground">regression</span>
      </>
    ),
    time: "32 minutes ago",
  },
  {
    kind: "activity",
    id: "external_link_added_branch",
    icon: <GitBranch className="size-3.5 shrink-0 text-purple-500" />,
    text: (
      <>
        Payments Reviewer linked branch{" "}
        <span className="text-foreground">fix/card-decline-lock</span>
      </>
    ),
    time: "30 minutes ago",
  },
  {
    kind: "activity",
    id: "external_link_added_commit",
    icon: <GitCommitHorizontal className="size-3.5 shrink-0 text-amber-500" />,
    text: (
      <>
        Payments Reviewer linked commit{" "}
        <span className="text-foreground">a1c9f42 harden PaymentGuard member keys</span>
      </>
    ),
    time: "28 minutes ago",
  },
  {
    kind: "activity",
    id: "pull_request_opened",
    icon: <GitPullRequest className="size-3.5 shrink-0 text-emerald-500" />,
    text: (
      <>
        Payments Reviewer opened <ThreadPrBadge pullRequest={SEED_PULL_REQUEST} className="align-middle" />{" "}
        <span className="text-foreground">Corporate card decline logic</span>
      </>
    ),
    time: "24 minutes ago",
  },
  {
    kind: "thread",
    id: "t1",
    cliType: "cursor",
    pullRequest: SEED_PULL_REQUEST,
    title: "Corporate card decline logic",
    summary: [
      "**Fix Summary**",
      "",
      "- Hardened `PaymentGuard` so shared-card bursts don't collapse into a single “member” when upstream omits rider identifiers. We now resolve a `memberKey` per request, skip per-member locks for anonymous riders, and persist that key on each attempt so concurrency math uses the normalized identity rather than the raw (possibly empty) `memberId`.",
      "- Added a regression test that fires two concurrent authorizations for the same card and asserts both resolve independently.",
    ].join("\n"),
    time: "22 minutes ago",
  },
  // Compact thread rows (OS-1388): what a thread looks like until the summary
  // denorm lands. Own thread first, then a teammate's.
  {
    kind: "compact-thread",
    id: "t2",
    cliType: "claude-code",
    title: "Add a metric for skipped member locks",
    status: "completed",
    minutesAgo: 21,
  },
  {
    kind: "compact-thread",
    id: "t3",
    cliType: "codex",
    title: "Audit the other PaymentGuard call sites",
    status: "streaming",
    minutesAgo: 20,
    owner: { name: "Morgan Doe" },
  },
  {
    kind: "activity",
    id: "artifact_added",
    icon: <FileText className={activityIcon} />,
    text: (
      <>
        Payments Reviewer added artifact <span className="text-foreground">&quot;Fix plan&quot;</span>
      </>
    ),
    time: "20 minutes ago",
  },
  {
    kind: "activity",
    id: "artifact_updated",
    icon: <FileText className={activityIcon} />,
    text: (
      <>
        Payments Reviewer updated artifact <span className="text-foreground">&quot;Fix plan&quot;</span>
      </>
    ),
    time: "19 minutes ago",
  },
  {
    kind: "activity",
    id: "artifact_removed",
    icon: <FileText className={activityIcon} />,
    text: (
      <>
        Payments Reviewer removed artifact <span className="text-foreground">&quot;Scratch notes&quot;</span>
      </>
    ),
    time: "18 minutes ago",
  },
  {
    kind: "comment",
    id: "c2",
    comment: seedComment(
      "c2",
      "Morgan Doe",
      "Nice — can we also emit a metric for skipped member locks? Would make the next incident a one-query answer.",
      9
    ),
  },
  // Logged today but the renderer has no case for them — both fall through to
  // "performed an action" in the real activity log.
  {
    kind: "activity",
    id: "archived",
    icon: <Archive className={activityIcon} />,
    text: <>Morgan Doe archived this task</>,
    time: "6 minutes ago",
  },
  {
    kind: "activity",
    id: "unarchived",
    icon: <ArchiveRestore className={activityIcon} />,
    text: <>Morgan Doe unarchived this task</>,
    time: "5 minutes ago",
  },
  {
    kind: "activity",
    id: "deleted",
    icon: <Trash2 className={activityIcon} />,
    text: <>Morgan Doe deleted this task</>,
    time: "3 minutes ago",
  },
  {
    kind: "activity",
    id: "restored",
    icon: <RotateCcw className={activityIcon} />,
    text: <>Morgan Doe restored this task</>,
    time: "1 minute ago",
  },
];

const noopCommentAction = async () => {};

// Seed timestamps are relative to `Date.now()`, so the stream renders after
// mount only — a server-rendered "10 minutes ago" would not match hydration.
const subscribeToNothing = () => () => {};
const useIsMounted = () =>
  useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );

/** Consecutive activity rows share one vertical rail, like Linear. */
function ActivityGroup({ entries }: { entries: TimelineEntry[] }) {
  return (
    <div className="relative py-1 pl-8">
      <span aria-hidden className="absolute left-[13px] top-4 bottom-4 w-px bg-border" />
      {entries.map((entry) => {
        if (entry.kind !== "activity") return null;
        return (
          <div key={entry.id} className="flex items-start gap-2 py-1.5">
            <span className="absolute left-1 flex size-5 items-center justify-center bg-background">{entry.icon}</span>
            <p className="text-sm leading-5 text-muted-foreground">
              {entry.text}
              <span className="whitespace-nowrap text-xs"> · {entry.time}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Thread row for the timeline before the summary denorm exists (OS-1388): the same
 * `CompactThreadRowContent` the Threads field and Runs popover use, so no per-thread query
 * is needed. A foreign thread is attributed by the owner's name alone.
 *
 * The whole row is a link; an unshared foreign thread fails on open rather than rendering
 * unclickable (docs/specs/cli-thread-sharing.md).
 */
function CompactThreadEntry({
  cliType,
  title,
  status,
  minutesAgo,
  owner,
}: Extract<TimelineEntry, { kind: "compact-thread" }>) {
  // Same reason the seed builds timestamps lazily: the page only renders after
  // mount, so a relative time computed here can't mismatch hydration.
  const [lastActivityAt] = useState(() => Date.now() - minutesAgo * 60_000);

  return (
    <div className="py-1">
      <div className="group relative rounded-md border border-border bg-card transition-colors hover:bg-muted">
        {/* ponytail: a real row wraps this in AppLink to the thread route. */}
        <button type="button" className="absolute inset-0 z-0 cursor-pointer" aria-label={`Open thread ${title}`} />
        <CompactThreadRowContent
          title={title}
          status={status}
          cliType={cliType}
          lastActivityAt={lastActivityAt}
          forceStatusIndicator
          userName={owner?.name}
        />
      </div>
    </div>
  );
}

const THREAD_COLLAPSED_HEIGHT = 180;

function ThreadEntry({ cliType, pullRequest, title, summary, time }: Extract<TimelineEntry, { kind: "thread" }>) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    setOverflows(body.scrollHeight > THREAD_COLLAPSED_HEIGHT);
  }, []);

  const collapsed = overflows && !expanded;

  return (
    <div className="py-3">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {renderCliIcon(cliType, "size-4")}
          <span className="text-sm font-medium text-foreground">{CLI_TYPE_MAP[cliType]}</span>
          {pullRequest && <ThreadPrBadge pullRequest={pullRequest} />}
          <span className="ml-auto text-xs text-muted-foreground">{time}</span>
        </div>

        <div
          ref={bodyRef}
          className="relative px-4 py-3"
          style={collapsed ? { maxHeight: THREAD_COLLAPSED_HEIGHT, overflow: "hidden" } : undefined}
        >
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <MessageResponse className="mt-2 text-sm text-muted-foreground">{summary}</MessageResponse>
          {collapsed && (
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-b from-transparent to-card" />
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-2">
          {overflows && (
            <Button variant="ghost" size="sm" className="cursor-pointer" onClick={() => setExpanded((value) => !value)}>
              {expanded ? "Show less" : "Show more"}
            </Button>
          )}
          <Button variant="ghost" size="sm" className="cursor-pointer">
            Open thread
          </Button>
        </div>
      </div>
    </div>
  );
}

type ComposerMode = "comment" | "thread";

// ponytail: one offline profile/path so the real selectors have something to
// show. Swap for `useCliProfiles` when this moves into the task sidebar.
const PLAYGROUND_PROFILE: WorkingDirectorySelectorProfile = {
  _id: "playground-profile" as Id<"cliProfiles">,
  name: "workstation",
  hostname: "workstation.local",
  isOnline: true,
  paths: [{ id: "p1", path: "~/src/contoso", label: "contoso" }],
};

/** Collapsed row that swaps in one of the composers. */
function ComposerTrigger({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof MessageSquare;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-2.5 py-1 pl-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

function CommentComposer({
  onSubmit,
  onDone,
}: {
  onSubmit: (content: string) => void;
  onDone: () => void;
}) {
  // ponytail: picked files never upload here — enough to preview the pills.
  const [attachments, setAttachments] = useState<CommentPendingAttachment[]>([]);

  // Stable callback so React only re-attaches (and refocuses) on mount.
  const focusInput = useCallback((node: HTMLDivElement | null) => {
    node?.querySelector<HTMLTextAreaElement>("[data-task-comment-input]")?.focus();
  }, []);

  return (
    <div ref={focusInput}>
      <CommentInput
        onSubmit={async (content) => {
          onSubmit(content);
          onDone();
        }}
        pendingAttachments={attachments}
        onAddFiles={(files) =>
          setAttachments((current) => [
            ...current,
            ...files.map((file, index) => ({
              id: `${file.name}-${current.length + index}`,
              fileName: file.name,
              fileSize: file.size,
              contentType: file.type,
              status: "uploaded" as const,
            })),
          ])
        }
        onRemoveAttachment={(id) =>
          setAttachments((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}

/** One composer open at a time; the other collapses to a trigger row. */
function Composer({ onSubmit }: { onSubmit: (mode: ComposerMode, value: string, cliType: CliTypeSlug) => void }) {
  const [cliType, setCliType] = useState<CliTypeSlug>("claude-code");
  const [threadKey, setThreadKey] = useState(0);
  const [openComposer, setOpenComposer] = useState<ComposerMode>("thread");

  if (openComposer === "comment") {
    return (
      <div className="space-y-3 pb-3">
        <CommentComposer
          onSubmit={(content) => onSubmit("comment", content, cliType)}
          onDone={() => setOpenComposer("thread")}
        />
        <ComposerTrigger
          icon={Bot}
          label="Start a thread..."
          onClick={() => setOpenComposer("thread")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-3">
      <ComposerTrigger
        icon={MessageSquare}
        label="Add comment..."
        onClick={() => setOpenComposer("comment")}
      />

      <ThreadComposer
        key={threadKey}
        onSubmit={({ text }) => {
          if (!text.trim()) return;
          onSubmit("thread", text.trim(), cliType);
          setThreadKey((value) => value + 1);
        }}
        textareaPlaceholder="Start a new thread..."
        containerClassName="p-0"
        contentClassName="max-w-none"
        textareaClassName="min-h-[88px] p-3"
        selectorsProps={{
          profiles: [PLAYGROUND_PROFILE],
          profileId: String(PLAYGROUND_PROFILE._id),
          pathId: "p1",
          cliType,
          mode: undefined,
          cliModel: undefined,
          onCliTypeChange: setCliType,
          onModeChange: () => {},
        }}
      />
    </div>
  );
}

export default function TimelinePlaygroundPage() {
  const [entries, setEntries] = useState<TimelineEntry[]>(buildSeed);
  const isMounted = useIsMounted();
  const { user } = useAppUser();
  const authorName = user?.fullName ?? user?.email ?? "You";

  // Consecutive activities collapse into one railed group.
  const blocks = useMemo(() => {
    const result: TimelineEntry[][] = [];
    for (const entry of entries) {
      const last = result.at(-1);
      if (entry.kind === "activity" && last?.[0].kind === "activity") {
        last.push(entry);
        continue;
      }
      result.push([entry]);
    }
    return result;
  }, [entries]);

  const handleSubmit = (mode: ComposerMode, value: string, cliType: CliTypeSlug) => {
    const id = `local-${entries.length}`;
    setEntries((current) => [
      ...current,
      mode === "comment"
        ? { kind: "comment", id, comment: seedComment(id, authorName, value, 0) }
        : {
            kind: "thread",
            id,
            cliType,
            title: value,
            summary: "Waiting for the agent to pick this up…",
            time: "now",
          },
    ]);
  };

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col px-6 py-10">
      <h1 className="text-lg font-semibold text-foreground">Corporate card declined for simultaneous riders</h1>
      <p className="mt-1 text-sm text-muted-foreground">Unified timeline — comments, agent threads, and activity in one stream.</p>

      <div className="mt-6 flex-1">
        {!isMounted
          ? null
          : blocks.map((block) => {
              const first = block[0];
              if (first.kind === "activity") {
                return <ActivityGroup key={first.id} entries={block} />;
              }
              if (first.kind === "comment") {
                return (
                  <div key={first.id} className="py-3">
                    <CommentItem comment={first.comment} onUpdate={noopCommentAction} onDelete={noopCommentAction} />
                  </div>
                );
              }
              if (first.kind === "compact-thread") {
                return <CompactThreadEntry key={first.id} {...first} />;
              }
              return <ThreadEntry key={first.id} {...first} />;
            })}

        {/* Composer lives in the stream, after the last entry. */}
        <Composer onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
