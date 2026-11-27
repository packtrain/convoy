"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleHelp, Copy, MoreHorizontal, Terminal, Trash2 } from "lucide-react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatAbsoluteTime, formatRelativeTime } from "@/lib/format-relative-time";
import { externalRoutes } from "@/lib/navigation";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { buildNoProfileSetupCommands, INTERACTIVE_CONNECT_COMMAND } from "@/lib/threads/setup-commands";
import { CONNECTED_CLIS_SECTION_STORAGE_KEY } from "@/lib/threads/section-collapsed";
import { cn } from "@/lib/utils";
import { DeleteProfileDialog } from "@/components/blocks/cli/profiles/delete-profile-dialog";
import { toProfileDetails } from "@/components/blocks/cli/profiles/profile-details";
import { AgentAvatar, AgentListItem } from "@/components/blocks/project/agent-list-item";
import { WorktreeList } from "@/components/blocks/worktrees";
import { ThreadCollapsibleSection } from "./thread-list-sections";

interface ThreadConnectedClisSectionProps {
  projectId: Id<"projects">;
  projectName: string;
  organizationSlug: string;
  projectAlias: string;
  compactLayout: boolean;
}

/** Collapsible "Connected CLIs" group at the top of the thread list (OS-1993). */
export function ThreadConnectedClisSection({
  projectId,
  projectName,
  organizationSlug,
  projectAlias,
  compactLayout,
}: ThreadConnectedClisSectionProps) {
  const sessions = useQuery(api.cli.sessions.listByProject, { projectId });
  const { profiles, isLoading: profilesLoading } = useCliProfiles(projectId);
  const setupCommands = useMemo(
    () =>
      buildNoProfileSetupCommands({
        convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? "<convex_url>",
        projectId,
        projectName,
        projectAlias,
      }),
    [projectId, projectName, projectAlias]
  );

  if (sessions === undefined) {
    return null;
  }

  const connectedClis = sessions.filter((agent) => agent.isOnline).sort(byProfileKey);
  const onlineProfileIds = new Set(connectedClis.map((agent) => agent.profileId));
  const offlineProfiles = profiles.filter((profile) => !onlineProfileIds.has(profile._id)).sort(byProfileKey);

  return (
    <ThreadCollapsibleSection
      label="Connected CLIs"
      storageKey={CONNECTED_CLIS_SECTION_STORAGE_KEY}
      defaultCollapsed
      compactLayout={compactLayout}
    >
      {/* minmax(0,1fr): the ScrollArea viewport is display:table and would grow to fit long rows. */}
      <div className={cn("grid grid-cols-[minmax(0,1fr)] pb-1", !compactLayout && "px-2")}>
        {connectedClis.map((agent) => {
          const agentProfile = profiles.find((profile) => profile._id === agent.profileId);
          // The module turns the avatar and the row into the expand toggle for the checkouts list (OS-2036).
          return (
            <WorktreeList
              key={agent.sessionId}
              profileId={agent.profileId}
              paths={agentProfile?.paths ?? []}
              organizationSlug={organizationSlug}
              projectAlias={projectAlias}
              compactLayout={compactLayout}
              avatar={<AgentAvatar agent={agent} />}
            >
              {(toggle) => (
                <AgentListItem
                  agent={agent}
                  hideAvatar
                  onClick={toggle}
                  profileDetails={agentProfile ? toProfileDetails(agentProfile) : undefined}
                />
              )}
            </WorktreeList>
          );
        })}
        {offlineProfiles.length > 0 && <OfflineProfileRows profiles={offlineProfiles} compactLayout={compactLayout} />}
        {!profilesLoading && profiles.length === 0 && connectedClis.length === 0 && <NoProfilesRow command={setupCommands.interactiveSetupCommand} compactLayout={compactLayout} />}
      </div>
    </ThreadCollapsibleSection>
  );
}

function byProfileKey(a: { profileKey?: string; name: string }, b: { profileKey?: string; name: string }) {
  return (a.profileKey ?? a.name).toLowerCase().localeCompare((b.profileKey ?? b.name).toLowerCase());
}

/** Copies a command with a toast; `copied` holds the last one for a short check mark. */
function useCopyCommand(successMessage: string) {
  const [copied, setCopied] = useState<string | null>(null);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimeoutRef.current), []);

  const copy = useCallback(
    async (command: string) => {
      if (!navigator.clipboard?.writeText) {
        toast.error("Clipboard is not available");
        return;
      }
      await navigator.clipboard.writeText(command);
      setCopied(command);
      toast.success(successMessage);
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = setTimeout(() => setCopied(null), 1200);
    },
    [successMessage]
  );

  return { copied, copy };
}

/** Row box shared with the online CLI row (`WorktreeList`): rounded inside `px-2`, square and full width in compact. */
function rowClassName(compactLayout: boolean) {
  return cn(
    "group/row flex min-w-0 items-center gap-1.5 py-1.5 pr-3 transition-colors hover:bg-accent has-[[data-state=open]]:bg-accent",
    compactLayout ? "pl-2" : "rounded-lg pl-3"
  );
}

const ROW_TITLE_CLASS = "truncate text-sm font-medium leading-tight text-muted-foreground";
const ROW_ICON_BUTTON_CLASS =
  "-my-0.5 ml-auto inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted-foreground/10 hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100";

type CliProfile = ReturnType<typeof useCliProfiles>["profiles"][number];

/** The caller's profiles with no online CLI, below the online ones; "..." copies `connect --profile` or deletes. */
function OfflineProfileRows({ profiles, compactLayout }: { profiles: CliProfile[]; compactLayout: boolean }) {
  const user = useQuery(api.users.core.current);
  const { copy } = useCopyCommand("Connect command copied to clipboard");
  const [profileToDelete, setProfileToDelete] = useState<CliProfile | null>(null);

  return (
    <>
      {profiles.map((profile) => {
        const command = profile.profileKey ? `${INTERACTIVE_CONNECT_COMMAND} --profile ${profile.profileKey}` : INTERACTIVE_CONNECT_COMMAND;
        return (
          <div key={profile._id} role="group" aria-label={profile.name} className={rowClassName(compactLayout)}>
            <AgentAvatar agent={{ userName: user?.name ?? "", userAvatarUrl: user?.avatarUrl, isOnline: false }} />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={ROW_TITLE_CLASS}>{profile.name}</span>
                {profile.profileKey && (
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{profile.profileKey}</span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={`Actions for ${profile.name}`} className={ROW_ICON_BUTTON_CLASS}>
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onSelect={() => void copy(command)}>
                      <Copy />
                      Copy connect command
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setProfileToDelete(profile)}>
                      <Trash2 />
                      Delete profile
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>Offline</span>
                {profile.lastConnectedAt !== undefined && (
                  <span className="shrink-0 text-[11px]" title={`Last connected ${formatAbsoluteTime(profile.lastConnectedAt)}`}>
                    {formatRelativeTime(profile.lastConnectedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <DeleteProfileDialog profile={profileToDelete} onOpenChange={(open) => !open && setProfileToDelete(null)} />
    </>
  );
}

/** First run: one placeholder row; clicking it copies the interactive setup command. */
function NoProfilesRow({ command, compactLayout }: { command: string; compactLayout: boolean }) {
  const { copied, copy } = useCopyCommand("Setup command copied to clipboard");
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Copy setup command"
      onClick={() => void copy(command)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void copy(command);
        }
      }}
      className={cn(rowClassName(compactLayout), "cursor-pointer text-left")}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground">
        <Terminal className="size-3" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={ROW_TITLE_CLASS}>No CLI set up</span>
          <span className={cn(ROW_ICON_BUTTON_CLASS, "pointer-events-none")}>
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </span>
          <a
            href={externalRoutes.docsCliSetupAndConnect}
            target="_blank"
            rel="noreferrer"
            aria-label="How to connect a CLI"
            title="How to connect a CLI"
            onClick={(event) => event.stopPropagation()}
            className={cn(ROW_ICON_BUTTON_CLASS, "ml-0")}
          >
            <CircleHelp className="size-3.5" />
          </a>
        </div>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{command}</span>
      </div>
    </div>
  );
}
