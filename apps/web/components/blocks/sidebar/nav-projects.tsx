"use client";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  hasOrgPermission,
  hasProjectPermission,
  OrgPermission,
  ProjectPermission,
} from "@/lib/authz/permissions";
import type { OrgRole, ProjectRole } from "@/lib/authz/roles";
import {
  AppLink,
  appRoute,
  href,
  useNavigation,
  useNavigationLocation,
} from "@/lib/navigation";
import {
  parseProjectParams,
  projectEntryTarget,
  type BoardGroupBy,
  type BoardRowGroupBy,
  type ListGroupBy,
  type DefaultViewSettings,
  type ProjectViewMode,
} from "@/lib/navigation/project-state";
import type { Id } from "@/convex/_generated/dataModel";
import { showConvexErrorToast } from "@/lib/errors";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  BotMessageSquare,
  TowerControl,
  GitPullRequest,
  ChevronDown,
  ChevronRight,
  Hash,
  MoreHorizontal,
  PinOff,
  Plus,
} from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskListActionsMenu } from "@/components/blocks/project/task-lists/task-list-actions-menu";
import { getTaskListPinAction } from "@/components/blocks/project/task-lists/task-list-pin-button";
import { TaskListIdentity } from "@/components/blocks/project/task-lists/task-list-identity";
import { useTaskListActions } from "@/components/blocks/project/task-lists/use-task-list-actions";
import { ProjectActionsDropdown } from "@/components/blocks/project/project-actions-dropdown";
import {
  NavSectionButton,
  NavItemsSkeleton,
  NavItemsEmptyState,
  NavSection,
} from "./nav-section";
import { useDialogWithData } from "@/hooks/ui/use-dialog";
import {
  ProjectDialog,
  type ProjectDialogData,
} from "@/components/blocks/project/project-dialog";
import {
  deriveProjectRouteState,
  type ProjectRouteSection,
} from "./nav-projects-route-state";
import {
  loadCollapsedProjectIds,
  saveCollapsedProjectIds,
} from "./project-list-collapse-storage";
import { useSidebarTaskDrop } from "./use-sidebar-task-drop";
import { cn } from "@/lib/utils";

interface NavProjectsProps {
  organizationId: Id<"organizations">;
  organizationSlug: string;
  iconOnly?: boolean;
}

type PinnedSidebarList = FunctionReturnType<
  typeof api.tasks.lists.listPinnedForOrganization
>[number]["lists"][number];

const EMPTY_PINNED_LISTS: PinnedSidebarList[] = [];

// Stable identity for a pinned entry; persisted Lists key by id, system Lists
// by their key namespaced to avoid colliding with a List id.
function pinnedListKey(list: PinnedSidebarList): string {
  return list.type === "list" ? list._id : `system:${list.key}`;
}

function arePinnedListsEqual(
  prev: PinnedSidebarList[],
  next: PinnedSidebarList[]
): boolean {
  if (prev === next) {
    return true;
  }
  if (prev.length !== next.length) {
    return false;
  }
  return prev.every((list, index) => {
    const other = next[index];
    if (list.type !== other.type) {
      return false;
    }
    if (list.type === "list" && other.type === "list") {
      return (
        list._id === other._id &&
        list.ref === other.ref &&
        list.name === other.name &&
        list.color === other.color &&
        list.isDefault === other.isDefault &&
        list.defaultViewMode === other.defaultViewMode &&
        list.defaultBoardGroupBy === other.defaultBoardGroupBy &&
        list.defaultBoardRowGroupBy === other.defaultBoardRowGroupBy &&
        list.defaultListGroupBy === other.defaultListGroupBy
      );
    }
    return pinnedListKey(list) === pinnedListKey(other);
  });
}

const SUB_ITEM_ACTIVE_RULE_CLASS =
  "before:absolute before:-left-2.75 before:bottom-1 before:top-1 before:w-0.5 before:bg-sidebar-foreground/50 before:content-['']";
const SUB_ITEM_HOVER_RULE_CLASS =
  "hover:before:absolute hover:before:-left-2.75 hover:before:bottom-1 hover:before:top-1 hover:before:w-0.5 hover:before:bg-sidebar-foreground/25 hover:before:content-['']";
const SUB_ITEM_BUTTON_CLASS =
  "relative w-full bg-transparent hover:bg-transparent active:bg-transparent data-active:bg-transparent data-active:font-semibold data-active:text-sidebar-foreground data-active:hover:bg-transparent";

function ProjectPinnedLists({
  projectId,
  getListEntryHref,
  pinnedLists,
  activeListRef,
  isListViewActive,
}: {
  projectId: Id<"projects">;
  getListEntryHref: (list: PinnedSidebarList) => string;
  pinnedLists: PinnedSidebarList[];
  activeListRef: string | null;
  isListViewActive: boolean;
}) {
  const { isMobile } = useSidebar();
  const { rowActions, systemActions, dialogs } = useTaskListActions({ projectId });
  const { dropTargetKey, getDropTargetProps } = useSidebarTaskDrop(projectId);

  return (
    <>
      {pinnedLists.map((list) => {
        const key = pinnedListKey(list);
        // The pinned default List is also the selected one while the
        // project's default view is on screen (no list param).
        const isActive =
          activeListRef === list.ref ||
          (isListViewActive &&
            activeListRef === null &&
            list.type === "list" &&
            list.isDefault);
        const isDropTarget = dropTargetKey === key;

        // System Lists (Backlog) have no `taskLists` row, so they render a
        // slimmed sub-item: navigate + a direct Unpin button, no `...` menu.
        if (list.type === "system") {
          const canUnpin = Boolean(systemActions.onUnpin);
          return (
            <SidebarMenuSubItem
              key={key}
              {...(isActive
                ? {}
                : getDropTargetProps({ key, listRef: list.ref }))}
              className={isActive ? SUB_ITEM_ACTIVE_RULE_CLASS : SUB_ITEM_HOVER_RULE_CLASS}
            >
              <SidebarMenuSubButton
                asChild
                isActive={isActive}
                className={cn(
                  SUB_ITEM_BUTTON_CLASS,
                  canUnpin
                    ? "group-hover/menu-sub-item:pr-6 group-focus-within/menu-sub-item:pr-6"
                    : "",
                  isDropTarget &&
                    "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-ring hover:bg-sidebar-accent data-active:bg-sidebar-accent"
                )}
              >
                <AppLink
                  href={getListEntryHref(list)}
                  className="cursor-pointer"
                >
                  <TaskListIdentity list={list} size="compact" />
                </AppLink>
              </SidebarMenuSubButton>
              {canUnpin ? (
                <SidebarMenuAction
                  aria-label={`Unpin ${list.name} from sidebar`}
                  title="Unpin from sidebar"
                  className="top-1 right-1 data-open:opacity-100 md:opacity-0 md:group-hover/menu-sub-item:opacity-100 md:group-focus-within/menu-sub-item:opacity-100 [&>svg]:!size-3"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    systemActions.onUnpin?.(list.key);
                  }}
                >
                  <PinOff />
                  <span className="sr-only">Unpin from sidebar</span>
                </SidebarMenuAction>
              ) : null}
            </SidebarMenuSubItem>
          );
        }

        const pinAction = rowActions ? getTaskListPinAction(list, rowActions) : null;
        const PinIcon = pinAction?.Icon;

        return (
        <SidebarMenuSubItem
          key={key}
          // Dragged tasks always come from the currently viewed List, so
          // the selected List is not a drop target.
          {...(isActive
            ? {}
            : getDropTargetProps({ key, listRef: list.ref }))}
          style={list.color ? ({ "--indicator-color": list.color } as CSSProperties) : undefined}
          className={
            isActive
              ? `before:absolute before:-left-2.75 before:bottom-1 before:top-1 before:w-0.5 before:content-[''] ${list.color ? "before:bg-(--indicator-color)" : "before:bg-sidebar-foreground/50"}`
              : `hover:before:absolute hover:before:-left-2.75 hover:before:bottom-1 hover:before:top-1 hover:before:w-0.5 hover:before:content-[''] ${list.color ? "hover:before:bg-(--indicator-color) hover:before:opacity-50" : "hover:before:bg-sidebar-foreground/25"}`
          }
        >
          <SidebarMenuSubButton
            asChild
            isActive={isActive}
            className={cn(
              SUB_ITEM_BUTTON_CLASS,
              pinAction
                ? "group-hover/menu-sub-item:pr-12 group-focus-within/menu-sub-item:pr-12"
                : rowActions
                  ? "group-hover/menu-sub-item:pr-6 group-focus-within/menu-sub-item:pr-6"
                  : "",
              isDropTarget &&
                "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-ring hover:bg-sidebar-accent data-active:bg-sidebar-accent"
            )}
          >
            <AppLink
              href={getListEntryHref(list)}
              className="cursor-pointer"
            >
              <TaskListIdentity list={list} size="compact" />
            </AppLink>
          </SidebarMenuSubButton>
          {pinAction && PinIcon ? (
            <SidebarMenuAction
              aria-label={pinAction.ariaLabel}
              title={pinAction.menuLabel}
              className="top-1 right-7 data-open:opacity-100 md:opacity-0 md:group-hover/menu-sub-item:opacity-100 md:group-focus-within/menu-sub-item:opacity-100 [&>svg]:!size-3"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void pinAction.run();
              }}
            >
              <PinIcon />
              <span className="sr-only">{pinAction.menuLabel}</span>
            </SidebarMenuAction>
          ) : null}
          {rowActions ? (
            <TaskListActionsMenu
              list={list}
              actions={rowActions}
              side={isMobile ? "bottom" : "right"}
              align={isMobile ? "end" : "start"}
              trigger={
                <SidebarMenuAction
                  aria-label={`Actions for ${list.name}`}
                  className="top-1 right-1 data-open:opacity-100 md:opacity-0 md:group-hover/menu-sub-item:opacity-100 md:group-focus-within/menu-sub-item:opacity-100"
                >
                  <MoreHorizontal />
                  <span className="sr-only">More</span>
                </SidebarMenuAction>
              }
            />
          ) : null}
        </SidebarMenuSubItem>
        );
      })}
      {dialogs}
    </>
  );
}

function ProjectPinnedListsDropdown({
  project,
  threadsHref,
  watchTowerHref,
  pullRequestsHref,
  getListEntryHref,
  pinnedLists,
  open,
  onOpenChange,
}: {
  project: ProjectItemProps["project"];
  /** Null when the caller has no threads access in this project. */
  threadsHref: string | null;
  watchTowerHref: string | null;
  pullRequestsHref: string;
  getListEntryHref: (list: PinnedSidebarList) => string;
  pinnedLists: PinnedSidebarList[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Open lists for ${project.name}`}
          title="Open lists"
          className="absolute left-0 top-0 z-10 hidden size-8 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-2 focus-visible:outline-sidebar-ring data-[state=open]:flex group-data-[collapsible=icon]:flex"
          style={project.color ? { color: project.color } : undefined}
        >
          <Hash className="size-4" strokeWidth={1} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={5}
        className="min-w-48 rounded-lg"
      >
        <DropdownMenuLabel className="truncate">{project.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {threadsHref ? (
          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <AppLink href={threadsHref}>
              <BotMessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Threads</span>
            </AppLink>
          </DropdownMenuItem>
        ) : null}
        {watchTowerHref ? (
          <DropdownMenuItem asChild className="cursor-pointer gap-2">
            <AppLink href={watchTowerHref}>
              <TowerControl className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">Watch Tower</span>
            </AppLink>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <AppLink href={pullRequestsHref}>
            <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Pull Requests</span>
          </AppLink>
        </DropdownMenuItem>
        {pinnedLists.map((list) => (
          <DropdownMenuItem
            key={pinnedListKey(list)}
            asChild
            className="cursor-pointer gap-2"
          >
            <AppLink href={getListEntryHref(list)}>
              <TaskListIdentity list={list} size="compact" />
            </AppLink>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PROJECT_DEFAULT_LIST_DROP_KEY = "project-default-list";

interface ProjectItemProps {
  project: {
    _id: Id<"projects">;
    name: string;
    alias: string;
    description?: string;
    color?: string;
    defaultListId?: Id<"taskLists">;
    defaultViewMode?: ProjectViewMode;
    defaultBoardGroupBy?: BoardGroupBy;
    defaultBoardRowGroupBy?: BoardRowGroupBy;
    defaultListGroupBy?: ListGroupBy;
    /** The project default List's own default-view override, if it has one. */
    defaultListView?: DefaultViewSettings;
  };
  projectPath: string;
  isActive: boolean;
  isThreadsActive: boolean;
  isWatchTowerActive: boolean;
  isPullRequestsActive: boolean;
  /** False for viewers: no Threads row (docs/specs/read-only-viewer-ux.md). */
  canUseThreads: boolean;
  myRole: ProjectRole | null;
  orgRole: OrgRole | null | undefined;
  pinnedLists: PinnedSidebarList[];
  activeListRef: string | null;
  isListViewActive: boolean;
  isListsCollapsed: boolean;
  iconOnly: boolean;
  onDelete: (project: { _id: Id<"projects">; name: string }) => void;
  organizationSlug: string;
  onToggleListsCollapsed: (projectId: Id<"projects">) => void;
}

const ProjectItem = memo(
  function ProjectItem({
    project,
    projectPath,
    isActive,
    isThreadsActive,
    isWatchTowerActive,
    isPullRequestsActive,
    canUseThreads,
    myRole,
    orgRole,
    pinnedLists,
    activeListRef,
    isListViewActive,
    isListsCollapsed,
    iconOnly,
    onDelete,
    organizationSlug,
    onToggleListsCollapsed,
  }: ProjectItemProps) {
    const { state } = useSidebar();
    const [pinnedListsOpen, setPinnedListsOpen] = useState(false);
    const handleDelete = () => {
      onDelete({ _id: project._id, name: project.name });
    };

    const handleToggleListsCollapsed = (
      event: MouseEvent<HTMLButtonElement>
    ) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleListsCollapsed(project._id);
    };

    // Entry links into the project resolve its stored default view; a pinned List link resolves
    // that List's own override first (OS-1566). System pins (Backlog) have no List row, so they
    // inherit the project default. The project row opens the default List (no `list` param), so
    // its own override wins.
    const projectEntryPath = href(
      projectEntryTarget(projectPath, project, { list: project.defaultListView })
    );
    const threadsHref = canUseThreads
      ? href(appRoute.projectThreads(organizationSlug, project.alias))
      : null;
    const watchTowerHref = canUseThreads
      ? href(appRoute.projectWatchTower(organizationSlug, project.alias))
      : null;
    // Every member reads PRs, viewers included (docs/specs/github-integration.md).
    const pullRequestsHref = href(appRoute.projectPullRequests(organizationSlug, project.alias));
    const getListEntryHref = (list: PinnedSidebarList) =>
      href(
        projectEntryTarget(projectPath, project, {
          listRef: list.ref,
          list: list.type === "list" ? list : null,
        })
      );

    // Dropping dragged tasks on the project row moves them to its default
    // List. Dragged tasks always come from the currently viewed List, so the
    // row is not a drop target while the default List is what's on screen
    // (default view, or the pinned default List selected explicitly).
    const { dropTargetKey, getDropTargetProps } = useSidebarTaskDrop(
      project._id
    );
    const defaultPinnedListRef =
      pinnedLists.find((list) => list.type === "list" && list.isDefault)?.ref ??
      null;
    const isViewingDefaultList = isListViewActive && (activeListRef === null || activeListRef === defaultPinnedListRef);
    const isDropTarget = dropTargetKey === PROJECT_DEFAULT_LIST_DROP_KEY;
    const dropTargetProps =
      project.defaultListId && !isViewingDefaultList
        ? getDropTargetProps({
            key: PROJECT_DEFAULT_LIST_DROP_KEY,
            listId: project.defaultListId,
          })
        : undefined;
    const isSidebarCollapsed = iconOnly || state === "collapsed";
    const ToggleIcon = isListsCollapsed ? ChevronRight : ChevronDown;
    const pinnedListsId = useId();

    return (
      <>
        <SidebarMenuItem {...dropTargetProps}>
          <SidebarMenuButton
            asChild
            isActive={isActive}
            reserveActionSpace={false}
            className={cn(
              "group-hover/menu-item:pr-8 group-focus-within/menu-item:pr-8",
              isDropTarget &&
                "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-ring"
            )}
          >
            <AppLink href={projectEntryPath} className="cursor-pointer">
              <Hash
                className="size-4 opacity-0 transition-opacity md:opacity-100 md:group-hover/menu-item:opacity-0 md:group-focus-within/menu-item:opacity-0 group-data-[collapsible=icon]:opacity-0"
                strokeWidth={1}
                style={project.color ? { color: project.color } : undefined}
              />
              <span>{project.name}</span>
            </AppLink>
          </SidebarMenuButton>
          {isSidebarCollapsed || pinnedListsOpen ? (
            <ProjectPinnedListsDropdown
              project={project}
              threadsHref={threadsHref}
              watchTowerHref={watchTowerHref}
              pullRequestsHref={pullRequestsHref}
              getListEntryHref={getListEntryHref}
              pinnedLists={pinnedLists}
              open={pinnedListsOpen}
              onOpenChange={setPinnedListsOpen}
            />
          ) : null}
          {!isSidebarCollapsed ? (
            <button
              type="button"
              aria-controls={pinnedListsId}
              aria-expanded={!isListsCollapsed}
              aria-label={
                isListsCollapsed
                  ? `Expand lists for ${project.name}`
                  : `Collapse lists for ${project.name}`
              }
              title={isListsCollapsed ? "Expand lists" : "Collapse lists"}
              className="absolute left-2 top-1/2 z-10 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-sidebar-foreground opacity-100 outline-hidden transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring md:opacity-0 md:group-hover/menu-item:opacity-100 md:group-focus-within/menu-item:opacity-100"
              style={project.color ? { color: project.color } : undefined}
              onClick={handleToggleListsCollapsed}
            >
              <ToggleIcon className="size-4" />
            </button>
          ) : null}
          <ProjectActionsDropdown
            organizationSlug={organizationSlug}
            projectAlias={project.alias}
            myRole={myRole}
            orgRole={orgRole}
            onDelete={handleDelete}
          />
        </SidebarMenuItem>
        {!isSidebarCollapsed && !isListsCollapsed ? (
          <SidebarMenuItem>
            <SidebarMenuSub id={pinnedListsId} className="ml-3.5 mr-1 mt-1 pr-0">
              {threadsHref ? (
                <SidebarMenuSubItem
                  className={isThreadsActive ? SUB_ITEM_ACTIVE_RULE_CLASS : SUB_ITEM_HOVER_RULE_CLASS}
                >
                  <SidebarMenuSubButton
                    asChild
                    isActive={isThreadsActive}
                    className={SUB_ITEM_BUTTON_CLASS}
                  >
                    <AppLink
                      href={threadsHref}
                      aria-current={isThreadsActive ? "page" : undefined}
                      className="cursor-pointer"
                    >
                      <BotMessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">Threads</span>
                    </AppLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ) : null}
              {watchTowerHref ? (
                <SidebarMenuSubItem
                  className={isWatchTowerActive ? SUB_ITEM_ACTIVE_RULE_CLASS : SUB_ITEM_HOVER_RULE_CLASS}
                >
                  <SidebarMenuSubButton
                    asChild
                    isActive={isWatchTowerActive}
                    className={SUB_ITEM_BUTTON_CLASS}
                  >
                    <AppLink
                      href={watchTowerHref}
                      aria-current={isWatchTowerActive ? "page" : undefined}
                      className="cursor-pointer"
                    >
                      <TowerControl className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">Watch Tower</span>
                    </AppLink>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ) : null}
              <SidebarMenuSubItem
                className={isPullRequestsActive ? SUB_ITEM_ACTIVE_RULE_CLASS : SUB_ITEM_HOVER_RULE_CLASS}
              >
                <SidebarMenuSubButton
                  asChild
                  isActive={isPullRequestsActive}
                  className={SUB_ITEM_BUTTON_CLASS}
                >
                  <AppLink
                    href={pullRequestsHref}
                    aria-current={isPullRequestsActive ? "page" : undefined}
                    className="cursor-pointer"
                  >
                    <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">Pull Requests</span>
                  </AppLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
              {pinnedLists.length > 0 ? (
                <ProjectPinnedLists
                  projectId={project._id}
                  getListEntryHref={getListEntryHref}
                  pinnedLists={pinnedLists}
                  activeListRef={activeListRef}
                  isListViewActive={isListViewActive}
                />
              ) : null}
            </SidebarMenuSub>
          </SidebarMenuItem>
        ) : null}
      </>
    );
  },
  (prevProps, nextProps) =>
    prevProps.project._id === nextProps.project._id &&
    prevProps.project.name === nextProps.project.name &&
    prevProps.project.alias === nextProps.project.alias &&
    prevProps.project.description === nextProps.project.description &&
    prevProps.project.color === nextProps.project.color &&
    prevProps.project.defaultListId === nextProps.project.defaultListId &&
    prevProps.project.defaultViewMode === nextProps.project.defaultViewMode &&
    prevProps.project.defaultBoardGroupBy === nextProps.project.defaultBoardGroupBy &&
    prevProps.project.defaultBoardRowGroupBy === nextProps.project.defaultBoardRowGroupBy &&
    prevProps.project.defaultListGroupBy === nextProps.project.defaultListGroupBy &&
    prevProps.project.defaultListView?.defaultViewMode ===
      nextProps.project.defaultListView?.defaultViewMode &&
    prevProps.project.defaultListView?.defaultBoardGroupBy ===
      nextProps.project.defaultListView?.defaultBoardGroupBy &&
    prevProps.project.defaultListView?.defaultBoardRowGroupBy ===
      nextProps.project.defaultListView?.defaultBoardRowGroupBy &&
    prevProps.project.defaultListView?.defaultListGroupBy ===
      nextProps.project.defaultListView?.defaultListGroupBy &&
    prevProps.projectPath === nextProps.projectPath &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isThreadsActive === nextProps.isThreadsActive &&
    prevProps.isWatchTowerActive === nextProps.isWatchTowerActive &&
    prevProps.isPullRequestsActive === nextProps.isPullRequestsActive &&
    prevProps.canUseThreads === nextProps.canUseThreads &&
    prevProps.myRole === nextProps.myRole &&
    prevProps.orgRole === nextProps.orgRole &&
    arePinnedListsEqual(prevProps.pinnedLists, nextProps.pinnedLists) &&
    prevProps.activeListRef === nextProps.activeListRef &&
    prevProps.isListViewActive === nextProps.isListViewActive &&
    prevProps.isListsCollapsed === nextProps.isListsCollapsed &&
    prevProps.iconOnly === nextProps.iconOnly &&
    prevProps.onDelete === nextProps.onDelete &&
    prevProps.organizationSlug === nextProps.organizationSlug &&
    prevProps.onToggleListsCollapsed === nextProps.onToggleListsCollapsed
);

interface DeleteDialogState {
  open: boolean;
  project: { _id: Id<"projects">; name: string } | null;
}

interface ProjectViewModel {
  project: ProjectItemProps["project"];
  projectPath: string;
  isActive: boolean;
  isThreadsActive: boolean;
  isWatchTowerActive: boolean;
  isPullRequestsActive: boolean;
  canUseThreads: boolean;
  myRole: ProjectRole | null;
  pinnedLists: PinnedSidebarList[];
  activeListRef: string | null;
  isListViewActive: boolean;
  isListsCollapsed: boolean;
}

export function NavProjects({
  organizationId,
  organizationSlug,
  iconOnly = false,
}: NavProjectsProps) {
  const { pathname, search } = useNavigationLocation();
  const routeState = useMemo(
    () => deriveProjectRouteState(pathname, organizationSlug),
    [pathname, organizationSlug]
  );
  const activeListRef = useMemo(
    () => parseProjectParams(new URLSearchParams(search)).list ?? null,
    [search]
  );
  return (
    <NavProjectsContent
      organizationId={organizationId}
      organizationSlug={organizationSlug}
      iconOnly={iconOnly}
      activeProjectAlias={routeState.activeProjectAlias}
      activeSection={routeState.activeSection}
      activeListRef={activeListRef}
    />
  );
}

interface NavProjectsContentProps extends NavProjectsProps {
  activeProjectAlias: string | null;
  activeSection: ProjectRouteSection;
  activeListRef: string | null;
}

const NavProjectsContent = memo(function NavProjectsContent({
  organizationId,
  organizationSlug,
  iconOnly = false,
  activeProjectAlias,
  activeSection,
  activeListRef,
}: NavProjectsContentProps) {
  const navigation = useNavigation();
  const projectDialog = useDialogWithData<ProjectDialogData>();
  const { open: openProjectDialog } = projectDialog;
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({
    open: false,
    project: null,
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const hasMountedCollapsedProjectIdsRef = useRef(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState(
    loadCollapsedProjectIds
  );

  const allProjects = useQuery(api.projects.core.listByOrganization, {
    organizationId,
  });
  // Archived projects leave the sidebar (docs/specs/project-archive.md).
  const projects = useMemo(() => allProjects?.filter((project) => !project.isArchived), [allProjects]);
  // Project delete is an org permission; the row's project role cannot answer it.
  const orgRole = useQuery(api.organizations.members.getMyRole, { organizationId });
  // An open delete confirmation closes when the org permission goes away mid-session.
  if (deleteDialog.open && !hasOrgPermission(orgRole, OrgPermission.PROJECT_DELETE)) {
    setDeleteDialog({ open: false, project: null });
  }

  // Pinned Lists must not block project rendering: while this query loads,
  // project rows simply render without sub-items.
  const pinnedListEntries = useQuery(api.tasks.lists.listPinnedForOrganization, {
    organizationId,
  });
  const pinnedListsByProject = useMemo(() => {
    const map = new Map<Id<"projects">, PinnedSidebarList[]>();
    for (const entry of pinnedListEntries ?? []) {
      const lists = Array.isArray(entry.lists) ? entry.lists : EMPTY_PINNED_LISTS;
      map.set(entry.projectId, lists);
    }
    return map;
  }, [pinnedListEntries]);

  const deleteProjectMutation = useMutation(api.projects.core.remove);

  const handleCreateProject = useCallback(() => {
    openProjectDialog({});
  }, [openProjectDialog]);

  const handleDeleteProject = useCallback(
    (project: { _id: Id<"projects">; name: string }) => {
      setDeleteDialog({ open: true, project });
    },
    []
  );

  const handleToggleListsCollapsed = useCallback((projectId: Id<"projects">) => {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (projects === undefined) {
      return;
    }

    const projectIds = new Set<string>(projects.map((project) => project._id));
    const prunedProjectIds = new Set(
      [...collapsedProjectIds].filter((projectId) => projectIds.has(projectId))
    );
    if (prunedProjectIds.size !== collapsedProjectIds.size) {
      hasMountedCollapsedProjectIdsRef.current = true;
      setCollapsedProjectIds(prunedProjectIds);
      return;
    }

    if (!hasMountedCollapsedProjectIdsRef.current) {
      hasMountedCollapsedProjectIdsRef.current = true;
      return;
    }

    saveCollapsedProjectIds(collapsedProjectIds);
  }, [collapsedProjectIds, projects]);

  const confirmDelete = useCallback(async () => {
    if (!deleteDialog.project) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteProjectMutation({ id: deleteDialog.project._id });
      setDeleteDialog({ open: false, project: null });
      // Navigate to org page if we deleted the current project
      if (projects && projects.length > 1) {
        const remaining = projects.filter(
          (project) => project._id !== deleteDialog.project?._id
        );
        if (remaining.length > 0) {
          navigation.push(appRoute.project(organizationSlug, remaining[0].alias));
        }
      } else {
        navigation.push(appRoute.organization(organizationSlug));
      }
    } catch (error) {
      showConvexErrorToast(error, "Failed to delete project");
    } finally {
      setIsDeleting(false);
    }
  }, [
    deleteDialog.project,
    deleteProjectMutation,
    navigation,
    organizationSlug,
    projects,
  ]);

  const projectRows = useMemo<ProjectViewModel[]>(() => {
    if (!projects) {
      return [];
    }

    return projects.map((project) => {
      const projectPath = href(appRoute.project(organizationSlug, project.alias));
      const isCurrentProject = activeProjectAlias === project.alias;
      const isChatActive = isCurrentProject && activeSection === "threads";
      const isWatchTowerActive = isCurrentProject && activeSection === "watch-tower";
      const isPullRequestsActive = isCurrentProject && activeSection === "pull-requests";
      const isKanbanActive = isCurrentProject && activeSection === "kanban";
      const isArtifactsActive = isCurrentProject && activeSection === "artifacts";
      const isListActive = isCurrentProject && activeSection === "list";
      const isTaskListSelectionActive = isListActive || isKanbanActive;

      return {
        project,
        projectPath,
        isActive:
          isListActive || isKanbanActive || isChatActive || isArtifactsActive || isWatchTowerActive || isPullRequestsActive,
        isThreadsActive: isChatActive,
        isWatchTowerActive,
        isPullRequestsActive,
        canUseThreads: hasProjectPermission(project.myRole, ProjectPermission.CLI_THREAD),
        myRole: project.myRole,
        pinnedLists: pinnedListsByProject.get(project._id) ?? EMPTY_PINNED_LISTS,
        activeListRef: isTaskListSelectionActive ? activeListRef : null,
        isListViewActive: isTaskListSelectionActive,
        isListsCollapsed: collapsedProjectIds.has(project._id),
      };
    });
  }, [
    activeListRef,
    activeProjectAlias,
    activeSection,
    collapsedProjectIds,
    organizationSlug,
    pinnedListsByProject,
    projects,
  ]);
  // Loading state
  if (projects === undefined) {
    return (
      <NavSection title="Projects">
        <NavItemsSkeleton count={3} />
      </NavSection>
    );
  }

  return (
    <>
      <NavSection
        title="Projects"
        actions={<NavSectionButton onClick={handleCreateProject} Icon={Plus} aria-label="New project" />}
      >
        <SidebarMenu className="flex flex-col gap-[2px]">
          {projects.length === 0 ? (
            <NavItemsEmptyState title="+ New project" onClick={handleCreateProject} />
          ) : (
            projectRows.map((projectRow) => {
              return (
                <ProjectItem
                  key={projectRow.project._id}
                  project={projectRow.project}
                  projectPath={projectRow.projectPath}
                  isActive={projectRow.isActive}
                  isThreadsActive={projectRow.isThreadsActive}
                  isWatchTowerActive={projectRow.isWatchTowerActive}
                  isPullRequestsActive={projectRow.isPullRequestsActive}
                  canUseThreads={projectRow.canUseThreads}
                  myRole={projectRow.myRole}
                  orgRole={orgRole}
                  pinnedLists={projectRow.pinnedLists}
                  activeListRef={projectRow.activeListRef}
                  isListViewActive={projectRow.isListViewActive}
                  isListsCollapsed={projectRow.isListsCollapsed}
                  iconOnly={iconOnly}
                  onDelete={handleDeleteProject}
                  organizationSlug={organizationSlug}
                  onToggleListsCollapsed={handleToggleListsCollapsed}
                />
              );
            })
          )}
        </SidebarMenu>
      </NavSection>

      <ProjectDialog organizationId={organizationId} dialog={projectDialog} />

      <ConfirmDialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, project: null })}
        title="Delete project"
        description={`Are you sure you want to delete "${deleteDialog.project?.name}"? This action cannot be undone.`}
        busy={isDeleting}
        confirm={{
          label: "Delete",
          variant: "destructive",
          onClick: confirmDelete,
          autoCloseOnClick: false,
        }}
        cancel={{
          label: "Cancel",
        }}
      />
    </>
  );
});
