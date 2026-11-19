"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { Archive, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/custom/spinner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
import type { GithubCommenting } from "./pull-request-comments";
import { displayState, PullRequestStateIcon } from "./pull-request-state-icon";
import type { PullRequestView } from "./types";

// GitHub's state actions, run as the member's Linked GitHub account (docs/specs/github-integration.md → GitHub accounts and permissions).

export type StateChange = FunctionArgs<typeof api.integrations.github.states.update>["change"];
type Role = FunctionReturnType<typeof api.integrations.github.accounts.readRepositoryPermission>;
type Account = GithubCommenting["account"];
/** The least GitHub role an action needs. */
export type WriteAccess = "triage" | "write";

export const ROLE_RANK: Record<NonNullable<Role>, number> = { none: 0, read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };

/** Why the member can't run an action needing `needed`, or null. An unknown role allows it: GitHub has the last word. */
export function writeBlocker(account: Account, role: Role, needed: WriteAccess): string | null {
  if (!account) return "Connect GitHub first";
  if (account.status !== "active") return "Reconnect GitHub first";
  if (role !== null && ROLE_RANK[role] < ROLE_RANK[needed]) return needed === "triage" ? "Needs triage access" : "Needs write access";
  return null;
}

export const STATE_CHANGES: Record<StateChange, { label: string; needs: WriteAccess }> = {
  close: { label: "Close pull request", needs: "triage" },
  reopen: { label: "Reopen", needs: "triage" },
  draft: { label: "Convert to draft", needs: "write" },
  ready: { label: "Ready for review", needs: "write" },
  archive: { label: "Archive", needs: "triage" },
  unarchive: { label: "Unarchive", needs: "triage" },
};

/** The header button and the More actions menu for each state, as on GitHub; an Archived PR offers only Unarchive. */
const ACTIONS_BY_STATE: Record<ReturnType<typeof displayState> | "archived", { primary?: StateChange; more: StateChange[] }> = {
  open: { more: ["draft", "close", "archive"] },
  draft: { primary: "ready", more: ["close", "archive"] },
  closed: { primary: "reopen", more: ["archive"] },
  merged: { more: ["archive"] },
  archived: { primary: "unarchive", more: [] },
};

type Props = { projectId: Id<"projects">; repositoryId: string; pr: PullRequestView; commenting: GithubCommenting };

/** One state change at a time; the stored row follows through a sync, so the PR's state updates by itself. */
function useStateChange({ projectId, repositoryId, pr, commenting }: Props) {
  const update = useAction(api.integrations.github.states.update);
  const [pending, setPending] = useState<StateChange | null>(null);
  const blocker = (change: StateChange) => writeBlocker(commenting.account, commenting.role, STATE_CHANGES[change].needs);
  const run = (change: StateChange) => {
    setPending(change);
    update({ projectId, repositoryId, number: pr.number, change })
      .catch((error: unknown) => showConvexErrorToast(error, `Could not ${STATE_CHANGES[change].label.toLowerCase()}`))
      .finally(() => setPending(null));
  };
  return { pending, blocker, run };
}

/** The reader header's state actions. */
export function PullRequestStateActions(props: Props) {
  const { pending, blocker, run } = useStateChange(props);
  const { pr } = props;
  const { primary, more } = ACTIONS_BY_STATE[pr.archived ? "archived" : displayState(pr)];
  return (
    <>
      {primary ? (
        // A span keeps the reason's tooltip on a disabled button.
        <span title={blocker(primary) ?? undefined}>
          <Button variant="outline" size="sm" disabled={pending !== null || blocker(primary) !== null} onClick={() => run(primary)}>
            {pending === primary ? <Spinner /> : null}
            {STATE_CHANGES[primary].label}
          </Button>
        </span>
      ) : null}
      {more.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions" title="More actions" disabled={pending !== null}>
              {pending && pending !== primary ? <Spinner /> : <MoreHorizontal />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {more.map((change) => {
              const reason = blocker(change);
              return (
                <DropdownMenuItem key={change} disabled={reason !== null} onSelect={() => run(change)} className="flex-col items-start gap-0">
                  {STATE_CHANGES[change].label}
                  {reason ? <span className="text-xs text-muted-foreground">{reason}</span> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  );
}

type Status = ReturnType<typeof displayState> | "archived";

export const STATUS_WORDS: Record<Status, string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed", archived: "Archived" };

/** The statuses each one can move to, and the change that gets there; Merged is reached only by merging. */
const MOVES: Record<ReturnType<typeof displayState>, [Status, StateChange][]> = {
  open: [["draft", "draft"], ["closed", "close"], ["archived", "archive"]],
  draft: [["open", "ready"], ["closed", "close"], ["archived", "archive"]],
  closed: [["open", "reopen"], ["archived", "archive"]],
  merged: [["archived", "archive"]],
};

function StatusIcon({ pr, status }: { pr: PullRequestView; status: Status }) {
  return (
    <span aria-hidden className="flex">
      {status === "archived" ? (
        <Archive className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <PullRequestStateIcon pr={{ state: status === "draft" ? "open" : status, draft: status === "draft" }} />
      )}
    </span>
  );
}

/** Status as a select, like a task's: picking a status runs the change that reaches it. An Archived PR goes back to its state. */
export function PullRequestStatusSelect({ className, ...props }: Props & { className?: string }) {
  const { pending, blocker, run } = useStateChange(props);
  const { pr } = props;
  const state = displayState(pr);
  const current: Status = pr.archived ? "archived" : state;
  const moves: [Status, StateChange][] = pr.archived ? [[state, "unarchive"]] : MOVES[state];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Status: ${STATUS_WORDS[current]}`} disabled={pending !== null} className={className}>
          {pending ? <Spinner /> : <StatusIcon pr={pr} status={current} />}
          {STATUS_WORDS[current]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup value={current}>
          <DropdownMenuRadioItem value={current}>
            <StatusIcon pr={pr} status={current} />
            {STATUS_WORDS[current]}
          </DropdownMenuRadioItem>
          {moves.map(([status, change]) => {
            const reason = blocker(change);
            return (
              <DropdownMenuRadioItem key={status} value={status} disabled={reason !== null} onSelect={() => run(change)} className="items-start">
                <StatusIcon pr={pr} status={status} />
                <span className="flex flex-col">
                  {STATUS_WORDS[status]}
                  {reason ? <span className="text-xs text-muted-foreground">{reason}</span> : null}
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
