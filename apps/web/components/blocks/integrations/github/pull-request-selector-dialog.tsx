"use client";

import { useMemo, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { GitPullRequest } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { attachedPullRequestName, parseAttachedPullRequest, toAttachedPullRequest, type AttachedPullRequest } from "@/convex/lib/contracts/github";
import { PullRequestStateIcon } from "./pull-request-state-icon";
import { useIntegrationStatus } from "./use-integration-status";
import { Spinner } from "@/components/custom/spinner";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const PAGE_SIZE = 30;

type PullRequestSelectorDialogProps = {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (pullRequest: AttachedPullRequest) => void;
};

/** Open PRs in the project's connected repositories; a pasted PR URL or owner/repo#number from anywhere attaches too. */
export function PullRequestSelectorDialog({ projectId, open, onOpenChange, onSelect }: PullRequestSelectorDialogProps) {
  const [query, setQuery] = useState("");
  const status = useIntegrationStatus(open ? projectId : undefined);
  const { results, status: listStatus, loadMore } = usePaginatedQuery(
    api.integrations.github.pullRequests.list,
    open ? { projectId, tab: "open", sort: "updated", order: "desc" } : "skip",
    { initialNumItems: PAGE_SIZE }
  );
  const repositories = useMemo(
    () => new Map((status?.connections ?? []).map((connection) => [connection.repositoryId, connection.repository])),
    [status]
  );
  const pasted = parseAttachedPullRequest(query);
  const needle = query.trim().replace(/^#/, "").toLowerCase();
  const rows = results.flatMap((pr) => {
    const repository = repositories.get(pr.repositoryId);
    if (!repository) return [];
    const matches = !needle || pr.title.toLowerCase().includes(needle) || String(pr.number).startsWith(needle);
    return matches ? [{ pr, repository }] : [];
  });

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) setQuery("");
  };
  const select = (pullRequest: AttachedPullRequest) => {
    onSelect(pullRequest);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="h-[32rem] overflow-hidden border-none p-0 outline outline-border sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Attach pull request</DialogTitle>
        <DialogDescription className="sr-only">Search open pull requests, or paste a GitHub pull request URL.</DialogDescription>
        <Command shouldFilter={false} className="rounded-xl">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search pull requests or paste a URL..." autoFocus />
          <CommandList className="mt-1 max-h-none min-h-0 flex-1">
            <div className="space-y-1 p-1">
              {pasted ? (
                <CommandItem value={`pasted-${pasted.ref}`} onSelect={() => select(pasted)}>
                  <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    Attach {attachedPullRequestName(pasted)}
                  </span>
                </CommandItem>
              ) : null}
              {rows.map(({ pr, repository }) => (
                <CommandItem
                  key={pr._id}
                  value={pr._id}
                  onSelect={() => select(toAttachedPullRequest({ owner: repository.owner, name: repository.name, number: pr.number }))}
                >
                  <div className="flex w-full min-w-0 items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
                      <PullRequestStateIcon pr={pr} />
                      <span className="shrink-0 text-xs text-muted-foreground">#{pr.number}</span>
                      <span className="truncate">{pr.title}</span>
                    </div>
                    <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                      {repository.name} · {pr.author}
                    </span>
                  </div>
                </CommandItem>
              ))}
              {listStatus === "CanLoadMore" || listStatus === "LoadingMore" ? (
                <CommandItem
                  value="load-more"
                  className="justify-center text-muted-foreground"
                  onSelect={() => loadMore(PAGE_SIZE)}
                  disabled={listStatus === "LoadingMore"}
                >
                  {listStatus === "LoadingMore" ? <Spinner text="Loading…" textPlacement="inline" /> : "Load more"}
                </CommandItem>
              ) : null}
            </div>
            {!pasted && rows.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                {/* Rows need their repository, so the status query loading is loading too. */}
                {listStatus === "LoadingFirstPage" || status === undefined
                  ? "Loading…"
                  : results.length === 0
                    ? "No open pull requests in connected repositories. Paste a GitHub pull request URL to attach one."
                    : listStatus === "CanLoadMore"
                      ? "No loaded pull requests match. Load more, or paste a pull request URL."
                      : "No pull requests found"}
              </div>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
