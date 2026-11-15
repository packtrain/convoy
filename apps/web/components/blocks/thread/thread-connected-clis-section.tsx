"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { TooltipExt } from "@/components/custom/tooltip-ext";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from "@/components/ui/input-group";
import { externalRoutes } from "@/lib/navigation";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import { buildNoProfileSetupCommands, INTERACTIVE_CONNECT_COMMAND } from "@/lib/threads/setup-commands";
import { CONNECTED_CLIS_SECTION_STORAGE_KEY } from "@/lib/threads/section-collapsed";
import { cn } from "@/lib/utils";
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
  const { profiles } = useCliProfiles(projectId);
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

  const connectedClis = sessions
    .filter((agent) => agent.isOnline)
    .sort((a, b) => (a.profileKey ?? a.name).toLowerCase().localeCompare((b.profileKey ?? b.name).toLowerCase()));
  const hasProfiles = profiles.length > 0;

  return (
    <ThreadCollapsibleSection
      label="Connected CLIs"
      storageKey={CONNECTED_CLIS_SECTION_STORAGE_KEY}
      defaultCollapsed
      compactLayout={compactLayout}
    >
      {/* minmax(0,1fr): the ScrollArea viewport is display:table and would grow to fit long rows. */}
      {connectedClis.length === 0 ? (
        <ConnectedClisEmptyState
          command={hasProfiles ? INTERACTIVE_CONNECT_COMMAND : setupCommands.interactiveSetupCommand}
          copyLabel={hasProfiles ? "Copy connect command" : "Copy setup command"}
          successMessage={hasProfiles ? "Connect command copied to clipboard" : "Setup command copied to clipboard"}
        />
      ) : (
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
        </div>
      )}
    </ThreadCollapsibleSection>
  );
}

interface ConnectedClisEmptyStateProps {
  command: string;
  copyLabel: string;
  successMessage: string;
}

function ConnectedClisEmptyState({ command, copyLabel, successMessage }: ConnectedClisEmptyStateProps) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== undefined) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyCommand = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      toast.error("Clipboard is not available");
      return;
    }

    await navigator.clipboard.writeText(command);
    setCopied(true);
    toast.success(successMessage);
    if (resetTimeoutRef.current !== undefined) {
      clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = setTimeout(() => setCopied(false), 1200);
  }, [command, successMessage]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 px-3 pb-2 text-xs text-muted-foreground">
      <p>
        No connected CLIs.{" "}
        <a href={externalRoutes.docsCliSetupAndConnect} target="_blank" rel="noreferrer" className="text-primary underline">
          Learn how to connect
        </a>
        .
      </p>
      <InputGroup className="h-7 rounded-md border-border bg-muted shadow-none">
        <InputGroupText className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap px-2.5 font-mono text-[11px] leading-4 text-foreground">
          {command}
        </InputGroupText>
        <InputGroupAddon align="inline-end" className="pr-1">
          <TooltipExt content={copyLabel} delayDuration={500}>
            <InputGroupButton
              type="button"
              variant="ghost"
              size="icon-xs"
              className="bg-muted text-muted-foreground hover:!bg-muted-foreground/10 hover:text-foreground"
              aria-label={copyLabel}
              onClick={handleCopyCommand}
            >
              {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
            </InputGroupButton>
          </TooltipExt>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
