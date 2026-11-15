"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  BotMessageSquare,
  ListChecks,
  Menu,
  Plus,
  Search,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { hasProjectPermission, ProjectPermission } from "@/lib/authz/permissions";
import type { ProjectRole } from "@/lib/authz/roles";
import {
  AppLink,
  appRoute,
  href,
  isNewThreadComposerTarget,
  projectEntryTarget,
  routeTarget,
  useNavigation,
  useRouteParams,
  withProjectTaskAndArchive,
  type RouteTarget,
} from "@/lib/navigation";
import { getLastProjectAlias } from "@/lib/routing/last-project-storage";
import type { ArchiveFilter } from "@/lib/tasks/types";
import type {
  TaskSearchHrefBuilder,
  TaskSearchSelectHandler,
} from "@/lib/tasks/task-selector";
import {
  MOBILE_NAV_BAR_BOTTOM_PADDING,
  MOBILE_NAV_BAR_HEIGHT,
} from "@/lib/mobile/constants";
import { NEW_THREAD_QUERY_PARAM } from "@/lib/threads/constants";
import { MobileDrawerPanel } from "./mobile-drawer-panel";
import { useMobileNavBarState } from "./mobile-nav-context";
import { MobileMenuPanel } from "./mobile-menu-panel";
import { MobileSearchPanel } from "./mobile-search-panel";
import { MobileCreateTaskPanel } from "./mobile-create-task-panel";

type PanelId = "menu" | "search" | "create";

interface MobileNavBarProps {
  organizationId: Id<"organizations">;
  organizationSlug: string;
}

function stripTrailingSlash(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/**
 * The global mobile bottom nav bar (spec: docs/specs/mobile-bottom-nav.md).
 * Five fixed slots on every page: Tasks, Threads, create (+), Search, Menu.
 * Mounted once in the organization layout; route-aware instead of composed
 * per page so every slot keeps the same meaning everywhere.
 */
export function MobileNavBar({
  organizationId,
  organizationSlug,
}: MobileNavBarProps) {
  const navigation = useNavigation();
  const routeParams = useRouteParams<{
    projectAlias?: string;
    threadId?: string;
  }>();
  const { hiddenCount, pageConfig } = useMobileNavBarState();
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);

  // Mirrors useOrganizationBackTarget: outside a project, the Tasks/Threads
  // tabs target the remembered last project so the bar works on org-level
  // pages (settings, watch-tower) too.
  const [lastProjectAlias, setLastProjectAlias] = useState<string | null>(() =>
    getLastProjectAlias(organizationSlug)
  );
  useEffect(() => {
    setLastProjectAlias(getLastProjectAlias(organizationSlug));
  }, [organizationSlug]);

  // Already subscribed by the sidebar's project list, so Convex dedupes this.
  const projects = useQuery(api.projects.core.listByOrganization, {
    organizationId,
  });

  const routeProjectAlias = routeParams.projectAlias ?? null;
  const navProject = useMemo(() => {
    const aliasCandidates = [routeProjectAlias, lastProjectAlias];
    for (const alias of aliasCandidates) {
      if (!alias) continue;
      const match = projects?.find((project) => project.alias === alias);
      if (match) return match;
    }
    return null;
  }, [lastProjectAlias, projects, routeProjectAlias]);
  const navAlias = navProject?.alias ?? routeProjectAlias ?? lastProjectAlias;

  const pathname = stripTrailingSlash(navigation.location.pathname);
  const projectRootPath = navAlias
    ? href(appRoute.project(organizationSlug, navAlias))
    : null;
  const inThreadsArea = Boolean(
    routeProjectAlias &&
      pathname.startsWith(href(appRoute.projectThreads(organizationSlug, routeProjectAlias)))
  );
  const isTaskViewsActive = Boolean(
    routeProjectAlias &&
      (pathname === href(appRoute.project(organizationSlug, routeProjectAlias)) ||
        pathname === href(appRoute.projectBoard(organizationSlug, routeProjectAlias)))
  );
  // The + slot is hidden where it would only fail: in the resolved project
  // without the right permission, or outside one with no creatable project.
  const canCreateTask = (project: { myRole: ProjectRole }) =>
    hasProjectPermission(project.myRole, ProjectPermission.TASK_CREATE);
  const canUseThreads = (project: { myRole: ProjectRole }) =>
    hasProjectPermission(project.myRole, ProjectPermission.CLI_THREAD);
  const showPlus = navProject
    ? inThreadsArea
      ? canUseThreads(navProject)
      : canCreateTask(navProject)
    : Boolean(projects?.some(canCreateTask));
  // The Threads tab follows the same rule: viewers have no threads area.
  const showThreadsTab = navProject
    ? canUseThreads(navProject)
    : Boolean(projects?.some(canUseThreads));
  const isNewThreadOpen =
    inThreadsArea && !routeParams.threadId && isNewThreadComposerTarget(navigation.location.search);

  // Fixed slot targets. Without any resolvable project both tabs fall back to
  // the org root (project picker).
  const tasksTarget: RouteTarget = navProject
    ? projectEntryTarget(
        href(appRoute.project(organizationSlug, navProject.alias)),
        navProject,
        // No `list` param means the project default List, so its own override
        // wins over the project default (OS-1566).
        { list: navProject.defaultListView ?? null }
      )
    : navAlias
      ? appRoute.project(organizationSlug, navAlias)
      : appRoute.organization(organizationSlug);
  const threadsTarget: RouteTarget = navAlias
    ? appRoute.projectThreads(organizationSlug, navAlias)
    : appRoute.organization(organizationSlug);

  const closePanel = useCallback(() => {
    setActivePanel((current) => {
      if (current === null) return null;
      history.replaceState({ ...history.state, mobilePanel: undefined }, "");
      return null;
    });
  }, []);

  const togglePanel = useCallback((panel: PanelId) => {
    setActivePanel((current) => {
      if (current === panel) {
        history.replaceState({ ...history.state, mobilePanel: undefined }, "");
        return null;
      }
      if (current !== null) {
        history.replaceState({ ...history.state, mobilePanel: panel }, "");
      } else {
        history.pushState({ ...history.state, mobilePanel: panel }, "");
      }
      return panel;
    });
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setActivePanel(null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (activePanel) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [activePanel]);

  // The + slot always creates the main object of the current page: a thread in
  // the threads area, a task everywhere else.
  const handlePlusClick = useCallback(() => {
    if (inThreadsArea && navAlias) {
      closePanel();
      navigation.push(
        routeTarget(appRoute.projectThreads(organizationSlug, navAlias).pathname, {
          query: new URLSearchParams({ [NEW_THREAD_QUERY_PARAM]: "1" }),
        })
      );
      return;
    }

    togglePanel("create");
  }, [closePanel, inThreadsArea, navAlias, navigation, organizationSlug, togglePanel]);

  // Default task-search navigation for pages without richer view state: land
  // on the project task view with the task (and archive/list context) opened.
  const defaultSearchTaskTarget = useCallback(
    (taskRefId: string, archiveFilter: ArchiveFilter, listRef: string | null) =>
      withProjectTaskAndArchive(
        projectRootPath ?? href(appRoute.organization(organizationSlug)),
        {},
        taskRefId,
        archiveFilter === "archived",
        listRef
      ),
    [organizationSlug, projectRootPath]
  );
  const searchOverride = pageConfig?.search;
  const handleSearchTaskSelect = useCallback<TaskSearchSelectHandler>(
    (taskRefId, archiveFilter, listRef) => {
      if (searchOverride) {
        searchOverride.onSelectTask(taskRefId, archiveFilter, listRef);
        return;
      }
      navigation.push(defaultSearchTaskTarget(taskRefId, archiveFilter, listRef));
    },
    [defaultSearchTaskTarget, navigation, searchOverride]
  );
  const getSearchTaskHref = useCallback<TaskSearchHrefBuilder>(
    (taskRefId, archiveFilter, listRef) => {
      if (searchOverride) {
        return searchOverride.getTaskHref(taskRefId, archiveFilter, listRef);
      }
      return href(defaultSearchTaskTarget(taskRefId, archiveFilter, listRef));
    },
    [defaultSearchTaskTarget, searchOverride]
  );

  // Hidden inside thread conversations (full-screen push, composer flush at
  // the bottom) and under full-screen detail surfaces reporting via context.
  if (routeParams.threadId || isNewThreadOpen || hiddenCount > 0) {
    return null;
  }

  const isSearchOpen = activePanel === "search";
  const tabClassName = (active: boolean) =>
    cn(
      "flex size-10 shrink-0 items-center justify-center rounded-xl active:bg-muted/50",
      active ? "text-foreground" : "text-muted-foreground"
    );

  return (
    <div className="md:hidden">
      {/* Menu panel */}
      <MobileDrawerPanel open={activePanel === "menu"} onClose={closePanel}>
        <MobileMenuPanel
          organizationId={organizationId}
          organizationSlug={organizationSlug}
          onClose={closePanel}
        />
      </MobileDrawerPanel>

      {/* Create-task panel (compact - content-sized) */}
      <MobileDrawerPanel
        open={activePanel === "create"}
        onClose={closePanel}
        compact
      >
        <MobileCreateTaskPanel
          open={activePanel === "create"}
          organizationId={organizationId}
          organizationSlug={organizationSlug}
          activeProjectAlias={routeProjectAlias ?? navAlias ?? ""}
          activeListRef={pageConfig?.createTaskListRef ?? null}
          onClose={closePanel}
        />
      </MobileDrawerPanel>

      {/* Search panel */}
      <MobileDrawerPanel open={isSearchOpen} onClose={closePanel} flush>
        <MobileSearchPanel
          projectId={navProject?._id}
          onSelectTask={handleSearchTaskSelect}
          getTaskHref={getSearchTaskHref}
          onClose={closePanel}
        />
      </MobileDrawerPanel>

      {/* Floating nav bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-55 flex justify-center transition-transform duration-200 md:hidden"
        style={{ paddingBottom: MOBILE_NAV_BAR_BOTTOM_PADDING }}
      >
        <div
          className="mx-3 flex items-center gap-2 rounded-2xl border border-border/50 bg-background/10 px-2.5 shadow-lg backdrop-blur-sm"
          style={{ height: MOBILE_NAV_BAR_HEIGHT }}
        >
          {/* Tasks tab */}
          <AppLink
            href={href(tasksTarget)}
            aria-label="Tasks"
            aria-current={isTaskViewsActive ? "page" : undefined}
            onClick={closePanel}
            className={tabClassName(isTaskViewsActive && !activePanel)}
          >
            <ListChecks className="size-5" />
          </AppLink>

          {/* Threads tab */}
          {showThreadsTab && (
            <AppLink
              href={href(threadsTarget)}
              aria-label="Threads"
              aria-current={inThreadsArea ? "page" : undefined}
              onClick={closePanel}
              className={tabClassName(inThreadsArea && !activePanel)}
            >
              <BotMessageSquare className="size-5" />
            </AppLink>
          )}

          {/* Create */}
          {showPlus && (
            <button
              aria-label={
                activePanel === "create"
                  ? "Close create"
                  : inThreadsArea
                    ? "New thread"
                    : "Create task"
              }
              onClick={handlePlusClick}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full active:opacity-80",
                activePanel === "create"
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground"
              )}
            >
              {activePanel === "create" ? (
                <X className="size-4.5" />
              ) : (
                <Plus className="size-4.5" />
              )}
            </button>
          )}

          {/* Search */}
          <button
            aria-label={isSearchOpen ? "Close search" : "Open search"}
            onClick={() => togglePanel("search")}
            className={tabClassName(isSearchOpen)}
          >
            {isSearchOpen ? (
              <X className="size-5" />
            ) : (
              <Search className="size-5" />
            )}
          </button>

          {/* Menu */}
          <button
            aria-label={activePanel === "menu" ? "Close menu" : "Open menu"}
            onClick={() => togglePanel("menu")}
            className={tabClassName(activePanel === "menu")}
          >
            {activePanel === "menu" ? (
              <X className="size-5" />
            ) : (
              <Menu className="size-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
