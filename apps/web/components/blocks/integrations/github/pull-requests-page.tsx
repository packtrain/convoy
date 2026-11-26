"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { formatDistanceToNow } from "date-fns";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, CircleX, GitPullRequest, Github } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SettingsCatalogListFrame } from "@/components/blocks/settings-catalog/settings-catalog-list-frame";
import { EmptyState } from "@/components/custom/empty-state";
import { SearchInput } from "@/components/custom/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAppConvexAuth } from "@/lib/auth/hooks";
import { AppLink, appRoute, PULL_REQUEST_TABS, useNavigation, useRouteParams } from "@/lib/navigation";
import { useCurrentOrgProject } from "@/lib/routing/current-org-project-context";
import { NoAccess } from "@/components/blocks/no-access";
import { PullRequestCheckIcons, usePullRequestListChecks } from "@/components/blocks/checks";
import { isSameRepository, toAttachedPullRequest } from "@/convex/lib/contracts/github";
import { Checkbox } from "@/components/ui/checkbox";
import { useLinkedGithubAccounts } from "./linked-github-account";
import { PEOPLE_FILTERS, PullRequestBrowser, PullRequestBrowserSkeleton, repositoryName } from "./pull-request-browser";
import { BulkActionsBar } from "./pull-request-bulk-actions";
import { PullRequestReader, PullRequestReaderSkeleton } from "./pull-request-reader";
import { StackBadge } from "./pull-request-stack";
import { StartThreadButton } from "./start-thread-button";
import { PullRequestStateIcon } from "./pull-request-state-icon";
import { syncErrorText, useIntegrationStatus, type IntegrationStatus } from "./use-integration-status";
import { coverageNotice, usePullRequestList } from "./use-pull-request-list";
import { usePullRequestSearch, type PullRequestSearchHit } from "./use-pull-request-search";

type Summary = FunctionReturnType<typeof api.integrations.github.pullRequests.list>["page"][number];
type Connection = IntegrationStatus["connections"][number];
type ListOptions = Omit<FunctionArgs<typeof api.integrations.github.pullRequests.list>, "projectId" | "paginationOpts">;

const DEFAULT_OPTIONS: ListOptions = { tab: "open", sort: "updated", order: "desc" };

/** The project's PR page: the list, or the reader when `?repo=&pr=` name one PR. Filters survive opening a PR. */
export function PullRequestsPage() {
  const { organizationSlug, projectAlias } = useRouteParams<{ organizationSlug: string; projectAlias: string }>();
  const { organizationId } = useCurrentOrgProject();
  const { isAuthenticated } = useAppConvexAuth();
  const navigation = useNavigation();
  const project = useQuery(api.projects.core.getByAlias, isAuthenticated ? { organizationId, alias: projectAlias } : "skip");
  const projectId = project?._id;
  const status = useIntegrationStatus(projectId);
  const [options, setOptions] = useState<ListOptions>(DEFAULT_OPTIONS);
  const accounts = useLinkedGithubAccounts();
  const you = accounts?.organizations.find((organization) => organization.organizationId === organizationId)?.account?.githubUserId;
  // Disconnecting clears an active You filter.
  if (accounts !== undefined && you === undefined && (options.author || options.assignee)) {
    setOptions((current) => ({ ...current, author: undefined, assignee: undefined }));
  }
  // Live GitHub search, shared by the list and the reader pane.
  const [query, setQuery] = useState("");
  const params = new URLSearchParams(navigation.location.search);
  const repositoryId = resolveRepository(params.get("repo"), status);
  const number = Number(params.get("pr"));
  const tab = PULL_REQUEST_TABS.find((name) => name === params.get("tab"));

  if (project === null) {
    return <NoAccess organizationSlug={organizationSlug} message="You don't have access to this project." />;
  }
  const active = status?.connections.filter((connection) => connection.status === "active") ?? [];

  const prHref = (repository: string, pr: number) => appRoute.projectPullRequest(organizationSlug, projectAlias, repository, pr);
  const listHref = appRoute.projectPullRequests(organizationSlug, projectAlias);

  if (repositoryId && Number.isInteger(number) && number > 0) {
    return (
      <main className="flex h-svh min-h-0 flex-col bg-background text-foreground md:flex-row">
        {!projectId || status === undefined ? (
          <>
            <PullRequestBrowserSkeleton />
            <PullRequestReaderSkeleton tab={tab} backHref={listHref} />
          </>
        ) : (
          <>
            {status && active.length ? (
              <PullRequestBrowser
                projectId={projectId}
                active={active}
                you={you}
                filters={{ ...options, query }}
                onFiltersChange={({ query: nextQuery, ...change }) => {
                  if (nextQuery !== undefined) setQuery(nextQuery);
                  setOptions((current) => ({ ...current, ...change }));
                }}
                current={{ repositoryId, number }}
                hrefFor={prHref}
                backHref={listHref}
              />
            ) : null}
            <PullRequestReader
              key={`${repositoryId}#${number}`}
              projectId={projectId}
              repositoryId={repositoryId}
              number={number}
              status={status}
              hrefFor={prHref}
              organizationSlug={organizationSlug}
              projectAlias={projectAlias}
              defaultTab={tab}
              backHref={listHref}
              onTabChange={(next) =>
                navigation.replace(appRoute.projectPullRequest(organizationSlug, projectAlias, repositoryId, number, next))
              }
            />
          </>
        )}
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Pull requests</h1>
        {status?.canManage && active.length ? (
          <Button variant="outline" size="sm" asChild>
            <AppLink href={appRoute.projectGithubIntegration(organizationSlug, projectAlias)}>Manage repositories</AppLink>
          </Button>
        ) : null}
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-5 py-6 md:px-8">
          {projectId === undefined || status === undefined ? (
            <ListSkeleton toolbar />
          ) : status && active.length ? (
            <PullRequestList
              projectId={projectId}
              status={status}
              active={active}
              you={you}
              options={options}
              onOptionsChange={(change) => setOptions((current) => ({ ...current, ...change }))}
              query={query}
              onQueryChange={setQuery}
              organizationSlug={organizationSlug}
              projectAlias={projectAlias}
            />
          ) : (
            <EmptyState
              fill
              icon={Github}
              title="No connected repositories"
              description={
                status?.canManage
                  ? "Connect GitHub repositories to browse their pull requests here."
                  : "A project admin can connect GitHub repositories in Integrations settings."
              }
              action={
                status?.canManage ? (
                  <Button variant="secondary" asChild>
                    <AppLink href={appRoute.projectGithubIntegration(organizationSlug, projectAlias)}>Open Integrations</AppLink>
                  </Button>
                ) : null
              }
            />
          )}
        </div>
      </div>
    </main>
  );
}

/** `?repo=` holds a repository ID, or `owner/name` from a message link (docs/specs/cli-thread-message-links.md). */
function resolveRepository(repo: string | null, status: IntegrationStatus | null | undefined): string | null {
  const [owner, name, ...rest] = repo?.split("/") ?? [];
  if (!repo || name === undefined || rest.length) return repo;
  return status?.connections.find((connection) => isSameRepository(connection.repository, { owner, name }))?.repositoryId ?? repo;
}

/** Mirrors the list: tabs, filter and sort (until they render), then framed two-line rows. */
function ListSkeleton({ toolbar = false }: { toolbar?: boolean }) {
  return (
    <div className="flex flex-col gap-5" aria-label="Loading pull requests">
      {toolbar ? (
        <div data-testid="pull-request-toolbar-skeleton" className="flex items-center gap-1">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="ml-auto h-8 w-32" />
          <Skeleton className="ml-1 h-8 w-24" />
        </div>
      ) : null}
      <SettingsCatalogListFrame>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-1 p-4">
            <div className="flex h-5 items-center gap-1.5">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-3.5 w-2/5" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        ))}
      </SettingsCatalogListFrame>
    </div>
  );
}

function PullRequestList({
  projectId,
  status,
  active,
  you,
  options,
  onOptionsChange,
  query,
  onQueryChange,
  organizationSlug,
  projectAlias,
}: {
  projectId: Id<"projects">;
  status: IntegrationStatus;
  active: Connection[];
  /** The Linked GitHub user ID; the You filters show only with one. */
  you: number | undefined;
  options: ListOptions;
  onOptionsChange: (change: Partial<ListOptions>) => void;
  query: string;
  onQueryChange: (query: string) => void;
  organizationSlug: string;
  projectAlias: string;
}) {
  // A filter naming a repository that was disconnected meanwhile falls back to all.
  const filtered = active.find((connection) => connection.repositoryId === options.repositoryId);
  const scope = filtered ? [filtered] : active;
  const list = usePullRequestList(projectId, { ...options, repositoryId: filtered?.repositoryId }, scope);
  const search = usePullRequestSearch(projectId, query, { ...options, repositoryId: filtered?.repositoryId, viewer: you });
  const { results, status: pageStatus } = list;
  const repositories = new Map(active.map((connection) => [connection.repositoryId, connection.repository]));
  const failed = scope.filter((connection) => connection.repository.syncStatus === "error");
  const importing = scope.some((connection) => connection.repository.syncStatus === "importing");
  // Partial counts mislead, so a backfilling repository hides them until it finishes. Counts ignore the You filters, so those hide them too.
  const counting = scope.some((connection) => connection.repository.counting) || Boolean(options.author || options.assignee);
  const counts = {
    open: scope.reduce((sum, connection) => sum + connection.repository.openCount, 0),
    // Stored closed PRs are GitHub's total only once every history page is in.
    closed: scope.every((connection) => connection.repository.history.complete)
      ? scope.reduce((sum, connection) => sum + connection.repository.closedCount, 0)
      : null,
  };
  const SortIcon = options.order === "desc" ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  // With nothing to show and every repository failing, the empty state carries the error instead.
  const allFailed = failed.length > 0 && failed.length === scope.length;
  const notice = search.active ? null : coverageNotice(list.coveredSince, options);
  const refOf = (pr: { repositoryId: Id<"integrationRepositories">; number: number }) => {
    const repository = repositories.get(pr.repositoryId);
    return repository ? toAttachedPullRequest({ owner: repository.owner, name: repository.name, number: pr.number }).ref : undefined;
  };
  // Search hits are PRs too, so they show the same icons as stored rows.
  const shown = search.active ? search.results : results;
  const listChecks = usePullRequestListChecks(projectId, shown.flatMap((pr) => refOf(pr) ?? []));
  const checksOf = (pr: { repositoryId: Id<"integrationRepositories">; number: number }) => listChecks.get(refOf(pr) ?? "");
  // Changing a filter, the sort, or the tab clears the selection.
  const [selection, setSelection] = useState<{ options: ListOptions; ids: Id<"integrationPullRequests">[] }>({ options, ids: [] });
  const selectedIds = selection.options === options ? selection.ids : [];
  const select = (ids: Id<"integrationPullRequests">[]) => setSelection({ options, ids });
  const selected = results.filter((pr) => selectedIds.includes(pr._id));

  return (
    <>
      {failed.length && !(allFailed && results.length === 0 && pageStatus !== "LoadingFirstPage") ? (
        <div role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">
          {failed.map((connection) => (
            <p key={connection.repositoryLinkId}>
              {repositoryName(connection)}: {syncErrorText(connection.repository)}. Showing the last successful update.
            </p>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {/* Searching spans every state, so it deselects the tabs; picking one clears the search. */}
        <div className="flex gap-1" aria-label="Pull request state" role="group">
          {(["open", "closed"] as const).map((tab) => (
            <Button
              key={tab}
              size="sm"
              variant={options.tab === tab && !search.active ? "secondary" : "ghost"}
              aria-pressed={options.tab === tab && !search.active}
              onClick={() => {
                onQueryChange("");
                onOptionsChange({ tab });
              }}
            >
              {tab === "open" ? "Open" : "Closed"}
              {counting || counts[tab] === null ? null : <span className="text-xs tabular-nums text-muted-foreground">{counts[tab]}</span>}
            </Button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2">
          <SearchInput
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search pull requests"
            aria-label="Search pull requests"
            showClearButton={query !== ""}
            onClear={() => onQueryChange("")}
            className="min-w-56 flex-1"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="settings" aria-label="Filter by repository">
                {filtered ? repositoryName(filtered) : "All repositories"}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max">
              <DropdownMenuRadioGroup
                value={filtered?.repositoryId ?? "all"}
                onValueChange={(value) => onOptionsChange({ repositoryId: value === "all" ? undefined : value })}
              >
                <DropdownMenuRadioItem value="all">All repositories</DropdownMenuRadioItem>
                {active.map((connection) => (
                  <DropdownMenuRadioItem key={connection.repositoryId} value={connection.repositoryId}>
                    {repositoryName(connection)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {you !== undefined
            ? PEOPLE_FILTERS.map(({ key, label, all }) => (
                <DropdownMenu key={key}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="settings" aria-label={`Filter by ${label.toLowerCase()}`}>
                      {options[key] ? `${label}: You` : all}
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-max">
                    <DropdownMenuRadioGroup
                      value={options[key] ?? "all"}
                      onValueChange={(value) => onOptionsChange({ [key]: value === "me" ? "me" : undefined })}
                    >
                      <DropdownMenuRadioItem value="all">{all}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="me">You</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ))
            : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="settings"
                aria-label="Sort pull requests"
                title={`Sort by ${options.sort === "created" ? "created on" : "last updated"}`}
              >
                <SortIcon />
                {options.order === "desc" ? "Newest" : "Oldest"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={options.sort} onValueChange={(value) => onOptionsChange({ sort: value === "created" ? "created" : "updated" })}>
                <DropdownMenuRadioItem value="created">Created on</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="updated">Last updated</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Order</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={options.order} onValueChange={(value) => onOptionsChange({ order: value === "asc" ? "asc" : "desc" })}>
                <DropdownMenuRadioItem value="asc">
                  <ArrowUpNarrowWide />
                  Oldest
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc">
                  <ArrowDownWideNarrow />
                  Newest
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {search.active ? (
        <SearchResults
          search={search}
          checksOf={checksOf}
          projectId={projectId}
          repositories={repositories}
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
        />
      ) : pageStatus === "LoadingFirstPage" || (list.importing && !results.length) ? (
        <ListSkeleton />
      ) : results.length ? (
        <SettingsCatalogListFrame>
          <BulkActionsBar projectId={projectId} organizationSlug={organizationSlug} rows={results} selected={selected} onSelectionChange={select} />
          {notice ? <p className="p-4 text-sm text-muted-foreground">{notice}</p> : null}
          {results.map((pr) => (
            <PullRequestRow
              key={pr._id}
              pr={pr}
              selected={selectedIds.includes(pr._id)}
              onSelectedChange={(checked) => select(checked ? [...selectedIds, pr._id] : selectedIds.filter((id) => id !== pr._id))}
              checks={checksOf(pr)}
              projectId={projectId}
              repository={repositories.get(pr.repositoryId)}
              organizationSlug={organizationSlug}
              projectAlias={projectAlias}
            />
          ))}
        </SettingsCatalogListFrame>
      ) : (
        <EmptyList
          tab={options.tab}
          importing={importing}
          failed={allFailed ? failed[0] : undefined}
          canManage={status.canManage}
          filtered={Boolean(filtered || options.author || options.assignee)}
          onReset={() => onOptionsChange({ repositoryId: undefined, author: undefined, assignee: undefined })}
        />
      )}
      {list.hasMore && !search.active ? (
        <Button variant="outline" size="sm" className="self-start" disabled={list.isLoadingMore} onClick={list.loadMore}>
          {list.isLoadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </>
  );
}

/** Live results: temporary rows that never store a PR, with GitHub's partial and failed answers named. */
function SearchResults({
  search,
  checksOf,
  projectId,
  repositories,
  organizationSlug,
  projectAlias,
}: {
  search: ReturnType<typeof usePullRequestSearch>;
  checksOf: (pr: PullRequestSearchHit) => Parameters<typeof PullRequestCheckIcons>[0]["checks"];
  projectId: Id<"projects">;
  repositories: Map<string, Connection["repository"]>;
  organizationSlug: string;
  projectAlias: string;
}) {
  const notices = [
    ...search.failures.map((failure) => `${failure.repositories.join(", ")}: ${failure.message}`),
    ...(search.omittedRepositories ? [`${search.omittedRepositories} more repositories weren't searched. Filter by repository to search them.`] : []),
    ...(search.incomplete ? ["GitHub returned partial results. Filter by repository or add words to narrow the search."] : []),
  ];
  return (
    <>
      {notices.length ? (
        <div role="status" className="rounded-lg bg-muted px-4 py-3 text-sm">
          {notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
      ) : null}
      {search.loading && !search.results.length ? (
        <ListSkeleton />
      ) : search.results.length ? (
        <SettingsCatalogListFrame>
          {search.results.map((pr) => (
            <PullRequestRow
              key={`${pr.repositoryId}#${pr.number}`}
              pr={pr}
              checks={checksOf(pr)}
              projectId={projectId}
              repository={repositories.get(pr.repositoryId)}
              organizationSlug={organizationSlug}
              projectAlias={projectAlias}
            />
          ))}
        </SettingsCatalogListFrame>
      ) : search.retryable ? null : (
        <EmptyState icon={GitPullRequest} title="No matching pull requests" description="GitHub found nothing for this search in the connected repositories." />
      )}
      {search.retryable ? (
        <div className="flex items-center gap-3 text-sm text-destructive">
          <span>{search.error ?? "Some repositories weren't searched."}</span>
          <Button variant="outline" size="sm" disabled={search.loading} onClick={search.loadMore}>
            Retry
          </Button>
        </div>
      ) : search.hasMore ? (
        <Button variant="outline" size="sm" className="self-start" disabled={search.loading} onClick={search.loadMore}>
          {search.loading ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </>
  );
}

function EmptyList({
  tab,
  importing,
  failed,
  canManage,
  filtered,
  onReset,
}: {
  tab: ListOptions["tab"];
  importing: boolean;
  /** Set when every repository in scope failed, so there is nothing to show. */
  failed: Connection | undefined;
  canManage: boolean;
  filtered: boolean;
  onReset: () => void;
}) {
  if (failed && tab === "open") {
    return (
      <EmptyState
        icon={GitPullRequest}
        title="Couldn't import pull requests"
        description={`${syncErrorText(failed.repository)}. ${canManage ? "Use Sync again in Integrations settings." : "A project admin can retry it in Integrations settings."}`}
      />
    );
  }
  if (importing && tab === "open") {
    return <EmptyState icon={GitPullRequest} title="Importing pull requests…" description="They appear here as they arrive." />;
  }
  return (
    <EmptyState
      icon={GitPullRequest}
      title={tab === "open" ? "No open pull requests" : "No closed pull requests"}
      description={
        tab === "open"
          ? "Open pull requests from the connected repositories show up here."
          : "Closed and merged pull requests from the connected repositories show up here."
      }
      action={
        filtered ? (
          <Button variant="secondary" onClick={onReset}>
            Clear filters
          </Button>
        ) : null
      }
    />
  );
}

function PullRequestRow({
  pr,
  selected,
  onSelectedChange,
  checks,
  projectId,
  repository,
  organizationSlug,
  projectAlias,
}: {
  pr: Summary | PullRequestSearchHit;
  /** Stored rows only: search hits take no bulk actions. */
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** Its current results for the Checks shown in the list (OS-2400). */
  checks?: Parameters<typeof PullRequestCheckIcons>[0]["checks"];
  projectId: Id<"projects">;
  repository: Connection["repository"] | undefined;
  organizationSlug: string;
  projectAlias: string;
}) {
  // A search hit has no stored row, so no conflicts mark, archive flag, or stack.
  const stored = "headRef" in pr ? pr : null;
  return (
    // The title link covers the row, leaving the stack badge clickable on top.
    <div
      className={cn(
        "relative flex items-center gap-3 p-4 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/50",
        selected && "bg-accent/60"
      )}
    >
      {onSelectedChange ? (
        <Checkbox
          className="relative z-10"
          aria-label={`Select pull request #${pr.number}`}
          checked={selected}
          onCheckedChange={(checked) => onSelectedChange(checked === true)}
        />
      ) : null}
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <PullRequestStateIcon pr={pr} />
          <AppLink
            href={appRoute.projectPullRequest(organizationSlug, projectAlias, pr.repositoryId, pr.number)}
            className="truncate text-sm font-medium after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            {pr.title}
          </AppLink>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {repository ? `${repository.owner}/${repository.name}` : ""} #{pr.number} · {pr.author} · updated {formatDistanceToNow(pr.providerUpdatedAt, { addSuffix: true })}
        </span>
      </span>
      <PullRequestCheckIcons checks={checks} />
      {stored?.conflicts ? (
        <Badge variant="outline" className="shrink-0 text-destructive">
          <CircleX />
          Conflicts
        </Badge>
      ) : null}
      {stored?.archived ? (
        <Badge variant="secondary" className="shrink-0">
          Archived
        </Badge>
      ) : null}
      {stored ? (
        <StackBadge
          pr={stored}
          projectId={projectId}
          hrefFor={(number) => appRoute.projectPullRequest(organizationSlug, projectAlias, pr.repositoryId, number)}
        />
      ) : null}
      {pr.labels.slice(0, 2).map((label) => (
        <Badge key={label} variant="outline" className="hidden shrink-0 sm:inline-flex">
          {label}
        </Badge>
      ))}
      {repository ? (
        <StartThreadButton
          organizationSlug={organizationSlug}
          projectAlias={projectAlias}
          pullRequest={{ owner: repository.owner, name: repository.name, number: pr.number }}
          className="relative z-10"
        />
      ) : null}
    </div>
  );
}
