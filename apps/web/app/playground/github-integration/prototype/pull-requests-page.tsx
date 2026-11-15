import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, GitPullRequest } from "lucide-react";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PeopleFilter, SearchPicker, PersonAvatar, AssignPicker } from "./people-picker";
import { SortMenu } from "./sort-menu";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/custom/search-input";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/custom/empty-state";
import { Picker, PrState, StackBadge } from "./controls";
import { filterPullRequests, isOpen, mergeStatusFor, pageSize, prKey, type PrFilters, type PullRequest } from "./fixtures";

export function PullRequestsPage({
  records,
  onRecordsChange,
  canManage,
  connected,
  stored,
  filters,
  onFiltersChange,
  currentUser,
  onOpen,
  onSettings,
  stale,
}: {
  records: PullRequest[];
  onRecordsChange: (records: PullRequest[]) => void;
  canManage: boolean;
  connected: string[];
  stored: string[];
  filters: PrFilters;
  onFiltersChange: (change: Partial<PrFilters>) => void;
  currentUser: string | null;
  onOpen: (pr: PullRequest) => void;
  onSettings: () => void;
  stale: boolean;
}) {
  const [selection, setSelection] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  // Filters also change from the reader sidebar, so reset selection on any change.
  const [selectionFilters, setSelectionFilters] = useState(filters);
  if (selectionFilters !== filters) {
    setSelectionFilters(filters);
    setSelection([]);
    setNotice("");
  }
  const { tab, query, repo, author, assignee, searchState, field, order, page } = filters;
  const scoped = records.filter((pr) => connected.includes(pr.repo));
  const searching = query.trim().length > 0;
  const matches = filterPullRequests(scoped, filters, currentUser);
  const paged = searching || tab === "closed";
  const rows = paged ? matches.slice(page * pageSize, (page + 1) * pageSize) : matches;
  const selected = rows.filter((pr) => selection.includes(prKey(pr)));
  function updateSelected(
    update: (pr: PullRequest) => PullRequest,
    message?: string,
    clear = false,
  ) {
    if (!canManage) return;
    const ids = new Set(selected.map(prKey));
    onRecordsChange(records.map((pr) => (ids.has(prKey(pr)) ? update(pr) : pr)));
    if (message) setNotice(message);
    if (clear) setSelection([]);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden border-b border-border px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="truncate text-sm font-medium leading-5 text-foreground">Pull requests</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={onSettings}>
            Manage repositories
          </Button>
        </div>
      </header>
      <div
        data-pr-list-content
        className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-5 py-6 md:px-8"
      >
        {!connected.length ? (
          <Empty className="min-h-80 flex-1 rounded-lg border border-border bg-background">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GitPullRequest className="size-6" />
              </EmptyMedia>
              <EmptyTitle>No connected repositories</EmptyTitle>
              <EmptyDescription>
                Connect GitHub in project settings to read pull requests and code with your team.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="secondary" onClick={onSettings}>
                Open Integrations
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            {stale ? (
              <div role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">
                GitHub is temporarily unavailable. Showing the last successful update.
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1" aria-label="PR state">
                {["open", "closed"].map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={!searching && tab === value ? "secondary" : "ghost"}
                    aria-pressed={!searching && tab === value}
                    onClick={() => onFiltersChange({ tab: value, query: "" })}
                  >
                    {value === "open" ? (
                      <>
                        Open <Badge variant="secondary">{scoped.filter(isOpen).length}</Badge>
                      </>
                    ) : (
                      "Closed & merged"
                    )}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-48 flex-1 sm:max-w-sm">
                <SearchInput
                  aria-label="Search pull requests"
                  placeholder="Search GitHub pull requests…"
                  value={query}
                  showClearButton={searching}
                  onClear={() => onFiltersChange({ query: "" })}
                  onChange={(event) => {
                    onFiltersChange({ query: event.target.value });
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
                <SearchPicker
                  title="Filter by repository"
                  label="Repository"
                  value={repo}
                  onChange={(value) => onFiltersChange({ repo: value })}
                  options={[
                    { value: "all", label: "All repositories" },
                    ...connected.map((value) => ({ value, label: value })),
                  ]}
                />
                <PeopleFilter
                  you={!!currentUser}
                  kind="Author"
                  value={author}
                  onChange={(value) => onFiltersChange({ author: value })}
                />
                <PeopleFilter
                  you={!!currentUser}
                  kind="Assignee"
                  value={assignee}
                  onChange={(value) => onFiltersChange({ assignee: value })}
                />
                {searching ? (
                  <Picker
                    label="Search state"
                    value={searchState}
                    onChange={(value) => {
                      onFiltersChange({ searchState: value });
                    }}
                    options={["all", "open", "merged", "closed"].map((value) => ({
                      value,
                      label: value === "all" ? "All states" : value,
                    }))}
                  />
                ) : null}
                <SortMenu
                  field={field}
                  order={order}
                  onField={(value) => onFiltersChange({ field: value })}
                  onOrder={(value) => onFiltersChange({ order: value })}
                />
              </div>
            </div>
            {notice ? (
              <p role="status" className="text-xs text-muted-foreground">
                {notice}
              </p>
            ) : null}
            {rows.length > 0 ? (
              <SettingsCatalogListFrame>
                <div className="flex min-h-12 flex-wrap items-center gap-3 rounded-t-lg bg-muted/40 px-4 py-2">
                  <Checkbox
                    aria-label="Select all visible pull requests"
                    disabled={!canManage}
                    checked={
                      selected.length === rows.length
                        ? true
                        : selected.length
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) => setSelection(checked ? rows.map(prKey) : [])}
                  />
                  <span className="text-xs font-medium">
                    {selected.length
                      ? `${selected.length} of ${rows.length} selected`
                      : `${rows.length} pull requests`}
                  </span>
                  {selected.length && canManage ? (
                    <div className="ml-auto flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm">
                            Mark as
                            <ChevronDown />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={selected.every(
                              (pr) => pr.state === "merged" || pr.state === "closed",
                            )}
                            onSelect={() =>
                              updateSelected(
                                (pr) => (pr.state === "merged" ? pr : { ...pr, state: "closed" }),
                                "Selected open PRs marked closed in this demo.",
                                true,
                              )
                            }
                          >
                            Closed
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              updateSelected(
                                // GitHub's archive closes the PR and locks its conversation.
                                (pr) => ({ ...pr, archived: true, state: pr.state === "merged" ? "merged" : "closed" }),
                                "Selected PRs archived and closed in this demo.",
                                true,
                              )
                            }
                          >
                            Archived
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              updateSelected(
                                (pr) => ({ ...pr, archived: false }),
                                "Selected PRs unarchived in this demo. They stay closed.",
                              )
                            }
                          >
                            Unarchived
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <AssignPicker
                        assignments={selected.map((pr) => pr.assignees)}
                        onClear={() =>
                          updateSelected(
                            (pr) => ({ ...pr, assignees: [] }),
                          )
                        }
                        onToggle={(id) => {
                          const remove = selected.every((pr) => pr.assignees.includes(id));
                          updateSelected(
                            (pr) => ({
                              ...pr,
                              assignees: remove
                                ? pr.assignees.filter((value) => value !== id)
                                : [...new Set([...pr.assignees, id])],
                            }),
                          );
                        }}
                      />
                      <Button variant="ghost" size="sm" onClick={() => setSelection([])}>
                        Clear
                      </Button>
                    </div>
                  ) : null}
                </div>
                {rows.map((pr) => (
                  <div
                    key={prKey(pr)}
                    className={`relative isolate flex w-full items-center gap-3 p-4 transition-colors last:rounded-b-lg hover:bg-muted/50 ${selection.includes(prKey(pr)) ? "bg-accent/60" : ""}`}
                  >
                    <Checkbox
                      className="relative z-10"
                      aria-label={`Select PR ${pr.number}`}
                      disabled={!canManage}
                      checked={selection.includes(prKey(pr))}
                      onCheckedChange={(checked) =>
                        setSelection((current) =>
                          checked
                            ? [...current, prKey(pr)]
                            : current.filter((id) => id !== prKey(pr)),
                        )
                      }
                    />
                    <button
                      onClick={() => onOpen(pr)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                    >
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <PrState state={pr.state} />
                          <span className="truncate text-sm font-medium">{pr.title}</span>
                          {pr.archived ? <Badge variant="secondary">Archived</Badge> : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {pr.repo} #{pr.number} · {pr.author} · {pr.updated}
                          {pr.state === "draft" ? " · Draft" : ""}
                          {isOpen(pr) && mergeStatusFor(pr).conflicts ? <span className="text-destructive"> · Conflicts</span> : null}
                        </span>
                      </span>
                      <span
                        aria-label={`Assignees: ${pr.assignees.join(", ") || "nobody"}`}
                        className="hidden shrink-0 -space-x-1 sm:flex"
                      >
                        {pr.assignees.map((id) => (
                          <PersonAvatar key={id} id={id} />
                        ))}
                      </span>
                      <Badge variant="outline" className="ml-auto shrink-0">
                        {pr.label}
                      </Badge>
                    </button>
                    <StackBadge records={records} pr={pr} onSelect={onOpen} />
                  </div>
                ))}
              </SettingsCatalogListFrame>
            ) : null}
            {!rows.length ? (
              <Empty className="min-h-80 rounded-lg border border-border bg-background">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <GitPullRequest className="size-6" />
                  </EmptyMedia>
                  <EmptyTitle>No pull requests found</EmptyTitle>
                  <EmptyDescription>Try another search or remove a filter.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      onFiltersChange({
                        repo: "all",
                        author: "all",
                        assignee: "all",
                        searchState: "all",
                        query: "",
                        tab: "open",
                      });
                    }}
                  >
                    Reset filters
                  </Button>
                </EmptyContent>
              </Empty>
            ) : null}
            {paged && matches.length ? (
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  Page {page + 1} of {Math.ceil(matches.length / pageSize)}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => {
                      onFiltersChange({ page: page - 1 });
                    }}
                  >
                    <ChevronLeft />
                    Newer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * pageSize >= matches.length}
                    onClick={() => {
                      onFiltersChange({ page: page + 1 });
                    }}
                  >
                    Older
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            ) : null}
            {searching ? null : (
              <div className="text-xs text-muted-foreground">
                {tab === "closed" ? null : "Open PRs update automatically from GitHub."}
                <span className="sr-only">{stored.length} metadata records</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
