"use client"

import * as React from "react"
import Image from "next/image"
import { X } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel";

import { NavMain } from "./nav-main"
import { NavProjects } from "./nav-projects"
import { NavUser } from "./nav-user"
import { KeyboardShortcutsButton } from "./keyboard-shortcuts-dialog"
import { SidebarBrand } from "./sidebar-brand"
import { WorkspaceFooterActions } from "./workspace-footer-actions"
import { SidebarSplitLayout, SidebarSubpage } from "./sidebar-subpage"
import { NotificationsSubpage } from "./notifications-subpage"
import { useGoToHotkeys } from "./use-go-to-hotkeys"
import {
  deriveOrganizationSettingsSidebarState,
  deriveProjectSettingsSidebarState,
} from "./app-sidebar-route-state"
import { useCreateTaskDialog } from "@/components/blocks/tasks/create-task-dialog-context";
import { getOrganizationSettingsNavItems } from "@/components/blocks/organization/settings/organization-settings-navigation"
import { getProjectSettingsNavItems } from "@/components/blocks/project/settings/project-settings-navigation"
import { useProjectSettingsAccess } from "@/components/blocks/project/settings/use-project-settings-access"
import { appRoute, useNavigation, useNavigationLocation, useRouteParams, type OrganizationSettingsSection, type ProjectSettingsSection } from "@/lib/navigation"
import { getLastProjectAlias } from "@/lib/routing/last-project-storage"
import { useDevSettings } from "@/lib/dev-mode/use-dev-mode"
import { useOrganizationBackTarget } from "@/lib/routing/use-organization-back-target"
import { cn } from "@/lib/utils"
import { getEnvironmentConfig } from "@/lib/environment/config"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar"

interface AppSidebarProps extends React.ComponentPropsWithoutRef<typeof Sidebar> {
  organizationId: Id<"organizations">;
  organizationSlug: string;
}

const envConfig = getEnvironmentConfig();

export const AppSidebar = React.memo(function AppSidebar({
  organizationId,
  organizationSlug,
  className,
  onClick,
  ...props
}: AppSidebarProps) {
  const { openCreateTaskDialog } = useCreateTaskDialog();
  const { isMobile, state, toggleSidebar } = useSidebar();
  const { pathname, search } = useNavigationLocation();
  const notificationsBoundaryId = React.useId();
  const [dismissedSettingsPathname, setDismissedSettingsPathname] =
    React.useState<string | null>(null);
  // State-driven (unlike the route-driven settings subpages): the inbox opens
  // over any page and closing it leaves the main content untouched.
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const navigation = useNavigation();
  const { projectAlias } = useRouteParams<{ projectAlias?: string }>();
  useGoToHotkeys({
    inbox: () => setNotificationsOpen(true),
    watchTower: () => navigation.push(appRoute.watchTower(organizationSlug)),
    threads: () => {
      // Threads are per project: the current one, else the last one visited.
      const alias = projectAlias ?? getLastProjectAlias(organizationSlug);
      if (alias) navigation.push(appRoute.projectThreads(organizationSlug, alias));
    },
    settings: () => navigation.push(appRoute.organizationSettings(organizationSlug, "general")),
  });
  const organizationSettingsState = deriveOrganizationSettingsSidebarState(
    pathname,
    organizationSlug
  );
  const projectSettingsState = deriveProjectSettingsSidebarState(
    pathname,
    organizationSlug
  );
  const settingsSection = organizationSettingsState.section;
  const projectSettingsSection = projectSettingsState.section;
  const notDismissed = dismissedSettingsPathname !== pathname;
  const showSettingsSubpage =
    !isMobile && settingsSection !== null && notDismissed;
  const showProjectSettingsSubpage =
    !isMobile && projectSettingsSection !== null && notDismissed;
  const showAnySettingsSubpage =
    showSettingsSubpage || showProjectSettingsSubpage;
  // Notifications win over a settings subpage: opening the inbox is an
  // explicit action, and closing it restores whatever the route implies.
  const showNotificationsSubpage = !isMobile && notificationsOpen;
  const showAnySubpage = showNotificationsSubpage || showAnySettingsSubpage;

  React.useEffect(() => {
    setDismissedSettingsPathname(null);
  }, [pathname]);

  React.useEffect(() => {
    setNotificationsOpen(false);
  }, [pathname, search]);

  React.useEffect(() => {
    if (!showNotificationsSubpage) return;
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    const dismissOutside = (event: MouseEvent) => {
      const inside = event.composedPath().some(
        (target) =>
          target instanceof Element &&
          target.getAttribute("data-notifications-boundary") === notificationsBoundaryId
      );
      if (inside) return;
      // Capture survives stopped propagation; defer until the control activates.
      clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => setNotificationsOpen(false), 0);
    };
    document.addEventListener("click", dismissOutside, true);
    return () => {
      clearTimeout(dismissTimer);
      document.removeEventListener("click", dismissOutside, true);
    };
  }, [showNotificationsSubpage, notificationsBoundaryId]);

  const handleSidebarClick = (event: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (showAnySubpage) return;
    if (isMobile || state !== "collapsed") return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("button, a, input, textarea, select, [role='button']")) return;

    toggleSidebar();
  };

  return (
    <Sidebar
      collapsible="icon"
      forceExpanded={showAnySubpage}
      className={cn(
        "group-data-[collapsible=icon]:cursor-e-resize",
        // Snappier width transition than the ui default (200ms felt sluggish
        // when the notifications panel grows the sidebar to 21rem).
        "duration-100",
        // z-30 keeps the overlay strip above sticky page headers (z-10).
        showNotificationsSubpage && "z-30",
        className
      )}
      onClick={handleSidebarClick}
      // Inbox rows need more room than settings nav items. The override only
      // reaches the fixed container (not the layout gap), so the extra width
      // overlays the page content instead of shifting it — Notion-style.
      style={
        showNotificationsSubpage
          ? ({ "--sidebar-width": "21rem" } as React.CSSProperties)
          : undefined
      }
      {...props}
    >
      {isMobile && notificationsOpen ? (
        // Mobile has no rail: the inbox takes over the whole sheet.
        <NotificationsSubpage organizationId={organizationId} onBack={() => setNotificationsOpen(false)} />
      ) : (
        <SidebarSplitLayout
          split={showAnySubpage}
          rail={
            <AppSidebarMain
              organizationId={organizationId}
              organizationSlug={organizationSlug}
              onAddTask={openCreateTaskDialog}
              settingsActive={showSettingsSubpage}
              notificationsActive={notificationsOpen}
              notificationsBoundaryId={notificationsBoundaryId}
              onToggleNotifications={() => setNotificationsOpen((open) => !open)}
              railMode={showAnySubpage}
            />
          }
          subpage={
            showNotificationsSubpage ? (
              <div
                data-notifications-boundary={notificationsBoundaryId}
                className="flex min-h-0 flex-1 flex-col"
              >
                <NotificationsSubpage
                  organizationId={organizationId}
                  onBack={() => setNotificationsOpen(false)}
                  dismissalBoundaryId={notificationsBoundaryId}
                />
              </div>
            ) : showProjectSettingsSubpage &&
              projectSettingsSection !== null &&
              projectSettingsState.projectAlias !== null ? (
              <ProjectSettingsSubpage
                organizationSlug={organizationSlug}
                projectAlias={projectSettingsState.projectAlias}
                activeSection={projectSettingsSection}
                onBack={() => setDismissedSettingsPathname(pathname)}
              />
            ) : showSettingsSubpage ? (
              <OrganizationSettingsSubpage
                organizationSlug={organizationSlug}
                activeSection={settingsSection!}
                onBack={() => setDismissedSettingsPathname(pathname)}
              />
            ) : null
          }
        />
      )}
      {!showAnySubpage && !(isMobile && notificationsOpen) && <SidebarRail />}
    </Sidebar>
  )
})

function AppSidebarMain({
  organizationId,
  organizationSlug,
  onAddTask,
  settingsActive,
  notificationsActive,
  notificationsBoundaryId,
  onToggleNotifications,
  railMode = false,
}: {
  organizationId: Id<"organizations">;
  organizationSlug: string;
  onAddTask: () => void;
  settingsActive: boolean;
  notificationsActive: boolean;
  notificationsBoundaryId: string;
  onToggleNotifications: () => void;
  railMode?: boolean;
}) {
  return (
    <>
      <SidebarHeader className="gap-3 py-3.5 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-2 group-data-[collapsible=icon]:px-2">
        {railMode ? <SidebarStaticBrand /> : <SidebarBrand />}
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          organizationId={organizationId}
          organizationSlug={organizationSlug}
          onAddTask={onAddTask}
          notificationsActive={notificationsActive}
          notificationsBoundaryId={notificationsBoundaryId}
          onToggleNotifications={onToggleNotifications}
        />
        <NavProjects
          organizationId={organizationId}
          organizationSlug={organizationSlug}
          iconOnly={railMode}
        />
      </SidebarContent>
      <SidebarFooter>
        <EnvironmentNotice />
        <WorkspaceFooterActions
          organizationSlug={organizationSlug}
          settingsActive={settingsActive}
        />
        <SidebarSeparator
          className="my-0"
          style={{ width: "calc(100% - 1rem)" }}
        />
        <KeyboardShortcutsButton organizationId={organizationId} />
        <NavUser currentOrgId={organizationId} />
      </SidebarFooter>
    </>
  );
}

function SidebarStaticBrand() {
  return (
    <div className="flex h-7 w-full items-center justify-center">
      <Image
        src="/apple-icon.png"
        alt=""
        aria-hidden="true"
        width={180}
        height={180}
        className="size-6 rounded-md"
        priority
      />
    </div>
  );
}

function OrganizationSettingsSubpage({
  organizationSlug,
  activeSection,
  onBack,
}: {
  organizationSlug: string;
  activeSection: OrganizationSettingsSection;
  onBack: () => void;
}) {
  const backTarget = useOrganizationBackTarget(organizationSlug);
  const devSettings = useDevSettings();

  return (
    <SidebarSubpage
      title="Settings"
      backHref={backTarget}
      onBackClick={onBack}
      items={getOrganizationSettingsNavItems(
        organizationSlug,
        activeSection,
        devSettings
      )}
    />
  );
}

function ProjectSettingsSubpage({
  organizationSlug,
  projectAlias,
  activeSection,
  onBack,
}: {
  organizationSlug: string;
  projectAlias: string;
  activeSection: ProjectSettingsSection;
  onBack: () => void;
}) {
  const devSettings = useDevSettings();
  const { canOpenSection } = useProjectSettingsAccess(organizationSlug, projectAlias);

  return (
    <SidebarSubpage
      title="Project settings"
      backHref={appRoute.project(organizationSlug, projectAlias)}
      onBackClick={onBack}
      items={getProjectSettingsNavItems({
        organizationSlug,
        projectAlias,
        activeSection,
        devSettings,
        canOpenSection,
      })}
    />
  );
}

function EnvironmentNotice() {
  const [dismissed, setDismissed] = React.useState(false);

  if (!envConfig.showCard || dismissed) {
    return null;
  }

  return (
    <div className="px-2 pb-1 group-data-[collapsible=icon]:hidden">
      <div
        className={cn(
          "relative min-h-24 rounded-lg border-0 p-3 pr-9 shadow-none",
          envConfig.cardClassName
        )}
      >
        <div className="min-w-0 space-y-1">
          <p className={cn("truncate text-sm font-semibold", envConfig.titleClassName)}>
            {envConfig.label}
          </p>
          <p className={cn("text-xs leading-5", envConfig.descriptionClassName)}>
            {envConfig.description}
          </p>
        </div>
        <button
          type="button"
          aria-label="Dismiss environment notice"
          className="absolute right-2 top-2 inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setDismissed(true)}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
