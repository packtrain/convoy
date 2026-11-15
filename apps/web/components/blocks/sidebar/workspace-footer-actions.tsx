"use client";

import { Settings } from "lucide-react";
import { AppLink, appRoute } from "@/lib/navigation";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

interface WorkspaceFooterActionsProps {
  organizationSlug: string;
  settingsActive?: boolean;
}

export function WorkspaceFooterActions({
  organizationSlug,
  settingsActive = false,
}: WorkspaceFooterActionsProps) {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      {!isMobile ? (
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            size="sm"
            tooltip="Organization settings"
            isActive={settingsActive}
            className="cursor-pointer"
          >
            <AppLink href={appRoute.organizationSettings(organizationSlug, "general")}>
              <Settings className="size-4" />
              <span>Organization settings</span>
            </AppLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  );
}
