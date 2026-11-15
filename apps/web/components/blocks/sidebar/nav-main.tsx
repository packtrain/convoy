"use client";

import { useQuery } from "convex/react";
import { Bell, BotMessageSquare, Plus, TowerControl } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { hasProjectPermission, ProjectPermission } from "@/lib/authz/permissions";
import { useShowUnfinishedItems } from "@/lib/dev-mode/use-dev-mode";
import { AppLink, appRoute, useNavigationLocation } from "@/lib/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface NavMainProps {
  organizationId: Id<"organizations">;
  organizationSlug: string;
  onAddTask: () => void;
  notificationsActive: boolean;
  notificationsBoundaryId?: string;
  onToggleNotifications: () => void;
}

export function NavMain({
  organizationId,
  organizationSlug,
  onAddTask,
  notificationsActive,
  notificationsBoundaryId,
  onToggleNotifications,
}: NavMainProps) {
  const { pathname } = useNavigationLocation();
  const watchTowerTarget = appRoute.watchTower(organizationSlug);
  const unreadCount = useQuery(api.notifications.core.unreadCount, { organizationId }) ?? 0;
  const showUnfinishedItems = useShowUnfinishedItems();
  // The dialog lists only projects the caller can create in; with none, hide the entry.
  const projects = useQuery(api.projects.core.listByOrganization, { organizationId });
  const canCreateTask = projects?.some((project) =>
    hasProjectPermission(project.myRole, ProjectPermission.TASK_CREATE)
  );
  // Watch Tower lists threads only from projects with threads access.
  const canUseThreads = projects?.some((project) =>
    hasProjectPermission(project.myRole, ProjectPermission.CLI_THREAD)
  );
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {canCreateTask && (
            <SidebarMenuItem>
              <SidebarMenuButton
                className="cursor-pointer font-medium"
                tooltip="Add task"
                onClick={onAddTask}
              >
                <Plus className="size-4" />
                <span>Add task</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {canUseThreads && (
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Watch Tower"
                isActive={pathname === watchTowerTarget.pathname}
              >
                <AppLink href={watchTowerTarget} className="cursor-pointer">
                  <TowerControl className="size-4" />
                  <span>Watch Tower</span>
                </AppLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton
              className="cursor-pointer"
              tooltip="Notifications"
              data-notifications-boundary={notificationsBoundaryId}
              isActive={notificationsActive}
              onClick={onToggleNotifications}
            >
              <Bell className="size-4" />
              <span>Notifications</span>
            </SidebarMenuButton>
            {unreadCount > 0 && (
              <SidebarMenuBadge className="right-2 h-4.5 min-w-4.5 rounded-full bg-destructive px-1 text-[10px] font-medium text-white peer-hover/menu-button:text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
          {showUnfinishedItems && (
            <SidebarMenuItem>
              <SidebarMenuButton
                disabled
                className="opacity-50"
                tooltip="Threads (coming soon)"
              >
                <BotMessageSquare className="size-4" />
                <span>Threads</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
