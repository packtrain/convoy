"use client";

import { isWorktreeParent } from "@/convex/lib/contracts/validators";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, ChevronDown, ChevronLeft, Cloud, FolderGit2, GitBranch, Home, Laptop, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { Switch } from "@/components/ui/switch";
import { CreateWorktreeBranchDialog } from "./create-worktree-branch-dialog";
import {
  ModelSelectorDropdown,
  ModelSelectorDropdownContent,
  ModelSelectorDropdownEmpty,
  ModelSelectorDropdownGroup,
  ModelSelectorDropdownInput,
  ModelSelectorDropdownItem,
  ModelSelectorDropdownList,
  ModelSelectorDropdownName,
  ModelSelectorDropdownSeparator,
  ModelSelectorDropdownTrigger,
} from "@/components/ai-elements/model-selector-dropdown";
import { cn } from "@/lib/utils";
import { useShowUnfinishedItems } from "@/lib/dev-mode/use-dev-mode";
import { loadPersistedRefs, parseScannedRefs, persistRefs, type ScannedRef } from "@/lib/threads/base-ref-storage";
import type { BaseRefPathEntry, BaseRefSelection } from "@/lib/threads/base-ref-selection";
import { getErrorMessage } from "@/lib/errors";

interface BaseRefSelectorProps {
  profileId: string;
  pathId: string;
  paths: BaseRefPathEntry[];
  isProfileOnline: boolean;
  value: BaseRefSelection | undefined;
  onChange: (value: BaseRefSelection | undefined) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Icon-only trigger (compact composers render it inside the selector row). */
  iconOnly?: boolean;
}

/**
 * Stale-while-revalidate branch scan for a profile+path: a background rescan
 * fires on mount/path change and again whenever `open` turns true (deduped
 * server-side); the last completed scan keeps rendering (and persists to
 * localStorage) while a refresh runs.
 */
function useBaseRefScan({
  profileId,
  pathId,
  enabled,
  open,
}: {
  profileId: string;
  pathId: string;
  /** Profile online, git parent path resolved, selector not disabled. */
  enabled: boolean;
  /** Any dropdown reading the scan is open — refresh on each open. */
  open: boolean;
}) {
  const [rescanOpId, setRescanOpId] = useState<Id<"cliWorktreeOps"> | null>(null);
  const [cachedRefs, setCachedRefs] = useState<{
    pathId: string;
    refs: ScannedRef[];
  } | null>(() => {
    const persisted = loadPersistedRefs(profileId, pathId);
    return persisted ? { pathId, refs: persisted } : null;
  });

  const enqueueOp = useMutation(api.cli.worktreeOps.enqueue);
  const rescanOp = useQuery(api.cli.worktreeOps.get, rescanOpId ? { opId: rescanOpId } : "skip");

  // Rehydrate the persisted scan when the selected path changes.
  useEffect(() => {
    setCachedRefs((current) => {
      if (current?.pathId === pathId) {
        return current;
      }
      const persisted = loadPersistedRefs(profileId, pathId);
      return persisted ? { pathId, refs: persisted } : null;
    });
  }, [profileId, pathId]);

  // Preload refs in the background on mount/path change, and refresh on each
  // open (deduped server-side against an already-pending rescan).
  const preloadedPathIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (!open && preloadedPathIdRef.current === pathId) {
      return;
    }
    preloadedPathIdRef.current = pathId;

    let cancelled = false;
    enqueueOp({
      profileId: profileId as Id<"cliProfiles">,
      kind: "rescan",
      pathId,
    })
      .then((opId) => {
        if (!cancelled) {
          setRescanOpId(opId);
        }
      })
      .catch(() => {
        // Refs are a progressive enhancement; the selector still works
        // with the local checkout + synced worktrees.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, enabled, pathId, profileId]);

  useEffect(() => {
    if (rescanOp?.status === "done") {
      const refs = parseScannedRefs(rescanOp.resultJson);
      setCachedRefs({ pathId: rescanOp.pathId, refs });
      persistRefs(rescanOp.profileId, rescanOp.pathId, refs);
    }
  }, [rescanOp]);

  const refs = useMemo(() => (cachedRefs?.pathId === pathId ? cachedRefs.refs : []), [cachedRefs, pathId]);
  // Only surface loading before the first scan; refreshes happen silently.
  const refsLoading = enabled && rescanOpId !== null && rescanOp?.status === "pending" && refs.length === 0;
  const currentBranch = refs.find((ref) => ref.isCurrent)?.name;

  return { refs, refsLoading, currentBranch };
}

/** Two-step-confirm worktree removal rows (shared by both selector layouts). */
function useWorktreeRemoval({
  profileId,
  value,
  onChange,
}: {
  profileId: string;
  value: BaseRefSelection | undefined;
  onChange: (value: BaseRefSelection | undefined) => void;
}) {
  const [removeOpId, setRemoveOpId] = useState<Id<"cliWorktreeOps"> | null>(null);
  const [confirmRemovePathId, setConfirmRemovePathId] = useState<string | null>(null);

  const enqueueOp = useMutation(api.cli.worktreeOps.enqueue);
  const removeOp = useQuery(api.cli.worktreeOps.get, removeOpId ? { opId: removeOpId } : "skip");

  // Surface the outcome of a requested worktree removal (once per op; the
  // op id stays set — finished op rows are ephemeral and TTL-pruned).
  const toastedRemoveOpIdRef = useRef<Id<"cliWorktreeOps"> | null>(null);
  useEffect(() => {
    if (!removeOp || removeOp.status === "pending" || toastedRemoveOpIdRef.current === removeOp._id) {
      return;
    }
    toastedRemoveOpIdRef.current = removeOp._id;
    if (removeOp.status === "failed") {
      toast.error(removeOp.error ?? "Failed to remove worktree");
    } else {
      toast.success("Worktree removed");
    }
  }, [removeOp]);

  const handleRemoveClick = useCallback(
    (worktreePathId: string) => {
      if (confirmRemovePathId !== worktreePathId) {
        setConfirmRemovePathId(worktreePathId);
        return;
      }
      setConfirmRemovePathId(null);
      enqueueOp({
        profileId: profileId as Id<"cliProfiles">,
        kind: "remove",
        pathId: worktreePathId,
      })
        .then((opId) => {
          setRemoveOpId(opId);
          if (value?.type === "worktree" && value.pathId === worktreePathId) {
            onChange(undefined);
          }
        })
        .catch((error) => {
          toast.error(getErrorMessage(error, "Failed to remove worktree"));
        });
    },
    [confirmRemovePathId, enqueueOp, onChange, profileId, value]
  );

  return { confirmRemovePathId, setConfirmRemovePathId, handleRemoveClick };
}

function RefBadge({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 rounded-sm bg-muted px-1 py-0 text-[10px] text-muted-foreground">{children}</span>;
}

/**
 * Right-aligned row suffix (badges/actions + selection check). The
 * `command-shortcut` slot suppresses CommandItem's built-in always-reserved
 * check icon, so unselected rows have no ghost trailing space.
 */
function RowEnd({ checked, children }: { checked: boolean; children?: React.ReactNode }) {
  return (
    <span data-slot="command-shortcut" className="ml-auto flex shrink-0 items-center gap-1.5">
      {children}
      {checked && <Check className="size-3.5" />}
    </span>
  );
}

function WorktreeRemoveButton({
  worktree,
  confirming,
  onRemove,
}: {
  worktree: BaseRefPathEntry;
  confirming: boolean;
  onRemove: (worktreePathId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove worktree ${worktree.branch ?? worktree.label}`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-sm px-1 text-muted-foreground hover:text-destructive cursor-pointer",
        confirming && "text-destructive"
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onRemove(worktree.id);
      }}
    >
      {confirming ? <span className="text-[10px] font-medium">Confirm?</span> : <Trash2 className="size-3" />}
    </button>
  );
}

/**
 * Where the thread runs, relative to the selected working directory: the
 * local checkout as-is (whatever branch is checked out), an existing
 * worktree, or a new worktree created from a base branch. Only rendered for
 * git repository paths. The "New worktree…" row swaps the dropdown content
 * to an in-place create page (no nested overlay).
 */
export function BaseRefSelector({
  profileId,
  pathId,
  paths,
  isProfileOnline,
  value,
  onChange,
  disabled = false,
  compact = false,
  iconOnly = false,
}: BaseRefSelectorProps) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"root" | "create">("root");
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [startFromOrigin, setStartFromOrigin] = useState(value?.type === "branch" ? value.startFromOrigin : false);

  const parentEntry = paths.find((path) => path.id === pathId && isWorktreeParent(paths, path));
  const worktrees = useMemo(() => paths.filter((path) => path.kind === "worktree" && path.parentPathId === pathId), [paths, pathId]);

  const { refs, refsLoading, currentBranch } = useBaseRefScan({
    profileId,
    pathId,
    enabled: isProfileOnline && Boolean(parentEntry) && !disabled,
    open,
  });
  const { confirmRemovePathId, setConfirmRemovePathId, handleRemoveClick } = useWorktreeRemoval({ profileId, value, onChange });

  const closeWith = useCallback(
    (selection: BaseRefSelection | undefined) => {
      onChange(selection);
      setOpen(false);
      setPage("root");
    },
    [onChange]
  );

  const openCreatePage = useCallback(() => {
    setStartFromOrigin(value?.type === "branch" ? value.startFromOrigin : false);
    setPage("create");
  }, [value]);

  // Picking a base commits immediately; the branch name is auto-derived from
  // the message. Named branches go through the dialog instead.
  const confirmCreate = useCallback(
    (baseRef: string) => {
      closeWith({ type: "branch", baseRef, startFromOrigin, branch: undefined });
    },
    [closeWith, startFromOrigin]
  );

  const openBranchDialog = useCallback(() => {
    setOpen(false);
    setPage("root");
    setBranchDialogOpen(true);
  }, []);

  const handleDialogCreate = useCallback(
    (branch: string) => {
      onChange({ type: "branch", baseRef: undefined, startFromOrigin, branch });
    },
    [onChange, startFromOrigin]
  );

  // Only meaningful for git repository paths.
  if (!parentEntry?.gitRemoteUrl) {
    return null;
  }

  const selectedWorktree = value?.type === "worktree" ? worktrees.find((wt) => wt.id === value.pathId) : undefined;
  // The default selection keeps a static label — no flicker as refs load.
  const branchSelectionLabel =
    value?.type === "branch"
      ? (value.branch?.trim() ?? "").length > 0
        ? (value.branch as string)
        : value.baseRef
          ? `From ${value.baseRef}`
          : "New worktree"
      : null;
  const triggerLabel = branchSelectionLabel ?? (selectedWorktree ? (selectedWorktree.branch ?? selectedWorktree.label) : "Work locally");

  return (
    <>
      <ModelSelectorDropdown
        modal={false}
        open={open}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          setOpen(nextOpen);
          if (!nextOpen) {
            setConfirmRemovePathId(null);
            setPage("root");
          }
        }}
      >
        <ModelSelectorDropdownTrigger asChild>
          <Button
            variant="ghost"
            size={iconOnly ? "icon-sm" : "sm"}
            className={cn(
              "min-w-0 gap-1.5",
              !iconOnly && compact && "max-w-40 px-2",
              !disabled && "cursor-pointer",
              disabled && "cursor-default text-muted-foreground/80"
            )}
            aria-disabled={disabled}
            aria-label={`Workspace: ${triggerLabel}`}
            title={`Workspace: ${triggerLabel}`}
          >
            <GitBranch
              className={cn(
                "size-3.5 shrink-0",
                // Non-default selection cue for the icon-only trigger.
                iconOnly && (value?.type === "branch" || value?.type === "worktree") ? "text-info" : "opacity-70"
              )}
            />
            {!iconOnly && (
              <>
                <MiddleTruncate text={triggerLabel} />
                <ChevronDown className="size-3 opacity-50" />
              </>
            )}
          </Button>
        </ModelSelectorDropdownTrigger>
        {/* Command keyed per page so cmdk search state resets between pages. */}
        <ModelSelectorDropdownContent commandKey={page}>
          {page === "root" ? (
            <>
              <ModelSelectorDropdownInput placeholder="Search..." />
              <ModelSelectorDropdownList>
                <ModelSelectorDropdownEmpty>Nothing found.</ModelSelectorDropdownEmpty>
                <ModelSelectorDropdownGroup>
                  <ModelSelectorDropdownItem
                    value={`work locally ${currentBranch ?? ""}`}
                    onSelect={() => closeWith(undefined)}
                    data-checked={!value || value.type === "current" ? true : undefined}
                  >
                    <Home className="size-3.5 shrink-0 opacity-70" />
                    <ModelSelectorDropdownName>Work locally</ModelSelectorDropdownName>
                    <RowEnd checked={!value || value.type === "current"}>{currentBranch && <RefBadge>{currentBranch}</RefBadge>}</RowEnd>
                  </ModelSelectorDropdownItem>
                </ModelSelectorDropdownGroup>
                {worktrees.length > 0 && (
                  <ModelSelectorDropdownGroup heading="Worktrees">
                    {worktrees.map((worktree) => (
                      <ModelSelectorDropdownItem
                        key={worktree.id}
                        value={`worktree ${worktree.branch ?? worktree.label} ${worktree.path}`}
                        onSelect={() => closeWith({ type: "worktree", pathId: worktree.id })}
                        data-checked={value?.type === "worktree" && value.pathId === worktree.id ? true : undefined}
                      >
                        <GitBranch className="size-3.5 shrink-0 opacity-70" />
                        <ModelSelectorDropdownName>{worktree.branch ?? worktree.label}</ModelSelectorDropdownName>
                        <RowEnd checked={value?.type === "worktree" && value.pathId === worktree.id}>
                          <WorktreeRemoveButton
                            worktree={worktree}
                            confirming={confirmRemovePathId === worktree.id}
                            onRemove={handleRemoveClick}
                          />
                        </RowEnd>
                      </ModelSelectorDropdownItem>
                    ))}
                  </ModelSelectorDropdownGroup>
                )}
                <ModelSelectorDropdownSeparator />
                <ModelSelectorDropdownGroup className="pt-2">
                  <ModelSelectorDropdownItem
                    value="new worktree create"
                    onSelect={openCreatePage}
                    data-checked={value?.type === "branch" ? true : undefined}
                  >
                    <Plus className="size-3.5 shrink-0 opacity-70" />
                    <ModelSelectorDropdownName>New worktree…</ModelSelectorDropdownName>
                    <RowEnd checked={value?.type === "branch"}>
                      {branchSelectionLabel && <RefBadge>{branchSelectionLabel}</RefBadge>}
                    </RowEnd>
                  </ModelSelectorDropdownItem>
                </ModelSelectorDropdownGroup>
              </ModelSelectorDropdownList>
              {!isProfileOnline && (
                <div className="border-t border-border px-2 pb-1.5 pt-2 text-xs text-muted-foreground">
                  CLI offline. Worktree creation is unavailable.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="border-b border-border p-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-xs font-medium hover:bg-muted cursor-pointer"
                  onClick={() => setPage("root")}
                >
                  <ChevronLeft className="size-3.5 text-muted-foreground" />
                  New worktree
                </button>
              </div>
              <p className="px-3 pt-2 pb-0.5 text-[10px] text-muted-foreground">Base branch</p>
              <ModelSelectorDropdownInput placeholder="Search branches..." />
              <ModelSelectorDropdownList>
                <ModelSelectorDropdownEmpty>{refsLoading ? "Loading branches…" : "No branches found."}</ModelSelectorDropdownEmpty>
                <ModelSelectorDropdownGroup>
                  {refs.map((ref) => (
                    <ModelSelectorDropdownItem
                      key={ref.name}
                      value={`base ${ref.name}`}
                      onSelect={() => confirmCreate(ref.name)}
                      data-checked={value?.type === "branch" && value.baseRef === ref.name ? true : undefined}
                    >
                      <ModelSelectorDropdownName>{ref.name}</ModelSelectorDropdownName>
                      <RowEnd checked={value?.type === "branch" && value.baseRef === ref.name}>
                        {ref.isCurrent && <RefBadge>current</RefBadge>}
                        {ref.remoteOnly && <RefBadge>origin</RefBadge>}
                      </RowEnd>
                    </ModelSelectorDropdownItem>
                  ))}
                </ModelSelectorDropdownGroup>
              </ModelSelectorDropdownList>
              <div className="border-t border-border px-2 py-1.5 pt-2.5 text-xs text-muted-foreground">
                {!isProfileOnline && <p className="pb-1">CLI offline. Branch list is unavailable.</p>}
                <label className="flex items-center justify-between gap-2 cursor-pointer">
                  <span>Start from origin</span>
                  <Switch checked={startFromOrigin} onCheckedChange={setStartFromOrigin} />
                </label>
              </div>
              <div className="p-1">
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-xs hover:bg-muted cursor-pointer"
                  onClick={openBranchDialog}
                >
                  <Plus className="size-3.5 text-muted-foreground" />
                  Create new branch…
                </button>
              </div>
            </>
          )}
        </ModelSelectorDropdownContent>
      </ModelSelectorDropdown>
      <CreateWorktreeBranchDialog
        key={String(branchDialogOpen)}
        open={branchDialogOpen}
        onOpenChange={setBranchDialogOpen}
        onCreate={handleDialogCreate}
      />
    </>
  );
}

export type WorkspaceSelectorsProps = Omit<BaseRefSelectorProps, "compact" | "iconOnly">;

/**
 * Split environment + branch selectors for the composer top bar (OS-1218): "Start in"
 * picks where the thread runs (local checkout, existing worktree, new worktree; Cloud is
 * a disabled preview) and the branch control shows — or, for a new worktree, picks — the
 * git ref. Both are views over the same `BaseRefSelection` the compact selector edits.
 */
export function WorkspaceSelectors({
  profileId,
  pathId,
  paths,
  isProfileOnline,
  value,
  onChange,
  disabled = false,
}: WorkspaceSelectorsProps) {
  const [envOpen, setEnvOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const showUnfinishedItems = useShowUnfinishedItems();

  const parentEntry = paths.find((path) => path.id === pathId && isWorktreeParent(paths, path));
  const worktrees = useMemo(() => paths.filter((path) => path.kind === "worktree" && path.parentPathId === pathId), [paths, pathId]);

  const { refs, refsLoading, currentBranch } = useBaseRefScan({
    profileId,
    pathId,
    enabled: isProfileOnline && Boolean(parentEntry) && !disabled,
    open: envOpen || branchOpen,
  });
  const { confirmRemovePathId, setConfirmRemovePathId, handleRemoveClick } = useWorktreeRemoval({ profileId, value, onChange });

  const branchSelection = value?.type === "branch" ? value : undefined;
  const startFromOrigin = branchSelection?.startFromOrigin ?? false;

  const handleDialogCreate = useCallback(
    (branch: string) => {
      onChange({
        type: "branch",
        baseRef: branchSelection?.baseRef,
        startFromOrigin,
        branch,
      });
    },
    [branchSelection?.baseRef, onChange, startFromOrigin]
  );

  // Only meaningful for git repository paths.
  if (!parentEntry?.gitRemoteUrl) {
    return null;
  }

  const selectedWorktree = value?.type === "worktree" ? worktrees.find((wt) => wt.id === value.pathId) : undefined;
  const environment: "local" | "worktree" | "new-worktree" = branchSelection ? "new-worktree" : selectedWorktree ? "worktree" : "local";
  const environmentLabel = environment === "local" ? "Work locally" : environment === "worktree" ? "Worktree" : "New worktree";
  const EnvironmentIcon = environment === "local" ? Laptop : environment === "worktree" ? FolderGit2 : Plus;

  // The read-only branch label for non-editable environments; the editable
  // new-worktree label falls back to the repo's default branch.
  const branchLabel =
    environment === "new-worktree"
      ? (branchSelection?.branch?.trim() ?? "").length > 0
        ? (branchSelection?.branch as string)
        : branchSelection?.baseRef
          ? `From ${branchSelection.baseRef}`
          : "Default branch"
      : environment === "worktree"
        ? (selectedWorktree?.branch ?? selectedWorktree?.label ?? null)
        : (currentBranch ?? null);

  const triggerClassName = cn("min-w-0 shrink gap-1.5", !disabled && "cursor-pointer", disabled && "cursor-default text-muted-foreground/80");

  return (
    <>
      <ModelSelectorDropdown
        modal={false}
        open={envOpen}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          setEnvOpen(nextOpen);
          if (!nextOpen) {
            setConfirmRemovePathId(null);
          }
        }}
      >
        <ModelSelectorDropdownTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={triggerClassName}
            aria-disabled={disabled}
            aria-label={`Environment: ${environmentLabel}`}
            title={`Environment: ${environmentLabel}`}
          >
            <EnvironmentIcon className="size-3.5 shrink-0 opacity-70" />
            {/* Icon-only in a narrow composer bar; the title/aria-label carry the value. */}
            <span className="hidden min-w-0 truncate @2xl/composer-bar:inline">{environmentLabel}</span>
            <ChevronDown className="hidden size-3 opacity-50 @2xl/composer-bar:block" />
          </Button>
        </ModelSelectorDropdownTrigger>
        <ModelSelectorDropdownContent className="[&_[data-slot=command]]:p-0">
          <ModelSelectorDropdownList>
            <ModelSelectorDropdownGroup heading="Start in">
              <ModelSelectorDropdownItem
                value="work locally"
                onSelect={() => {
                  onChange(undefined);
                  setEnvOpen(false);
                }}
                data-checked={environment === "local" ? true : undefined}
              >
                <Laptop className="size-3.5 shrink-0 opacity-70" />
                <ModelSelectorDropdownName>Work locally</ModelSelectorDropdownName>
                <RowEnd checked={environment === "local"}>{currentBranch && <RefBadge>{currentBranch}</RefBadge>}</RowEnd>
              </ModelSelectorDropdownItem>
              {worktrees.map((worktree) => (
                <ModelSelectorDropdownItem
                  key={worktree.id}
                  value={`worktree ${worktree.branch ?? worktree.label} ${worktree.path}`}
                  onSelect={() => {
                    onChange({ type: "worktree", pathId: worktree.id });
                    setEnvOpen(false);
                  }}
                  data-checked={selectedWorktree?.id === worktree.id ? true : undefined}
                >
                  <FolderGit2 className="size-3.5 shrink-0 opacity-70" />
                  <ModelSelectorDropdownName>{worktree.branch ?? worktree.label}</ModelSelectorDropdownName>
                  <RowEnd checked={selectedWorktree?.id === worktree.id}>
                    <WorktreeRemoveButton
                      worktree={worktree}
                      confirming={confirmRemovePathId === worktree.id}
                      onRemove={handleRemoveClick}
                    />
                  </RowEnd>
                </ModelSelectorDropdownItem>
              ))}
              <ModelSelectorDropdownItem
                value="new worktree"
                onSelect={() => {
                  // Bare selection = new worktree from the repo's default
                  // branch (OS-1094); the branch selector refines the base.
                  onChange({ type: "branch", baseRef: undefined, startFromOrigin: false, branch: undefined });
                  setEnvOpen(false);
                }}
                data-checked={environment === "new-worktree" ? true : undefined}
              >
                <Plus className="size-3.5 shrink-0 opacity-70" />
                <ModelSelectorDropdownName>New worktree</ModelSelectorDropdownName>
                <RowEnd checked={environment === "new-worktree"} />
              </ModelSelectorDropdownItem>
            </ModelSelectorDropdownGroup>
            {showUnfinishedItems && (
              <>
                <ModelSelectorDropdownSeparator />
                <ModelSelectorDropdownGroup>
                  {/* ponytail: disabled preview — becomes a real environment when the cloud runtime lands. */}
                  <ModelSelectorDropdownItem value="cloud" disabled>
                    <Cloud className="size-3.5 shrink-0 opacity-70" />
                    <ModelSelectorDropdownName>Cloud</ModelSelectorDropdownName>
                    <RowEnd checked={false}>
                      <RefBadge>Soon</RefBadge>
                    </RowEnd>
                  </ModelSelectorDropdownItem>
                </ModelSelectorDropdownGroup>
              </>
            )}
          </ModelSelectorDropdownList>
          {!isProfileOnline && (
            <div className="border-t border-border px-2 pb-1.5 pt-2 text-xs text-muted-foreground">
              CLI offline. Worktree creation is unavailable.
            </div>
          )}
        </ModelSelectorDropdownContent>
      </ModelSelectorDropdown>
      {environment === "new-worktree" ? (
        <ModelSelectorDropdown modal={false} open={branchOpen} onOpenChange={(nextOpen) => !disabled && setBranchOpen(nextOpen)}>
          <ModelSelectorDropdownTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={triggerClassName}
              aria-disabled={disabled}
              aria-label={`Base branch: ${branchLabel}`}
              title={`Base branch: ${branchLabel}`}
            >
              <GitBranch className="size-3.5 shrink-0 opacity-70" />
              <MiddleTruncate text={branchLabel ?? ""} />
              <ChevronDown className="size-3 opacity-50" />
            </Button>
          </ModelSelectorDropdownTrigger>
          <ModelSelectorDropdownContent className="[&_[data-slot=command]]:p-0">
            <p className="px-3 pt-2 pb-0.5 text-[10px] text-muted-foreground">Base branch</p>
            <ModelSelectorDropdownInput placeholder="Search branches..." />
            <ModelSelectorDropdownList>
              <ModelSelectorDropdownEmpty>{refsLoading ? "Loading branches…" : "No branches found."}</ModelSelectorDropdownEmpty>
              <ModelSelectorDropdownGroup>
                {refs.map((ref) => (
                  <ModelSelectorDropdownItem
                    key={ref.name}
                    value={`base ${ref.name}`}
                    onSelect={() => {
                      onChange({ type: "branch", baseRef: ref.name, startFromOrigin, branch: branchSelection?.branch });
                      setBranchOpen(false);
                    }}
                    data-checked={branchSelection?.baseRef === ref.name ? true : undefined}
                  >
                    <ModelSelectorDropdownName>{ref.name}</ModelSelectorDropdownName>
                    <RowEnd checked={branchSelection?.baseRef === ref.name}>
                      {ref.isCurrent && <RefBadge>current</RefBadge>}
                      {ref.remoteOnly && <RefBadge>origin</RefBadge>}
                    </RowEnd>
                  </ModelSelectorDropdownItem>
                ))}
              </ModelSelectorDropdownGroup>
            </ModelSelectorDropdownList>
            <div className="border-t border-border px-2 py-1.5 pt-2.5 text-xs text-muted-foreground">
              {!isProfileOnline && <p className="pb-1">CLI offline. Branch list is unavailable.</p>}
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>Start from origin</span>
                <Switch
                  checked={startFromOrigin}
                  onCheckedChange={(checked) =>
                    onChange({
                      type: "branch",
                      baseRef: branchSelection?.baseRef,
                      startFromOrigin: checked,
                      branch: branchSelection?.branch,
                    })
                  }
                />
              </label>
            </div>
            <div className="p-1">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-xs hover:bg-muted cursor-pointer"
                onClick={() => {
                  setBranchOpen(false);
                  setBranchDialogOpen(true);
                }}
              >
                <Plus className="size-3.5 text-muted-foreground" />
                Create new branch…
              </button>
            </div>
          </ModelSelectorDropdownContent>
        </ModelSelectorDropdown>
      ) : branchLabel ? (
        <div
          className="flex h-7 min-w-0 max-w-44 shrink items-center gap-1.5 rounded-[min(var(--radius-md),12px)] px-2 text-[0.8rem] leading-4 text-muted-foreground"
          title={environment === "worktree" ? `Worktree branch: ${branchLabel}` : `Branch checked out locally: ${branchLabel}`}
        >
          <GitBranch className="size-3.5 shrink-0 opacity-70" />
          <MiddleTruncate text={branchLabel} />
        </div>
      ) : null}
      <CreateWorktreeBranchDialog
        key={String(branchDialogOpen)}
        open={branchDialogOpen}
        onOpenChange={setBranchDialogOpen}
        onCreate={handleDialogCreate}
      />
    </>
  );
}
