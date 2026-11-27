"use client";

import { isConfiguredPath, type CliProfilePathEntry } from "@/convex/lib/contracts/validators";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { createPortal } from "react-dom";
import { MoreHorizontal, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { POPOVER_SURFACE_CLASS } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { api } from "@/convex/_generated/api";
import {
  ModelSelectorDropdown,
  ModelSelectorDropdownContent,
  ModelSelectorDropdownEmpty,
  ModelSelectorDropdownGroup,
  ModelSelectorDropdownInput,
  ModelSelectorDropdownItem,
  ModelSelectorDropdownList,
  ModelSelectorDropdownName,
  ModelSelectorDropdownTrigger,
} from "@/components/ai-elements/model-selector-dropdown";
import { RenameProfileDialog } from "@/components/blocks/thread/rename-profile-dialog";
import { DeleteProfileDialog } from "@/components/blocks/cli/profiles/delete-profile-dialog";
import { ProfileHoverCard } from "@/components/blocks/cli/profiles/profile-hover-card";
import { toProfileDetails } from "@/components/blocks/cli/profiles/profile-details";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import type { AvailableCliInfo } from "@/lib/threads/types";
import { RepoCount } from "@/components/blocks/cli/profiles/repo-count";

export type WorkingDirectorySelectorProfile = {
  _id: Id<"cliProfiles">;
  name: string;
  profileKey?: string;
  hostname?: string;
  isOnline: boolean;
  createdAt?: number;
  lastConnectedAt?: number;
  sessionStartedAt?: number;
  appVersion?: string;
  availableClis?: AvailableCliInfo[];
  paths: Array<{
    id: string;
    path: string;
    label: string;
    gitRemoteUrl?: string;
    kind?: CliProfilePathEntry["kind"];
    parentPathId?: string;
    branch?: string;
  }>;
};

interface WorkingDirectorySelectorProps {
  profiles: WorkingDirectorySelectorProfile[];
  profileId: string;
  pathId: string;
  onChange: (profileId: string, pathId: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

function StatusDot({ isOnline }: { isOnline: boolean }) {
  return <span className={cn("size-2 shrink-0 rounded-full", isOnline ? "bg-success" : "bg-muted-foreground/40")} />;
}

function truncatePath(path: string, maxLength = 40) {
  if (path.length <= maxLength) return path;
  return "..." + path.slice(-(maxLength - 3));
}

function isProfileOptionsTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest("[data-profile-options-menu]") !== null || target.closest("[data-profile-options-trigger]") !== null;
}

type OptionsMenuState = {
  profile: WorkingDirectorySelectorProfile;
  top: number;
  left: number;
};

const PROFILE_OPTIONS_MENU_WIDTH = 144;
const PROFILE_OPTIONS_VIEWPORT_PADDING = 8;

export function WorkingDirectorySelector({
  profiles,
  profileId,
  pathId,
  onChange,
  disabled = false,
  compact = false,
}: WorkingDirectorySelectorProps) {
  const [open, setOpen] = useState(false);
  const [profileToRename, setProfileToRename] = useState<WorkingDirectorySelectorProfile | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<WorkingDirectorySelectorProfile | null>(null);
  const [optionsMenu, setOptionsMenu] = useState<OptionsMenuState | null>(null);
  const renameMenuItemRef = useRef<HTMLButtonElement | null>(null);
  const closedDropdownRef = useRef(false);
  const renameProfile = useMutation(api.cli.profiles.rename);

  const currentProfile = profiles.find((p) => p._id === profileId);
  const currentPath = currentProfile?.paths.find((p) => p.id === pathId);

  const shouldShowPathInTrigger = !!currentPath && !compact;

  const handleSelect = (selectedProfileId: string, selectedPathId: string) => {
    if (disabled) return;
    onChange(selectedProfileId, selectedPathId);
    setOpen(false);
    setOptionsMenu(null);
  };

  const handleRenameRequest = (profile: WorkingDirectorySelectorProfile) => {
    if (disabled) return;
    setOptionsMenu(null);
    setProfileToRename(profile);
  };

  const handleDeleteRequest = (profile: WorkingDirectorySelectorProfile) => {
    if (disabled) return;
    setOptionsMenu(null);
    setProfileToDelete(profile);
  };

  const handleRename = useCallback(
    async (selectedProfileId: Id<"cliProfiles">, name: string) => {
      await renameProfile({
        profileId: selectedProfileId,
        name,
      });
    },
    [renameProfile]
  );

  const closeOptionsMenu = useCallback(() => {
    setOptionsMenu(null);
  }, []);

  const openOptionsMenu = useCallback(
    (profile: WorkingDirectorySelectorProfile, trigger: HTMLElement, nextOpen?: boolean) => {
      if (disabled) {
        return;
      }

      if (nextOpen === false) {
        setOptionsMenu(null);
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const left = Math.min(
        Math.max(PROFILE_OPTIONS_VIEWPORT_PADDING, rect.right - PROFILE_OPTIONS_MENU_WIDTH),
        window.innerWidth - PROFILE_OPTIONS_MENU_WIDTH - PROFILE_OPTIONS_VIEWPORT_PADDING
      );

      setOptionsMenu({
        profile,
        left,
        top: rect.bottom + 4,
      });
    },
    [disabled]
  );

  useEffect(() => {
    if (!optionsMenu) {
      return;
    }

    renameMenuItemRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      if (isProfileOptionsTarget(event.target)) {
        return;
      }

      closeOptionsMenu();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOptionsMenu();
      }
    };

    const handleViewportChange = () => {
      closeOptionsMenu();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [closeOptionsMenu, optionsMenu]);

  const selectorTrigger = (
    <ModelSelectorDropdownTrigger asChild>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "min-w-0 shrink gap-2",
          // Narrow composer bar: shows the profile name only and never shrinks for the
          // pills to its right. Wide bars size to fit.
          "@max-lg/composer-bar:max-w-36 @max-lg/composer-bar:shrink-0",
          compact && "max-w-40 px-2",
          !disabled && "cursor-pointer",
          disabled && "cursor-default text-muted-foreground/80"
        )}
        aria-disabled={disabled}
        // Focus returning from a closed dropdown must not pop the details card.
        onFocus={(event) => {
          if (closedDropdownRef.current) {
            closedDropdownRef.current = false;
            event.preventDefault();
          }
        }}
        onPointerEnter={() => {
          closedDropdownRef.current = false;
        }}
        title={currentProfile ? `${currentProfile.name}${currentPath ? ` / ${currentPath.label}` : ""}` : "Select working directory"}
      >
        <StatusDot isOnline={currentProfile?.isOnline ?? false} />
        <span className="flex min-w-0">
          <span className="min-w-0 truncate">{currentProfile?.name ?? "Select working directory"}</span>
          {shouldShowPathInTrigger && (
            // Capped and middle-truncated: long worktree labels share their prefix, the end tells them apart.
            <span className="flex min-w-0 max-w-56 text-muted-foreground/60 @max-lg/composer-bar:hidden">
              <span className="shrink-0 whitespace-pre">{" / "}</span>
              <MiddleTruncate text={currentPath.label} />
            </span>
          )}
        </span>
        <ChevronDown className="size-3 opacity-50" />
      </Button>
    </ModelSelectorDropdownTrigger>
  );

  return (
    <>
      <ModelSelectorDropdown
        modal={false}
        open={open}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          setOpen(nextOpen);
          if (!nextOpen) {
            closedDropdownRef.current = true;
            setOptionsMenu(null);
          }
        }}
      >
        {currentProfile ? (
          <ProfileHoverCard profile={toProfileDetails(currentProfile)} disabled={open} triggerAsChild>
            {selectorTrigger}
          </ProfileHoverCard>
        ) : (
          selectorTrigger
        )}
        <ModelSelectorDropdownContent
          defaultHighlight={currentProfile && currentPath ? `${currentProfile.name} ${currentPath.label} ${currentPath.path}` : undefined}
          onFocusOutside={(event) => {
            if (isProfileOptionsTarget(event.target)) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => {
            if (isProfileOptionsTarget(event.target)) {
              event.preventDefault();
            }
          }}
        >
          <ModelSelectorDropdownInput placeholder="Search working directories..." />
          <ModelSelectorDropdownList>
            <ModelSelectorDropdownEmpty>No working directories found.</ModelSelectorDropdownEmpty>
            {profiles.map((profile) => (
              <ModelSelectorDropdownGroup
                key={profile._id}
                className="overflow-visible"
                heading={
                  <span className="group/profile-heading inline-flex w-full items-center gap-1.5">
                    <ProfileHoverCard
                      key={`${profile._id}-${optionsMenu ? "blocked" : "active"}`}
                      profile={toProfileDetails(profile)}
                      disabled={optionsMenu !== null}
                    >
                      <StatusDot isOnline={profile.isOnline} />
                      <span className="sr-only">{profile.isOnline ? "online" : "offline"}</span>
                      <span>{profile.name}</span>
                      {profile.profileKey && (
                        <span className="rounded-sm bg-muted px-1 py-0 text-[10px] text-muted-foreground">{profile.profileKey}</span>
                      )}
                    </ProfileHoverCard>
                    {!disabled && (
                      <button
                        type="button"
                        data-profile-options-trigger={profile._id}
                        aria-label={`Profile options for ${profile.name}`}
                        aria-haspopup="menu"
                        aria-expanded={optionsMenu?.profile._id === profile._id}
                        aria-controls={`profile-options-menu-${profile._id}`}
                        className="ml-auto inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground cursor-pointer"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
                            event.preventDefault();
                            openOptionsMenu(profile, event.currentTarget, optionsMenu?.profile._id !== profile._id);
                          }
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          openOptionsMenu(profile, event.currentTarget, optionsMenu?.profile._id !== profile._id);
                        }}
                      >
                        <MoreHorizontal className="size-3" />
                      </button>
                    )}
                  </span>
                }
              >
                {/* Worktrees are selected via the base-ref selector; detected
                    repos run in their folder, shown as its repo count. */}
                {profile.paths
                  .filter(isConfiguredPath)
                  .map((path) => (
                    <ModelSelectorDropdownItem
                      key={path.id}
                      value={`${profile.name} ${path.label} ${path.path}`}
                      onSelect={() => handleSelect(profile._id, path.id)}
                      data-checked={profile._id === profileId && path.id === pathId ? true : undefined}
                    >
                      <ModelSelectorDropdownName>
                        <span className="flex flex-col gap-0.5">
                          <span>{path.label}</span>
                          <span className="flex gap-2 text-[10px] text-muted-foreground/60">
                            <span className="truncate">{truncatePath(path.path)}</span>
                            <RepoCount paths={profile.paths} parentId={path.id} />
                          </span>
                        </span>
                      </ModelSelectorDropdownName>
                    </ModelSelectorDropdownItem>
                  ))}
              </ModelSelectorDropdownGroup>
            ))}
          </ModelSelectorDropdownList>
        </ModelSelectorDropdownContent>
      </ModelSelectorDropdown>
      {optionsMenu &&
        createPortal(
          <div
            id={`profile-options-menu-${optionsMenu.profile._id}`}
            role="menu"
            aria-label={`Options for ${optionsMenu.profile.name}`}
            data-profile-options-menu
            className={cn(POPOVER_SURFACE_CLASS, "pointer-events-auto fixed z-[60] w-36 overflow-hidden")}
            style={{
              left: optionsMenu.left,
              top: optionsMenu.top,
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <button
              ref={renameMenuItemRef}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-foreground cursor-pointer hover:bg-muted focus:bg-muted focus:outline-none"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleRenameRequest(optionsMenu.profile);
              }}
            >
              <Pencil className="size-3.5" />
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-destructive cursor-pointer hover:bg-muted focus:bg-muted focus:outline-none"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleDeleteRequest(optionsMenu.profile);
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </div>,
          document.body
        )}
      <RenameProfileDialog
        open={profileToRename !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setProfileToRename(null);
          }
        }}
        profileId={profileToRename?._id}
        currentName={profileToRename?.name ?? ""}
        hostname={profileToRename?.hostname}
        profileKey={profileToRename?.profileKey}
        onRename={handleRename}
      />
      <DeleteProfileDialog
        profile={profileToDelete}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setProfileToDelete(null);
        }}
      />
    </>
  );
}
