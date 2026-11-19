"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Github } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { showConvexErrorToast } from "@/lib/errors";
import { href, useNavigation, type RouteTarget } from "@/lib/navigation";

type LinkedAccounts = FunctionReturnType<typeof api.integrations.github.accounts.listMine>;
type OrganizationAccount = LinkedAccounts["organizations"][number];
export type LinkedAccount = NonNullable<OrganizationAccount["account"]>;

/** The caller's Linked GitHub accounts, one row per organization (docs/specs/github-integration.md → GitHub accounts and permissions). */
export function useLinkedGithubAccounts(): LinkedAccounts | undefined {
  return useQuery(api.integrations.github.accounts.listMine, {});
}

/**
 * True from a click until the browser leaves for GitHub. Back restores the
 * page from the back-forward cache with its state, so `pageshow` clears it.
 */
export function useLeavingForGithub() {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const reset = () => setLeaving(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  return [leaving, setLeaving] as const;
}

/** Sends the browser through GitHub's App authorization; the callback returns to `returnTo`. */
export function useConnectGithubAccount() {
  const beginLink = useMutation(api.integrations.github.accounts.beginLink);
  const [connecting, setConnecting] = useLeavingForGithub();
  const connect = async (organizationId: Id<"organizations">, returnTo: RouteTarget) => {
    setConnecting(true);
    try {
      const { authorizeUrl } = await beginLink({ organizationId, returnTo: href(returnTo) });
      window.location.assign(authorizeUrl);
    } catch (error) {
      setConnecting(false);
      showConvexErrorToast(error, "Could not start connecting GitHub");
    }
  };
  return { connect, connecting };
}

/** Connected as @login with Disconnect, Not connected with Connect, or Reconnect GitHub. */
export function LinkedAccountRow({ organization, returnTo }: { organization: OrganizationAccount; returnTo: RouteTarget }) {
  const { connect, connecting } = useConnectGithubAccount();
  const disconnect = useAction(api.integrations.github.accounts.disconnect);
  const [disconnecting, setDisconnecting] = useState(false);
  const { account } = organization;
  const status = !account ? "Not connected" : account.status === "reconnect" ? `@${account.login} needs reconnecting` : `Connected as @${account.login}`;
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <Avatar className="size-8 shrink-0">
        <AvatarImage src={account?.avatarUrl ?? undefined} />
        <AvatarFallback>
          <Github className="size-4" />
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{organization.organizationName}</p>
        <p className="truncate text-xs text-muted-foreground">{status}</p>
      </div>
      {account?.status === "active" ? (
        <Button
          variant="outline"
          size="settings"
          disabled={disconnecting}
          onClick={() => {
            setDisconnecting(true);
            disconnect({ organizationId: organization.organizationId })
              .catch((error: unknown) => showConvexErrorToast(error, "Could not disconnect GitHub"))
              .finally(() => setDisconnecting(false));
          }}
        >
          Disconnect
        </Button>
      ) : (
        <Button variant="outline" size="settings" disabled={connecting} onClick={() => connect(organization.organizationId, returnTo)}>
          {account ? "Reconnect GitHub" : "Connect"}
        </Button>
      )}
    </div>
  );
}

/** The profile settings section: writes to GitHub act as the account linked in each organization. */
export function ConnectedAccountsSection() {
  const accounts = useLinkedGithubAccounts();
  const navigation = useNavigation();
  // The dialog has no route of its own, so Connect returns to the page under it.
  const returnTo: RouteTarget = { pathname: navigation.location.pathname, query: new URLSearchParams(navigation.location.search) };
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Connected accounts</h2>
        <p className="text-sm text-muted-foreground">
          Comments and other changes Convoy makes on GitHub are posted as the account you link in each organization.
        </p>
      </div>
      {accounts === undefined ? (
        <Skeleton className="h-[58px] w-full rounded-lg" aria-label="Loading connected accounts" />
      ) : !accounts.configured ? (
        <p className="text-sm text-muted-foreground">GitHub isn&apos;t set up on this deployment.</p>
      ) : (
        <div className="space-y-2">
          {accounts.organizations.map((organization) => (
            <LinkedAccountRow key={organization.organizationId} organization={organization} returnTo={returnTo} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The GitHub page's row for its organization, shown to every member, viewers included. */
export function YourGithubAccountSection({ organizationSlug, returnTo }: { organizationSlug: string; returnTo: RouteTarget }) {
  const accounts = useLinkedGithubAccounts();
  const organization = accounts?.organizations.find((candidate) => candidate.organizationSlug === organizationSlug);
  if (accounts && !organization) return null;
  return (
    <section aria-labelledby="your-github-account-heading" className="space-y-3">
      <div>
        <h3 id="your-github-account-heading" className="text-sm font-medium">
          Your GitHub account
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">Comments you write here are posted on GitHub as this account.</p>
      </div>
      {organization ? (
        <LinkedAccountRow organization={organization} returnTo={returnTo} />
      ) : (
        <Skeleton className="h-[58px] w-full rounded-lg" aria-label="Loading your GitHub account" />
      )}
    </section>
  );
}
