"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Check, CircleHelp, Github, LockKeyhole, MoreHorizontal, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/convex/_generated/api";
import { errors } from "@/convex/integrations/github/errors";
import type { Id } from "@/convex/_generated/dataModel";
import { EmptyState } from "@/components/custom/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { RepositoryPickerDialog } from "./repository-picker-dialog";
import { repositoryCount, syncErrorText, useIntegrationStatus, type IntegrationStatus } from "./use-integration-status";

type Connection = IntegrationStatus["connections"][number];

/** One card per GitHub account (organization or user) the App is installed on. */
function groupByAccount(connections: Connection[]): { account: string; connections: Connection[] }[] {
  const groups = new Map<string, Connection[]>();
  for (const connection of connections) {
    groups.set(connection.accountLogin, [...(groups.get(connection.accountLogin) ?? []), connection]);
  }
  return [...groups].map(([account, members]) => ({ account, connections: members }));
}

type GithubConnectionProps = { projectId: Id<"projects"> | undefined; organizationSlug: string; projectAlias: string };

/** The GitHub settings card: connected accounts, their repositories, and the connect flow. */
export function GithubConnection({ projectId, organizationSlug, projectAlias }: GithubConnectionProps) {
  const navigation = useNavigation();
  const setupId = new URLSearchParams(navigation.location.search).get("setup");
  const status = useIntegrationStatus(projectId, setupId ?? undefined);
  const beginSetup = useMutation(api.integrations.github.setup.beginSetup);
  const disconnect = useMutation(api.integrations.github.core.disconnect);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);

  // Set once the picker closes on purpose, so its own setup deletion is not reported as expiry.
  const closedSetup = useRef(false);
  const clearSetup = () => {
    closedSetup.current = true;
    navigation.replace(appRoute.projectGithubIntegration(organizationSlug, projectAlias));
  };
  const setupExpired = Boolean(setupId && status && !status.setup);

  useEffect(() => {
    if (!setupExpired || closedSetup.current) return;
    closedSetup.current = true;
    toast.error(errors.SETUP_EXPIRED);
    navigation.replace(appRoute.projectGithubIntegration(organizationSlug, projectAlias));
  }, [navigation, organizationSlug, projectAlias, setupExpired]);

  if (status === undefined || !projectId) {
    return <Skeleton className="h-20 w-full rounded-lg" aria-label="Loading integrations" />;
  }
  if (status === null) {
    return null;
  }
  if (!status.configured) {
    return (
      <EmptyState
        fill
        icon={Github}
        title="GitHub isn't set up on this deployment"
        description="A deployment operator needs to add the GitHub App credentials before projects can connect repositories."
      />
    );
  }

  // Every add, manage, and reconnect goes through GitHub's authorization, then the picker.
  const startConnect = async () => {
    setConnecting(true);
    try {
      const { authorizeUrl } = await beginSetup({ projectId });
      window.location.assign(authorizeUrl);
    } catch (error) {
      setConnecting(false);
      showConvexErrorToast(error, "Could not start the GitHub connection");
    }
  };
  const accounts = groupByAccount(status.connections);
  const disconnecting = accounts.find((group) => group.account === confirmDisconnect);

  return (
    <div className="flex flex-1 flex-col space-y-4">
      <section aria-labelledby="connected-organizations-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="connected-organizations-heading" className="text-sm font-medium">
            Connected organizations
          </h3>
          {status.canManage ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add organization"
              title="Add organization"
              disabled={connecting}
              onClick={startConnect}
            >
              <Plus />
            </Button>
          ) : null}
        </div>
        {accounts.length ? (
          accounts.map((group) => (
            <AccountCard
              key={group.account}
              projectId={projectId}
              account={group.account}
              connections={group.connections}
              canManage={status.canManage}
              connecting={connecting}
              onManage={startConnect}
              onDisconnect={() => setConfirmDisconnect(group.account)}
            />
          ))
        ) : (
          <div className="flex items-center gap-3 rounded-lg border p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">No repository connected</p>
              <p className="mt-1 text-xs text-muted-foreground">Connect repositories to browse their pull requests here.</p>
            </div>
            {status.canManage ? (
              <Button variant="outline" size="settings" disabled={connecting} onClick={startConnect}>
                Connect GitHub
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Connected repositories are readable by every project member, including viewers.
        {status.canManage ? " Only project admins can manage this connection." : " Ask a project admin to manage this connection."}
      </p>

      {status.setup?.status === "authorized" ? (
        <RepositoryPickerDialog
          setupId={status.setup.setupId}
          installUrl={status.installUrl}
          connections={status.connections}
          onClose={clearSetup}
        />
      ) : null}

      <AlertDialog open={Boolean(disconnecting)} onOpenChange={(open) => !open && setConfirmDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {confirmDisconnect}?</AlertDialogTitle>
            <AlertDialogDescription>
              Pull requests from {confirmDisconnect} disappear from this project right away. Convoy keeps their metadata for 30 days, so
              reconnecting the same repositories before then brings them back. After 30 days, or sooner with Delete now, it is deleted. Other organizations and
              projects keep their access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const links = disconnecting?.connections.filter((connection) => connection.status === "active") ?? [];
                Promise.all(links.map((link) => disconnect({ projectId, repositoryLinkId: link.repositoryLinkId }))).catch(
                  (error: unknown) => showConvexErrorToast(error, "Could not disconnect GitHub")
                );
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AccountCard({
  projectId,
  account,
  connections,
  canManage,
  connecting,
  onManage,
  onDisconnect,
}: {
  projectId: Id<"projects">;
  account: string;
  connections: Connection[];
  canManage: boolean;
  connecting: boolean;
  onManage: () => void;
  onDisconnect: () => void;
}) {
  const active = connections.filter((connection) => connection.status === "active");
  const importing = active.filter((connection) => connection.repository.syncStatus === "importing");
  const failed = active.some((connection) => connection.repository.syncStatus === "error");
  const synced = active.map((connection) => connection.repository.lastSuccessAt);
  // The account is only as fresh as its least recently synced repository.
  const oldestSync = synced.every((at) => at !== undefined) && synced.length ? Math.min(...(synced as number[])) : null;
  const retainedUntil = Math.min(...connections.map((connection) => connection.deleteAfter ?? Infinity));

  const [dot, state] = !active.length
    ? ["bg-muted-foreground", "Disconnected"]
    : failed
      ? ["bg-amber-500", "Sync failed"]
      : importing.length
        ? ["bg-amber-500", "Importing pull requests…"]
        : ["bg-success", "Pull requests synced"];

  return (
    <section aria-label={`${account} organization`} className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold" aria-hidden="true">
          {account[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden="true" />
            {state}
            {active.length ? <span>· {repositoryCount(active.length)}</span> : null}
          </p>
        </div>
        {canManage && !active.length ? (
          <Button variant="outline" size="settings" disabled={connecting} onClick={onManage}>
            Reconnect GitHub
          </Button>
        ) : null}
        {canManage && active.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`${account} actions`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max">
              <DropdownMenuItem disabled={connecting} onSelect={onManage}>
                Manage repositories
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" onSelect={onDisconnect}>
                Disconnect {account}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <ul className="divide-y border-y">
        {connections.map((connection) => (
          <RepositoryRow key={connection.repositoryLinkId} projectId={projectId} connection={connection} canManage={canManage} />
        ))}
      </ul>
      <p className="px-4 py-3 text-xs text-muted-foreground">
        {!active.length
          ? `Pull requests are hidden.${Number.isFinite(retainedUntil) ? ` They'll be deleted on ${new Date(retainedUntil).toLocaleDateString()} unless you reconnect.` : ""}`
          : oldestSync !== null
            ? `PR metadata last synced ${formatDistanceToNow(oldestSync, { addSuffix: true })}`
            : `Importing open pull requests… ${importing.reduce((sum, connection) => sum + (connection.repository.importedCount ?? 0), 0)} so far`}
      </p>
    </section>
  );
}

function RepositoryRow({ projectId, connection, canManage }: { projectId: Id<"projects">; connection: Connection; canManage: boolean }) {
  const retrySync = useMutation(api.integrations.github.core.retrySync);
  const deleteRetained = useMutation(api.integrations.github.core.deleteRetained);
  const disconnect = useMutation(api.integrations.github.core.disconnect);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { repository } = connection;
  const fullName = `${repository.owner}/${repository.name}`;
  const active = connection.status === "active";
  const detail = !active
    ? null
    : repository.syncStatus === "error"
      ? `${syncErrorText(repository)}. Showing the last synced pull requests.`
      : repository.syncStatus === "importing"
        ? `Importing… ${repository.importedCount ?? 0} so far`
        : null;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {repository.isPrivate ? (
        <LockKeyhole className="size-3.5 shrink-0 text-muted-foreground" aria-label="Private repository" role="img" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <a href={repository.htmlUrl} target="_blank" rel="noreferrer" className="truncate text-sm hover:underline">
            {fullName}
          </a>
          {active ? null : <Badge variant="secondary">Disconnected</Badge>}
        </div>
        {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      {!active && connection.deleteAfter ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          Will be deleted on {new Date(connection.deleteAfter).toLocaleDateString()}
          <RetentionHelp repository={fullName} deleteAfter={connection.deleteAfter} reason={connection.error} />
        </span>
      ) : null}
      {active && repository.syncStatus === "error" && canManage ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            retrySync({ projectId, repositoryLinkId: connection.repositoryLinkId }).catch((error: unknown) =>
              showConvexErrorToast(error, "Could not restart the sync")
            )
          }
        >
          Sync again
        </Button>
      ) : null}
      {active && repository.syncStatus !== "error" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} role="img" aria-label="Connected" className="shrink-0 text-muted-foreground">
              <Check className="size-3.5" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Connected. Pull request changes on GitHub show up here automatically.</TooltipContent>
        </Tooltip>
      ) : null}
      {active && canManage ? (
        <>
          {/* Removing is a Convoy-only change, so it works without GitHub access to the repository. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`${fullName} actions`} className="text-muted-foreground">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max">
              <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDisconnect(true)}>
                Disconnect repository
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect {fullName}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Its pull requests disappear from this project right away. Convoy keeps their metadata for 30 days, so reconnecting it
                  before then brings them back. After 30 days, or sooner with Delete now, it is deleted. Other projects keep their access.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    disconnect({ projectId, repositoryLinkId: connection.repositoryLinkId }).catch((error: unknown) =>
                      showConvexErrorToast(error, "Could not disconnect the repository")
                    )
                  }
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
      {!active && canManage ? (
        <>
          <Button variant="outline" size="xs" aria-label={`Delete ${fullName} now`} onClick={() => setConfirmDelete(true)}>
            Delete now
          </Button>
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {fullName} now?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Its pull requests are deleted from this project now instead of after 30 days. Connecting it again later imports them from
                  GitHub. Other projects that connect it keep their access.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    deleteRetained({ projectId, repositoryLinkId: connection.repositoryLinkId }).catch((error: unknown) =>
                      showConvexErrorToast(error, "Could not delete the pull requests")
                    )
                  }
                >
                  Delete now
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </li>
  );
}

function RetentionHelp({ repository, deleteAfter, reason }: { repository: string; deleteAfter: number; reason?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`About deleting ${repository}`} className="size-5 text-muted-foreground">
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 text-xs text-muted-foreground">
        {reason ? `${reason}. ` : null}After a disconnect, Convoy hides this repository&apos;s pull requests and keeps them for 30 days, so reconnecting it brings them
        back. On {new Date(deleteAfter).toLocaleDateString()} they are deleted. Delete now removes them sooner.
      </PopoverContent>
    </Popover>
  );
}
