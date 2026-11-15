"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { NavMain } from "@/components/blocks/sidebar/nav-main";
import { NotificationsSubpage } from "@/components/blocks/sidebar/notifications-subpage";
import { NavProjects } from "@/components/blocks/sidebar/nav-projects";
import { NavUser } from "@/components/blocks/sidebar/nav-user";
import { OrganizationSettingsDrawerContent } from "@/components/blocks/organization/settings/organization-settings-drawer-content";
import { MobileDrawerPanel } from "./mobile-drawer-panel";

interface MobileMenuPanelProps {
  organizationId: Id<"organizations">;
  organizationSlug: string;
  onClose: () => void;
}

export function MobileMenuPanel({
  organizationId,
  organizationSlug,
  onClose,
}: MobileMenuPanelProps) {
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [notificationsDrawerOpen, setNotificationsDrawerOpen] = useState(false);

  return (
    <div className="flex h-full flex-col" onClick={(e) => {
      if ((e.target as HTMLElement).closest("a")) {
        onClose();
      }
    }}>
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <NavMain
          organizationId={organizationId}
          organizationSlug={organizationSlug}
          onAddTask={onClose}
          notificationsActive={notificationsDrawerOpen}
          onToggleNotifications={() => setNotificationsDrawerOpen((open) => !open)}
        />
        <MobileDrawerPanel
          open={notificationsDrawerOpen}
          onClose={() => setNotificationsDrawerOpen(false)}
        >
          <NotificationsSubpage
            organizationId={organizationId}
            onBack={() => setNotificationsDrawerOpen(false)}
          />
        </MobileDrawerPanel>
        <NavProjects
          organizationId={organizationId}
          organizationSlug={organizationSlug}
        />
      </div>
      <div className="border-t border-border p-2">
        <div className="mb-2">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent"
            onClick={() => setSettingsDrawerOpen(true)}
            aria-haspopup="dialog"
          >
            <Settings className="size-4 text-sidebar-foreground/70" />
            <span className="flex-1 text-left">Organization settings</span>
          </button>
          <MobileDrawerPanel
            open={settingsDrawerOpen}
            onClose={() => setSettingsDrawerOpen(false)}
            compact
          >
            <OrganizationSettingsDrawerContent
              organizationSlug={organizationSlug}
              onSelect={() => setSettingsDrawerOpen(false)}
            />
          </MobileDrawerPanel>
        </div>
        <NavUser currentOrgId={organizationId} />
      </div>
    </div>
  );
}
