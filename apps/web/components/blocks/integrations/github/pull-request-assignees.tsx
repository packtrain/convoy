"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import { Check, Minus, Pencil } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchablePicker, SearchablePickerItem } from "@/components/custom/searchable-picker";
import { Spinner } from "@/components/custom/spinner";
import { useDebounce } from "@/hooks/react/use-debounce";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { getErrorMessage, showConvexErrorToast } from "@/lib/errors";
import type { PullRequestOverview } from "./types";

type Person = PullRequestOverview["assignees"][number];
/** One PR per repository, naming where to read assignable people. */
type Source = { repositoryId: string; number: number };

export function PersonAvatar({ person }: { person: Person }) {
  return (
    <Avatar className="size-4">
      <AvatarImage src={person.avatarUrl ?? undefined} />
      <AvatarFallback className="text-[8px]">{person.login.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Assignees for one or several PRs, as on GitHub's list: a person on every
 * PR is checked, on some is mixed, and picking them assigns all or unassigns all.
 * GitHub searches each repository in `sources` as the member types, 20 people per repository.
 */
export function AssignPicker({
  projectId,
  sources,
  assignments,
  onToggle,
  onClear,
  children,
}: {
  projectId: Id<"projects">;
  sources: Source[];
  /** Each PR's assignee logins. */
  assignments: string[][];
  onToggle: (login: string, assign: boolean) => void;
  onClear: () => void;
  /** The trigger. */
  children: ReactNode;
}) {
  const listAssignable = useAction(api.integrations.github.assignees.list);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  type Answer = { kind: "loaded"; people: Person[] } | { kind: "error"; message: string };
  const [answer, setAnswer] = useState<Answer & { key: string }>();
  const search = useDebounce(query.trim(), 250);
  // Only the latest search may land.
  const latest = useRef(0);
  const sourcesKey = JSON.stringify(sources);
  const key = `${sourcesKey}:${search}`;
  const people: Answer | { kind: "loading" } = answer?.key === key ? answer : { kind: "loading" };
  useEffect(() => {
    if (!open) return;
    const request = ++latest.current;
    const land = (next: Answer) => request === latest.current && setAnswer({ ...next, key: `${sourcesKey}:${search}` });
    Promise.all((JSON.parse(sourcesKey) as Source[]).map((source) => listAssignable({ projectId, ...source, query: search || undefined }))).then(
      (lists) => land({ kind: "loaded", people: [...new Map(lists.flat().map((person) => [person.login, person])).values()] }),
      (error: unknown) => land({ kind: "error", message: getErrorMessage(error, "Could not load the assignable people") })
    );
  }, [open, search, sourcesKey, projectId, listAssignable]);
  const assigned = new Set(assignments.flat());
  // Someone assigned but no longer assignable still shows, so they can be removed.
  const known = people.kind === "loaded" ? people.people : [];
  const listed = [...known, ...[...assigned].filter((login) => !known.some((person) => person.login === login)).map((login) => ({ login, avatarUrl: null }))];
  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());
  // GitHub already matched `known`; the rest match here.
  const shown = listed.filter((person, index) => index < known.length || matches(person.login));
  const showNobody = matches("Assign to nobody");
  const close = (action: () => void) => () => {
    action();
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <SearchablePicker query={query} onQueryChange={setQuery} placeholder="Search people..." clearLabel="Clear people search">
          {showNobody ? (
            <SearchablePickerItem onClick={close(onClear)}>
              <Mark state={assigned.size === 0 ? "all" : "none"} />
              Assign to nobody
            </SearchablePickerItem>
          ) : null}
          {shown.map((person) => {
            const count = assignments.filter((logins) => logins.includes(person.login)).length;
            const state = count === assignments.length ? "all" : count ? "some" : "none";
            return (
              <SearchablePickerItem
                key={person.login}
                onClick={close(() => onToggle(person.login, state !== "all"))}
                aria-label={`${person.login}, ${STATE_LABELS[state]}`}
              >
                <Mark state={state} />
                <PersonAvatar person={person} />
                <span className="truncate font-medium">{person.login}</span>
              </SearchablePickerItem>
            );
          })}
          {people.kind === "loaded" ? (
            !showNobody && !shown.length ? <div className="px-2 py-2.5 text-sm text-muted-foreground">No people found.</div> : null
          ) : (
            <p role="status" className="px-2 py-2.5 text-sm text-muted-foreground">
              {people.kind === "loading" ? "Loading people…" : people.message}
            </p>
          )}
        </SearchablePicker>
      </PopoverContent>
    </Popover>
  );
}

type MarkState = "all" | "some" | "none";

const STATE_LABELS: Record<MarkState, string> = { all: "assigned", some: "assigned to some selected", none: "not assigned" };
const MARK_ICONS: Record<MarkState, ReactNode> = { all: <Check className="size-3" />, some: <Minus className="size-3" />, none: null };

function Mark({ state }: { state: MarkState }) {
  return (
    <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded border">
      {MARK_ICONS[state]}
    </span>
  );
}

/** The Overview's Assignees edit button for one PR; GitHub's answer replaces the held assignees. */
export function AssigneesButton({
  projectId,
  repositoryId,
  number,
  assignees,
  blocker,
  onChange,
}: {
  projectId: Id<"projects">;
  repositoryId: string;
  number: number;
  assignees: Person[];
  /** Why the member can't assign, or null. */
  blocker: string | null;
  onChange: (assignees: Person[]) => void;
}) {
  const update = useAction(api.integrations.github.assignees.update);
  const clear = useAction(api.integrations.github.assignees.clear);
  // One write at a time: each answer replaces the whole list, so an older one must not land after a newer one.
  const [pending, setPending] = useState(false);
  const target = { projectId, repositoryId, number };
  const write = (request: Promise<Person[]>) => {
    setPending(true);
    request
      .then(onChange, (error: unknown) => showConvexErrorToast(error, "Could not change the assignees"))
      .finally(() => setPending(false));
  };
  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Edit assignees"
      title={blocker ?? "Edit assignees"}
      disabled={blocker !== null || pending}
      className="-my-1.5 size-7"
    >
      {pending ? <Spinner /> : <Pencil className="size-3.5" />}
    </Button>
  );
  if (blocker) return button;
  return (
    <AssignPicker
      projectId={projectId}
      sources={[{ repositoryId, number }]}
      assignments={[assignees.map((person) => person.login)]}
      onToggle={(login, assigned) => write(update({ ...target, login, assigned }))}
      onClear={() => write(clear(target))}
    >
      {button}
    </AssignPicker>
  );
}
