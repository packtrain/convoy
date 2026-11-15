"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ChevronDown, MoreHorizontal, Pencil, Server, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/custom/empty-state";
import { BackendUrlBlock, CommandBlock } from "@/components/blocks/thread/no-profiles-state";
import { RenameProfileDialog } from "@/components/blocks/thread/rename-profile-dialog";
import { DeleteProfileDialog } from "@/components/blocks/cli/profiles/delete-profile-dialog";
import { formatProfileConnectionStatus, ProfileDetails } from "@/components/blocks/cli/profiles/profile-details";
import { INTERACTIVE_CONNECT_COMMAND } from "@/lib/threads/setup-commands";
import { cn } from "@/lib/utils";

type UserProfile = FunctionReturnType<typeof api.cli.profiles.listForUser>[number];

type ProjectGroup = {
  key: string;
  name: string;
  alias?: string;
  isArchived: boolean;
  profiles: UserProfile[];
};

type OrganizationGroup = {
  key: string;
  name: string;
  unavailable: boolean;
  projects: ProjectGroup[];
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function groupProfiles(profiles: UserProfile[]): OrganizationGroup[] {
  const organizationGroups = new Map<string, {
    name: string;
    unavailable: boolean;
    projects: Map<string, ProjectGroup>;
  }>();

  for (const profile of profiles) {
    const unavailable = !profile.organization || !profile.project;
    const organizationKey = profile.organization?._id ?? "unavailable";
    const projectKey = profile.project?._id ?? "unavailable";
    const organization = organizationGroups.get(organizationKey) ?? {
      name: profile.organization?.name ?? "Unavailable profiles",
      unavailable,
      projects: new Map<string, ProjectGroup>(),
    };
    const project = organization.projects.get(projectKey) ?? {
      key: projectKey,
      name: profile.project?.name ?? "Unavailable project",
      alias: profile.project?.alias,
      isArchived: profile.project?.isArchived ?? false,
      profiles: [],
    };

    project.profiles.push(profile);
    organization.projects.set(projectKey, project);
    organizationGroups.set(organizationKey, organization);
  }

  return [...organizationGroups.entries()]
    .map(([key, organization]) => ({
      key,
      name: organization.name,
      unavailable: organization.unavailable,
      projects: [...organization.projects.values()]
        .map((project) => ({
          ...project,
          profiles: project.profiles.toSorted((a, b) => collator.compare(a.name, b.name)),
        }))
        .toSorted((a, b) => collator.compare(a.name, b.name)),
    }))
    .toSorted((a, b) => {
      if (a.unavailable !== b.unavailable) return a.unavailable ? 1 : -1;
      return collator.compare(a.name, b.name);
    });
}

function ProfilesLoading() {
  return (
    <div className="space-y-4" aria-label="Loading profiles">
      {[0, 1, 2].map((value) => (
        <div key={value} className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function ProfileRow({
  profile,
  expanded,
  onExpand,
  onRename,
  onDelete,
}: {
  profile: UserProfile;
  expanded: boolean;
  onExpand: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const connectionStatus = formatProfileConnectionStatus(profile);

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex min-w-0 items-center gap-3 px-3 py-2.5">
        <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={onExpand} aria-expanded={expanded}>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn("size-2 shrink-0 rounded-full", profile.isOnline ? "bg-green-500" : "bg-muted-foreground/40")}
              aria-label={profile.isOnline ? "Connected" : "Disconnected"}
            />
            <span className="truncate text-sm font-medium text-foreground">{profile.name}</span>
            {profile.profileKey ? <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">{profile.profileKey}</Badge> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {profile.hostname ?? "Unknown machine"} · {connectionStatus}
          </span>
        </button>
        <Button variant="ghost" size="icon-sm" className="shrink-0 cursor-pointer" onClick={onExpand} aria-label={`${expanded ? "Hide" : "Show"} details for ${profile.name}`}>
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="shrink-0 cursor-pointer" aria-label={`Profile options for ${profile.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onSelect={onRename}><Pencil className="size-3.5" />Rename</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 className="size-3.5" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded ? (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <ProfileDetails profile={profile} />
        </div>
      ) : null}
    </div>
  );
}

export function ProfilesSection() {
  const profiles = useQuery(api.cli.profiles.listForUser, {});
  const renameProfile = useMutation(api.cli.profiles.rename);
  const [expandedProfileId, setExpandedProfileId] = useState<Id<"cliProfiles"> | null>(null);
  const [profileToRename, setProfileToRename] = useState<UserProfile | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<UserProfile | null>(null);
  const groups = useMemo(() => groupProfiles(profiles ?? []), [profiles]);

  const handleRename = useCallback(async (profileId: Id<"cliProfiles">, name: string) => {
    await renameProfile({ profileId, name });
  }, [renameProfile]);

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">CLI profiles</h2>
        <p className="text-sm text-muted-foreground">Manage the CLI profiles connected to your projects.</p>
      </div>

      {profiles === undefined ? <ProfilesLoading /> : profiles.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No CLI profiles"
          description="Profiles appear here after you connect the Convoy CLI to a project. Run this in your project folder:"
          actionClassName="w-full max-w-md space-y-4 text-left"
          action={
            <>
              <CommandBlock command={INTERACTIVE_CONNECT_COMMAND} />
              <BackendUrlBlock />
            </>
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((organization) => (
            <section key={organization.key} className="space-y-3">
              <h3 className={cn("text-xs font-semibold uppercase tracking-wide", organization.unavailable ? "text-muted-foreground" : "text-foreground")}>
                {organization.name}
              </h3>
              {organization.projects.map((project) => (
                <div key={project.key} className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{project.name}</span>
                    {project.alias ? <span>{project.alias}</span> : null}
                    {project.isArchived ? <Badge variant="outline" className="h-4 px-1 text-[10px]">Archived</Badge> : null}
                  </div>
                  <div className="space-y-2">
                    {project.profiles.map((profile) => (
                      <ProfileRow
                        key={profile._id}
                        profile={profile}
                        expanded={expandedProfileId === profile._id}
                        onExpand={() => setExpandedProfileId((current) => current === profile._id ? null : profile._id)}
                        onRename={() => setProfileToRename(profile)}
                        onDelete={() => setProfileToDelete(profile)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      <RenameProfileDialog
        open={profileToRename !== null}
        onOpenChange={(nextOpen) => { if (!nextOpen) setProfileToRename(null); }}
        profileId={profileToRename?._id}
        currentName={profileToRename?.name ?? ""}
        hostname={profileToRename?.hostname}
        profileKey={profileToRename?.profileKey}
        onRename={handleRename}
      />
      <DeleteProfileDialog
        profile={profileToDelete}
        onOpenChange={(nextOpen) => { if (!nextOpen) setProfileToDelete(null); }}
      />
    </div>
  );
}
