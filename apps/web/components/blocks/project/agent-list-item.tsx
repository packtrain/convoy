"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, getInitials } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import {
  renderCliIcon,
  type AvailableCliInfo,
} from "@/lib/cli-runtime-ui/registry";
import { ProfileHoverCard } from "@/components/blocks/cli/profiles/profile-hover-card";
import type { ProfileDetailsData } from "@/components/blocks/cli/profiles/profile-details";

interface AgentPath {
  id: string;
  path: string;
  gitRemoteUrl?: string;
}

export interface AgentListItemData {
  sessionId: Id<"cliSessions">;
  profileId: Id<"cliProfiles">;
  instanceId: string;
  name: string;
  profileKey?: string;
  userName: string;
  userAvatarUrl?: string;
  paths: AgentPath[];
  availableClis?: AvailableCliInfo[];
  isOnline: boolean;
}

export function truncateRepoPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) return path;
  return segments.slice(-2).join("/");
}

function extractGitRemote(url: string | undefined): string | null {
  if (!url) return null;
  const sshMatch = url.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = url.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];
  return null;
}

function AgentCliIcon({ type, version }: { type: string; version: string }) {
  const title = `${type} v${version}`;
  const icon = renderCliIcon(type as AvailableCliInfo["type"], "size-3.5");

  if (icon) {
    return (
      <span title={title}>
        {icon}
      </span>
    );
  }

  return (
    <span
      className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium"
      title={title}
    >
      {type}
    </span>
  );
}

/** The row's avatar with its online dot. Phrasing content, so it can sit inside a button. */
export function AgentAvatar({ agent, className }: { agent: Pick<AgentListItemData, "userAvatarUrl" | "userName" | "isOnline">; className?: string }) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <Avatar size="sm" className="size-6">
        <AvatarImage src={agent.userAvatarUrl} />
        <AvatarFallback className="text-[10px]">
          {getInitials(agent.userName)}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background",
          agent.isOnline ? "bg-success" : "bg-muted-foreground"
        )}
      />
    </span>
  );
}

interface AgentListItemProps {
  agent: AgentListItemData;
  onClick: () => void;
  /** When provided, hovering the row shows the shared CLI profile hover card. */
  profileDetails?: ProfileDetailsData;
  /**
   * The caller renders `AgentAvatar` itself as a toggle beside the row
   * (OS-2036): the row drops the avatar, tightens its left padding to sit
   * next to that toggle, and leaves the hover highlight to the wrapper.
   */
  hideAvatar?: boolean;
}

export function AgentListItem({ agent, onClick, profileDetails, hideAvatar = false }: AgentListItemProps) {
  const firstPath = agent.paths[0];
  const repoDisplay = firstPath ? truncateRepoPath(firstPath.path) : "No paths";
  const gitRemote = firstPath ? extractGitRemote(firstPath.gitRemoteUrl) : null;
  const pathCount = agent.paths.length;

  const row = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-3 text-left transition-colors",
        // With the avatar outside, the wrapping row owns the hover highlight.
        hideAvatar ? "pl-1.5" : "pl-2.5 hover:bg-accent"
      )}
      title={profileDetails ? undefined : `ID: ${agent.instanceId}`}
    >
      {!hideAvatar && <AgentAvatar agent={agent} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium leading-tight">
              {agent.name}
            </span>
            {agent.profileKey && (
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
                {agent.profileKey}
              </span>
            )}
          </div>
          {agent.availableClis && agent.availableClis.length > 0 && (
            <div className="flex shrink-0 items-center gap-0.5">
              {agent.availableClis.map((cli) => (
                <AgentCliIcon
                  key={cli.type}
                  type={cli.type}
                  version={cli.version}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate text-xs text-muted-foreground"
            title={firstPath?.path}
          >
            {repoDisplay}
            {gitRemote && (
              <span title={firstPath?.gitRemoteUrl}> · {gitRemote}</span>
            )}
            {pathCount > 1 && <span> +{pathCount - 1} more</span>}
          </span>
        </div>
      </div>
    </button>
  );

  if (!profileDetails) {
    return row;
  }

  return (
    <ProfileHoverCard profile={profileDetails} triggerAsChild>
      {row}
    </ProfileHoverCard>
  );
}
