"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/custom/spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage } from "@/lib/errors";
import { useLinkedGithubAccounts } from "./linked-github-account";
import { AssignPicker } from "./pull-request-assignees";
import { ROLE_RANK, writeBlocker, type StateChange } from "./pull-request-state-actions";
import type { PullRequestSummary } from "./types";

// The list's bulk actions: one GitHub write per PR as the member, failures reported per PR
// (docs/specs/github-integration.md → GitHub accounts and permissions).

type Role = FunctionReturnType<typeof api.integrations.github.accounts.readRepositoryPermission>;
type Account = NonNullable<ReturnType<typeof useLinkedGithubAccounts>>["organizations"][number]["account"];

/** Mark as: which selected PRs each change applies to, and how the result reads. */
const MARK_AS: { change: StateChange; label: string; applies: (pr: PullRequestSummary) => boolean }[] = [
  { change: "close", label: "Closed", applies: (pr) => pr.state === "open" && !pr.archived },
  { change: "archive", label: "Archived", applies: (pr) => !pr.archived },
  { change: "unarchive", label: "Unarchived", applies: (pr) => pr.archived },
];

const plural = (count: number) => `${count} pull request${count === 1 ? "" : "s"}`;

/**
 * The member's role on each selected PR's repository, read once per repository
 * while the page is open. Linking another account or reconnecting starts over;
 * an answer for an earlier account is never used.
 */
function useRepositoryRoles(projectId: Id<"projects">, selected: PullRequestSummary[], account: Account): Role[] {
  const read = useAction(api.integrations.github.accounts.readRepositoryPermission);
  const identity = account ? `${account.githubUserId}:${account.status}` : "";
  const [session, setSession] = useState({ identity, number: 0 });
  if (session.identity !== identity) setSession({ identity, number: session.number + 1 });
  const enabled = account?.status === "active";
  const [roles, setRoles] = useState<ReadonlyMap<string, Role>>(new Map());
  const requested = useRef(new Set<string>());
  const key = (repositoryId: string) => `${session.number}:${repositoryId}`;
  useEffect(() => {
    if (!enabled) return;
    for (const { repositoryId, number } of selected) {
      const at = `${session.number}:${repositoryId}`;
      if (requested.current.has(at)) continue;
      requested.current.add(at);
      const store = (role: Role) => setRoles((current) => new Map(current).set(at, role));
      read({ projectId, repositoryId, number }).then(store, () => store(null));
    }
  }, [enabled, projectId, read, selected, session.number]);
  return enabled ? selected.map((pr) => roles.get(key(pr.repositoryId)) ?? null) : [];
}

/** The lowest known role, since the selection needs it on every repository; null while none is known. */
function lowestRole(roles: Role[]): Role {
  return roles.reduce<Role>((lowest, role) => (role !== null && (lowest === null || ROLE_RANK[role] < ROLE_RANK[lowest]) ? role : lowest), null);
}

export function BulkActionsBar({
  projectId,
  organizationSlug,
  rows,
  selected,
  onSelectionChange,
}: {
  projectId: Id<"projects">;
  organizationSlug: string;
  rows: PullRequestSummary[];
  selected: PullRequestSummary[];
  onSelectionChange: (ids: Id<"integrationPullRequests">[]) => void;
}) {
  const updateState = useAction(api.integrations.github.states.update);
  const updateAssignee = useAction(api.integrations.github.assignees.update);
  const clearAssignees = useAction(api.integrations.github.assignees.clear);
  const accounts = useLinkedGithubAccounts();
  const account = accounts?.organizations.find((organization) => organization.organizationSlug === organizationSlug)?.account ?? null;
  const roles = useRepositoryRoles(projectId, selected, account);
  const blocker = writeBlocker(account, lowestRole(roles), "triage");
  const [running, setRunning] = useState<string | null>(null);
  // GitHub's answer to an assignee write, until the row's sync moves `providerUpdatedAt` past it.
  const [answers, setAnswers] = useState<ReadonlyMap<string, { at: number; logins: string[] }>>(new Map());
  const assigneesOf = (pr: PullRequestSummary) => {
    const answer = answers.get(pr._id);
    return answer?.at === pr.providerUpdatedAt ? answer.logins : pr.assignees;
  };
  const remember = (pr: PullRequestSummary) => (assignees: { login: string }[]) =>
    setAnswers((current) => new Map(current).set(pr._id, { at: pr.providerUpdatedAt, logins: assignees.map((person) => person.login) }));

  /** One write per PR, in order; reports how many worked and which failed. */
  const runEach = async (label: string, done: string, targets: PullRequestSummary[], write: (pr: PullRequestSummary) => Promise<unknown>) => {
    setRunning(label);
    const failures: string[] = [];
    for (const pr of targets) {
      try {
        await write(pr);
      } catch (error) {
        failures.push(`#${pr.number}: ${getErrorMessage(error, "GitHub refused this")}`);
      }
    }
    setRunning(null);
    const succeeded = targets.length - failures.length;
    if (failures.length) {
      toast.error(`${failures.length} of ${plural(targets.length)} failed`, { description: failures.join("\n") });
    } else {
      toast.success(`${done} ${plural(succeeded)}`);
    }
  };
  const target = (pr: PullRequestSummary) => ({ projectId, repositoryId: pr.repositoryId, number: pr.number });

  return (
    <div className="flex min-h-12 flex-wrap items-center gap-3 rounded-t-lg bg-muted/40 px-4 py-2">
      <Checkbox
        aria-label="Select all visible pull requests"
        checked={selected.length === rows.length ? true : selected.length ? "indeterminate" : false}
        onCheckedChange={(checked) => onSelectionChange(checked === true ? rows.map((pr) => pr._id) : [])}
      />
      <span className="text-xs font-medium">{selected.length ? `${selected.length} of ${rows.length} selected` : plural(rows.length)}</span>
      {selected.length ? (
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <span role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner />
              {running}
            </span>
          ) : blocker ? (
            <span className="text-xs text-muted-foreground">{blocker}</span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={blocker !== null || running !== null}>
                Mark as
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {MARK_AS.map(({ change, label, applies }) => {
                const targets = selected.filter(applies);
                return (
                  <DropdownMenuItem
                    key={change}
                    disabled={!targets.length}
                    onSelect={() =>
                      void runEach(`${label}…`, label, targets, (pr) => updateState({ ...target(pr), change })).then(() => onSelectionChange([]))
                    }
                  >
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <AssignPicker
            projectId={projectId}
            sources={[...new Map(selected.map((pr) => [pr.repositoryId, { repositoryId: pr.repositoryId, number: pr.number }])).values()]}
            assignments={selected.map(assigneesOf)}
            onToggle={(login, assign) =>
              void runEach(
                "Assigning…",
                assign ? `Assigned ${login} to` : `Unassigned ${login} from`,
                selected.filter((pr) => assigneesOf(pr).includes(login) !== assign),
                (pr) => updateAssignee({ ...target(pr), login, assigned: assign }).then(remember(pr))
              )
            }
            onClear={() =>
              void runEach(
                "Assigning…",
                "Assigned nobody to",
                // Every one: a row stored before assignees were synced may still hold some.
                selected,
                (pr) => clearAssignees(target(pr)).then(remember(pr))
              )
            }
          >
            <Button variant="outline" size="sm" aria-label="Assign selected pull requests" disabled={blocker !== null || running !== null}>
              Assign
              <ChevronDown />
            </Button>
          </AssignPicker>
          <Button variant="ghost" size="sm" disabled={running !== null} onClick={() => onSelectionChange([])}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
