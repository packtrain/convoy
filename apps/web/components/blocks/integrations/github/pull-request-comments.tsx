"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { formatDistanceToNow } from "date-fns";
import { Github, MessageSquare, MessageSquareMore, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { CommentInput, type CommentMention } from "@/components/blocks/tasks/comments";
import type { TimelineComposerMode } from "@/components/blocks/tasks/task-timeline";
import { Spinner } from "@/components/custom/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useStorageUploadQueue } from "@/hooks/uploads/use-storage-upload-queue";
import { readLocalString, removeLocalValue, writeLocalString } from "@/lib/browser/local-storage";
import { showConvexErrorToast } from "@/lib/errors";
import type { RouteTarget } from "@/lib/navigation";
import { getContentType } from "@/lib/tasks/files";
import type { TimelineSortDirection } from "@/lib/tasks/timeline/rows";
import { GithubMarkdown } from "./github-markdown";
import { useConnectGithubAccount, useConnectGithubPrompt, useLinkedGithubAccounts } from "./linked-github-account";
import type { PullRequestOverview } from "./types";

// Conversation comments written as the member's Linked GitHub account (docs/specs/github-integration.md → GitHub accounts and permissions).

type Comments = PullRequestOverview["comments"];
/** Applies GitHub's answer to a write to the held Overview. */
export type CommentsChange = (update: (comments: Comments) => Comments) => void;
type Permission = FunctionReturnType<typeof api.integrations.github.accounts.readRepositoryPermission>;

const ago = (at: number) => formatDistanceToNow(at, { addSuffix: true });

/** The member's account in this organization, its role on the repository (read once per open), and the comment writes. */
export function useGithubCommenting({
  projectId,
  repositoryId,
  number,
  organizationSlug,
  archived,
  returnTo,
  onCommentsChange,
}: {
  projectId: Id<"projects">;
  repositoryId: string;
  number: number;
  organizationSlug: string;
  /** Archiving locks the conversation: no new comments, edits, or deletes. */
  archived: boolean;
  /** The PR, so Connect comes back to it. */
  returnTo: RouteTarget;
  onCommentsChange: CommentsChange;
}) {
  const accounts = useLinkedGithubAccounts();
  const organization = accounts?.configured ? accounts.organizations.find((candidate) => candidate.organizationSlug === organizationSlug) : undefined;
  const account = organization?.account ?? null;
  const connect = useConnectGithubPrompt(organization, returnTo);
  const active = account?.status === "active";
  const readPermission = useAction(api.integrations.github.accounts.readRepositoryPermission);
  const createComment = useAction(api.integrations.github.comments.create);
  const updateComment = useAction(api.integrations.github.comments.update);
  const removeComment = useAction(api.integrations.github.comments.remove);
  const key = `${repositoryId}#${number}@${account?.githubUserId ?? ""}`;
  const [permission, setPermission] = useState<{ key: string; value: Permission }>();

  useEffect(() => {
    if (!active) return;
    let live = true;
    readPermission({ projectId, repositoryId, number }).then(
      (value) => live && setPermission({ key, value }),
      () => live && setPermission({ key, value: null })
    );
    return () => {
      live = false;
    };
  }, [active, key, number, projectId, readPermission, repositoryId]);

  const target = { projectId, repositoryId, number };
  const report = (fallback: string) => (error: unknown) => {
    showConvexErrorToast(error, fallback);
    throw error;
  };
  const role = active && permission?.key === key ? permission.value : null;
  return {
    projectId,
    organization,
    account,
    /** The connect popup, for actions that run as the member without an active account. */
    connect,
    /** The account's role on the repository; null while unknown, which still allows writing: GitHub has the last word. */
    role,
    /** Null (unknown) still allows writing: GitHub has the last word. */
    noAccess: role === "none",
    archived,
    viewerId: active && !archived ? account.githubUserId : null,
    /** `files`: uploads registered with `useCommentFiles`; the comment links them. */
    post: (body: string, files: Id<"_storage">[] = []) =>
      createComment({ ...target, body, files })
        .then((comment) => onCommentsChange((comments) => [...comments, comment]))
        .catch(report("Could not post the comment")),
    edit: (commentId: number, body: string) =>
      updateComment({ ...target, commentId, body })
        .then((comment) => onCommentsChange((comments) => comments.map((existing) => (existing.id === commentId ? comment : existing))))
        .catch(report("Could not save the comment")),
    remove: (commentId: number) =>
      removeComment({ ...target, commentId })
        .then(() => onCommentsChange((comments) => comments.filter((existing) => existing.id !== commentId)))
        .catch(report("Could not delete the comment")),
  };
}

export type GithubCommenting = ReturnType<typeof useGithubCommenting>;

/** Who `@` offers: the author, reviewers, assignees, then commenters, without bots. */
export function mentionCandidates(overview: PullRequestOverview | null, author: string): CommentMention[] {
  const avatars = new Map<string, string | null>();
  for (const person of [...(overview?.assignees ?? []), ...(overview?.reviews ?? []), ...(overview?.comments ?? []), ...(overview?.reviewComments ?? [])]) {
    const [login, avatarUrl] = "login" in person ? [person.login, person.avatarUrl] : [person.author, person.authorAvatarUrl];
    if (avatarUrl) avatars.set(login, avatarUrl);
  }
  const logins = [
    author,
    ...(overview?.reviews.map((review) => review.author) ?? []),
    ...(overview?.requestedReviewers ?? []),
    ...(overview?.assignees.map(({ login }) => login) ?? []),
    ...(overview?.comments.map((comment) => comment.author) ?? []),
    ...(overview?.reviewComments.map((comment) => comment.author) ?? []),
  ];
  return [...new Set(logins)]
    .filter((login) => !login.endsWith("[bot]"))
    .map((login) => ({ login, avatarUrl: avatars.get(login) ?? null }));
}

/**
 * Activity's composer: the comment side and the thread side, one open and
 * the other a trigger row facing the stream, as in the task timeline.
 * Without a Linked GitHub account the trigger connects one instead.
 */
export function PullRequestActivityComposer({
  commenting,
  threadComposer,
  mode,
  onModeChange,
  sort,
  returnTo,
  draftKey,
  mentions,
}: {
  commenting: GithubCommenting;
  threadComposer: ReactNode;
  mode: TimelineComposerMode;
  onModeChange: (mode: TimelineComposerMode) => void;
  sort: TimelineSortDirection;
  /** The PR, so Connect comes back to it with both drafts kept. */
  returnTo: RouteTarget;
  /** Where the PR's comment drafts live in local storage; each member's sits under their GitHub account id. */
  draftKey: string;
  mentions: CommentMention[];
}) {
  const { connect, connecting } = useConnectGithubAccount();
  const { organization, account, noAccess, archived } = commenting;
  const canComment = account?.status === "active" && !noAccess && !archived;
  const resolved = canComment ? mode : "thread";
  const connectTrigger = (label: string) =>
    organization ? <Trigger key="trigger" icon={Github} label={label} disabled={connecting} onClick={() => connect(organization.organizationId, returnTo)} /> : null;
  const trigger = !organization ? null : archived ? (
    <Trigger key="trigger" icon={Github} label="This pull request is archived. Unarchive it to comment." disabled />
  ) : !account ? (
    connectTrigger("Connect GitHub to comment...")
  ) : account.status === "reconnect" ? (
    connectTrigger("Reconnect GitHub to comment...")
  ) : noAccess ? (
    <Trigger key="trigger" icon={Github} label={`@${account.login} has no access to this repository on GitHub`} disabled />
  ) : resolved === "thread" ? (
    <Trigger key="trigger" icon={MessageSquare} label="Add comment..." onClick={() => onModeChange("comment")} />
  ) : (
    <Trigger key="trigger" icon={MessageSquareMore} label="Start a thread..." onClick={() => onModeChange("thread")} />
  );
  // Both stay mounted, so switching keeps each draft.
  const composers = (
    <div key="composers">
      {canComment ? (
        <div className={resolved === "comment" ? "block" : "hidden"}>
          {/* Keyed by member, so another member signing in on this browser never sees the draft. */}
          <CommentDraft
            key={account.githubUserId}
            projectId={commenting.projectId}
            storageKey={`${draftKey}:${account.githubUserId}`}
            onSubmit={commenting.post}
            mentions={mentions}
          />
        </div>
      ) : null}
      <div className={resolved === "thread" ? "block" : "hidden"}>{threadComposer}</div>
    </div>
  );
  return <div className="space-y-2 py-3">{sort === "asc" ? [trigger, composers] : [composers, trigger]}</div>;
}

/** A draft's files: uploaded, registered as the member's, and discarded when removed or left unsent. */
function useCommentFiles(projectId: Id<"projects">) {
  const generateUploadUrl = useMutation(api.integrations.github.comments.generateUploadUrl);
  const registerUpload = useMutation(api.integrations.github.comments.registerUpload);
  const discardUpload = useMutation(api.integrations.github.comments.discardUpload);
  // Best effort: a blob left behind costs storage, not correctness.
  const discard = (storageId: Id<"_storage">) => void discardUpload({ projectId, storageId }).catch(() => null);
  const { uploads, uploadFiles, removeUpload, getUploadsSnapshot } = useStorageUploadQueue({
    getUploadUrl: () => generateUploadUrl({ projectId }),
    registerUpload: (storageId, file) => registerUpload({ projectId, storageId, fileName: file.name, contentType: getContentType(file) }),
    onAbandonedUpload: ({ storageId }) => discard(storageId),
    autoRemoveDelay: 0,
    errorRemoveDelay: 0,
  });

  useEffect(
    () => () => {
      for (const { storageId } of getUploadsSnapshot()) if (storageId) void discardUpload({ projectId, storageId }).catch(() => null);
    },
    [discardUpload, getUploadsSnapshot, projectId]
  );

  return {
    pending: uploads.map(({ id, fileName, fileSize, contentType, status, error }) => ({
      id,
      fileName,
      fileSize,
      contentType,
      status: status === "done" ? ("uploaded" as const) : status === "error" ? ("error" as const) : ("uploading" as const),
      error,
    })),
    add: (files: File[]) => void uploadFiles(files),
    remove: (id: string) => {
      const storageId = getUploadsSnapshot().find((item) => item.id === id)?.storageId;
      if (storageId) discard(storageId);
      removeUpload(id);
    },
    /** The finished uploads, for a send. */
    uploaded: () => getUploadsSnapshot().flatMap(({ id, status, storageId }) => (status === "done" && storageId ? [{ id, storageId }] : [])),
    /** Drops what a comment now links, keeping files added while it posted. */
    sent: (files: { id: string }[]) => files.forEach(({ id }) => removeUpload(id)),
  };
}

/** The comment input over a draft kept in local storage, so it outlives Reconnect and the trip to GitHub. Files aren't kept. */
function CommentDraft({
  projectId,
  storageKey,
  onSubmit,
  mentions,
}: {
  projectId: Id<"projects">;
  storageKey: string;
  onSubmit: (body: string, files: Id<"_storage">[]) => Promise<void>;
  mentions: CommentMention[];
}) {
  const [draft, setDraft] = useState(() => readLocalString(storageKey) ?? "");
  const files = useCommentFiles(projectId);
  const save = (value: string) => {
    setDraft(value);
    if (value) writeLocalString(storageKey, value);
    else removeLocalValue(storageKey);
  };
  return (
    <>
      <CommentInput
        placeholder="Leave a comment on GitHub..."
        value={draft}
        onValueChange={save}
        onSubmit={(body) => {
          const sending = files.uploaded();
          return onSubmit(body, sending.map(({ storageId }) => storageId)).then(() => files.sent(sending));
        }}
        mentions={mentions}
        pendingAttachments={files.pending}
        onAddFiles={files.add}
        onRemoveAttachment={files.remove}
      />
      {files.pending.length ? (
        <p className="mt-1 pl-[7px] text-xs text-muted-foreground">
          Files get a public link. Anyone who can see this comment can open them, on a public repository anyone at all.
        </p>
      ) : null}
    </>
  );
}

function Trigger({ icon: Icon, label, onClick, disabled }: { icon: typeof MessageSquare; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex cursor-pointer items-center gap-2.5 py-1 pl-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

export type QuoteLine = PullRequestOverview["reviewComments"][number]["quote"][number];

const QUOTE_ROWS: Record<QuoteLine["kind"], { sign: string; className: string }> = {
  add: { sign: "+", className: "bg-success/10" },
  del: { sign: "-", className: "bg-destructive/10" },
  context: { sign: " ", className: "" },
};

function quoteLabel({ line, lines }: { line: number | null; lines: QuoteLine[] }) {
  const numbers = lines.flatMap((quoted) => (quoted.number === null ? [] : [quoted.number]));
  const [first, last] = [numbers[0] ?? line, numbers.at(-1) ?? line];
  if (first === null || last === null) return "";
  return first === last ? `Line ${last}` : `Lines ${first}–${last}`;
}

type Quote = { path: string; line: number | null; lines: QuoteLine[] };

/** GitHub's inline-comment header: the file, its lines, and the quoted code. */
function CommentQuote({ quote }: { quote: Quote }) {
  return (
    <figure className="my-2 overflow-hidden rounded-lg border">
      <header className="flex min-w-0 items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
        <span className="min-w-0 truncate font-mono">{quote.path}</span>
        <span className="shrink-0 text-muted-foreground">{quoteLabel(quote)}</span>
      </header>
      {quote.lines.length ? (
        <table className="w-full font-mono text-xs">
          <tbody>
            {quote.lines.map((quoted, index) => (
              <tr key={index} className={QUOTE_ROWS[quoted.kind].className}>
                <td className="w-10 px-2 py-0.5 text-right align-top text-muted-foreground select-none">{quoted.number ?? ""}</td>
                <td className="px-2 py-0.5 break-all whitespace-pre-wrap">
                  <span className="select-none">{QUOTE_ROWS[quoted.kind].sign}</span>
                  {quoted.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </figure>
  );
}

/** One comment in Activity; `own` adds Edit and Delete for the viewer's conversation comments. */
export function ActivityComment({
  comment,
  own,
}: {
  comment: { author: string; authorAvatarUrl: string | null; body: string; url: string; at: number; action?: string; quote?: Quote };
  own?: { onSave: (body: string) => Promise<void>; onDelete: () => Promise<void> };
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (write: () => Promise<void>) => {
    setBusy(true);
    try {
      await write();
      return true;
    } catch {
      // The write reported its failure; keep what the member typed.
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (editing === null) return;
    if (!editing.trim() || editing.trim() === comment.body) return setEditing(null);
    if (await run(() => own!.onSave(editing))) setEditing(null);
  };
  return (
    <article className="group flex gap-3 py-3">
      <Avatar className="size-8 shrink-0">
        <AvatarImage src={comment.authorAvatarUrl ?? undefined} />
        <AvatarFallback className="text-xs">{comment.author.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs text-muted-foreground">
          <span className="text-sm font-medium text-foreground">{comment.author}</span>
          {comment.action ? ` ${comment.action}` : null} ·{" "}
          <a href={comment.url} target="_blank" rel="noreferrer" className="hover:underline">
            {ago(comment.at)}
          </a>
        </p>
        {comment.quote ? <CommentQuote quote={comment.quote} /> : null}
        {editing === null ? (
          <GithubMarkdown>{comment.body}</GithubMarkdown>
        ) : (
          <InputGroup>
            <InputGroupTextarea
              aria-label="Edit comment"
              value={editing}
              autoFocus
              rows={3}
              className="min-h-0 text-sm"
              onChange={(event) => setEditing(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void save();
                } else if (event.key === "Escape") setEditing(null);
              }}
            />
            <InputGroupAddon align="block-end">
              <InputGroupButton className="ml-auto" disabled={busy} onClick={() => setEditing(null)}>
                Cancel
              </InputGroupButton>
              <InputGroupButton variant="default" disabled={busy || !editing.trim()} onClick={() => void save()}>
                {busy ? <Spinner className="size-3.5" /> : null}
                Save
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )}
      </div>
      {own && editing === null ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Comment actions"
              className="size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(comment.body)}>
              <Pencil className="mr-2 size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirming(true)} className="text-destructive focus:text-destructive">
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {own ? (
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete comment?</AlertDialogTitle>
              <AlertDialogDescription>This deletes the comment on GitHub. It can&apos;t be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy}
                onClick={(event) => {
                  event.preventDefault();
                  void run(own.onDelete).then(() => setConfirming(false));
                }}
              >
                {busy ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </article>
  );
}
