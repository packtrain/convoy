"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ExternalLink, LockKeyhole, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getErrorMessage, showConvexErrorToast } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { IntegrationStatus } from "./use-integration-status";

type Candidate = FunctionReturnType<typeof api.integrations.github.setup.listSetupRepositories>["repositories"][number];

/** Group the listed repositories under their owner, in listing order. */
function groupByOwner(repositories: Candidate[]): [string, Candidate[]][] {
  const groups = new Map<string, Candidate[]>();
  for (const repository of repositories) {
    const owner = repository.fullName.split("/")[0];
    groups.set(owner, [...(groups.get(owner) ?? []), repository]);
  }
  return [...groups];
}

/**
 * Choose the project's repositories: checked ones the admin's GitHub account
 * administers connect (GitHub rechecks each), and unchecked connected ones disconnect.
 */
export function RepositoryPickerDialog({
  setupId,
  installUrl,
  connections,
  onClose,
}: {
  setupId: Id<"integrationSetups">;
  installUrl: string | null;
  connections: IntegrationStatus["connections"];
  onClose: () => void;
}) {
  const listRepositories = useAction(api.integrations.github.setup.listSetupRepositories);
  const saveRepositories = useAction(api.integrations.github.setup.saveRepositories);
  const cancelSetup = useMutation(api.integrations.github.setup.cancelSetup);
  const active = connections.filter((connection) => connection.status === "active");
  const activeIds = new Set(active.map((connection) => connection.repository.providerRepositoryId));
  const [listed, setRepositories] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(activeIds));
  const [shareConsent, setShareConsent] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Follows every cursor (one per App installation page) and lists all at once, so a reload never shrinks the list.
  const fetchAll = useCallback(async () => {
    try {
      const all: Candidate[] = [];
      let cursor: string | undefined;
      do {
        const page = await listRepositories({ setupId, cursor });
        all.push(...page.repositories);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      setRepositories(all);
    } catch (error) {
      setLoadError(getErrorMessage(error, "Could not load your GitHub repositories"));
    } finally {
      setLoading(false);
    }
  }, [listRepositories, setupId]);

  // One request chain at a time: Refresh and the focus reload wait until it settles.
  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Installing the App happens in a GitHub tab; coming back reloads the list.
  useEffect(() => {
    if (loading) return;
    const reload = () => load();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [load, loading]);

  // Connected repositories this GitHub account cannot see stay listed, so they can be removed.
  const repositories = listed && [
    ...listed,
    ...active
      .filter((connection) => !listed.some((candidate) => candidate.providerRepositoryId === connection.repository.providerRepositoryId))
      .map(({ repository }) => ({
        providerRepositoryId: repository.providerRepositoryId,
        fullName: `${repository.owner}/${repository.name}`,
        isPrivate: repository.isPrivate,
        isAdmin: false,
      })),
  ];
  const empty = repositories?.length === 0;
  const showList = repositories === null ? !loadError : !empty;

  const cancel = () => {
    cancelSetup({ setupId }).catch(() => {});
    onClose();
  };

  const added = [...selected].filter((id) => !activeIds.has(id));
  const removed = active.filter((connection) => !selected.has(connection.repository.providerRepositoryId));
  const toggle = (id: number, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = async () => {
    setConnecting(true);
    try {
      // One transaction: a failed connect leaves the removed repositories connected.
      await saveRepositories({
        setupId,
        providerRepositoryIds: added,
        removeRepositoryLinkIds: removed.map((connection) => connection.repositoryLinkId),
      });
      onClose();
    } catch (error) {
      setConnecting(false);
      showConvexErrorToast(error, "Could not save the repositories");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !connecting && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose repositories</DialogTitle>
          <DialogDescription>Pick the repositories whose pull requests this project shows.</DialogDescription>
        </DialogHeader>
        {showList ? (
          <div role="group" aria-label="Repositories" className="max-h-72 overflow-y-auto rounded-md border">
            {repositories === null && !loadError ? (
              <div className="space-y-2 p-3" aria-label="Loading repositories">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            ) : null}
            {groupByOwner(repositories ?? []).map(([owner, members]) => (
              <div key={owner} role="group" aria-label={owner}>
                <p className="sticky top-0 bg-background px-3 py-3 text-xs font-medium text-muted-foreground">{owner}</p>
                {members.map((repository) => {
                  const id = repository.providerRepositoryId;
                  const checked = selected.has(id);
                  // Connecting needs GitHub admin; removing an already connected repository does not.
                  const disabled = (!repository.isAdmin && !activeIds.has(id)) || connecting;
                  return (
                    <label
                      key={id}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-60",
                        checked && "bg-muted"
                      )}
                    >
                      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => toggle(id, value === true)} />
                      {repository.isPrivate ? <LockKeyhole className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                      <span className="min-w-0 flex-1 truncate">{repository.fullName}</span>
                      {!repository.isAdmin && !activeIds.has(id) ? (
                        <span className="text-xs text-muted-foreground">Needs admin access on GitHub</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
        {loadError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            {loadError}
            <Button variant="outline" size="sm" disabled={loading} onClick={() => load()}>
              <RotateCcw />
              Retry
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {installUrl ? (
            <Button variant="outline" size="sm" asChild>
              <a href={installUrl} target="_blank" rel="noreferrer">
                <ExternalLink />
                Manage access on GitHub
              </a>
            </Button>
          ) : null}
          {repositories?.length ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="Refresh"
              title="Refresh"
              disabled={loading}
              onClick={() => load()}
            >
              <RefreshCw />
            </Button>
          ) : null}
        </div>
        {added.length ? (
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox checked={shareConsent} onCheckedChange={(checked) => setShareConsent(checked === true)} className="mt-0.5" />
            Every member of this project, including viewers, can read the selected repositories&apos; pull requests and diffs in Convoy.
          </label>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={connecting} onClick={cancel}>
            Cancel
          </Button>
          <Button
            disabled={(!added.length && !removed.length) || (added.length > 0 && !shareConsent) || connecting}
            onClick={() => void save()}
          >
            Save repositories
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
