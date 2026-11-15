"use client";

import {
  Bot,
  FileText,
  List,
  MoreHorizontal,
  Plug,
  Settings,
  Sparkles,
  Trash2,
  UserPlus,
  Workflow,
  Archive,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuAction, useSidebar } from "@/components/ui/sidebar";
import {
  AppLink,
  appRoute,
  href,
  type ProjectSettingsSection,
} from "@/lib/navigation";
import { useDevSettings, useShowUnfinishedItems } from "@/lib/dev-mode/use-dev-mode";
import {
  hasOrgPermission,
  hasProjectPermission,
  OrgPermission,
  ProjectPermission,
} from "@/lib/authz/permissions";
import type { OrgRole, ProjectRole } from "@/lib/authz/roles";
import {
  isSectionPermitted,
  resolveAvailableSectionId,
} from "@/components/blocks/project/settings/project-settings-config";

// Labels and icons differ from the settings nav catalog for the first two
// (`Settings`, `Add members`), so the menu keeps its own list.
// See docs/specs/project-sidebar-actions.md.
const SECTION_ACTIONS: readonly {
  section: ProjectSettingsSection;
  icon: LucideIcon;
  label: string;
  /** Replaces the section's own gate: these shortcuts are for managing, not reading. */
  permission?: ProjectPermission;
}[] = [
  { section: "general", icon: Settings, label: "Settings" },
  { section: "members", icon: UserPlus, label: "Add members", permission: ProjectPermission.PROJECT_MEMBERS_ADD },
  { section: "agents", icon: Bot, label: "Agents" },
  { section: "prompts", icon: FileText, label: "Prompts" },
  { section: "skills", icon: Sparkles, label: "Skills" },
  { section: "workflows", icon: Workflow, label: "Workflows" },
  { section: "integrations", icon: Plug, label: "Integrations", permission: ProjectPermission.PROJECT_UPDATE },
  { section: "lists", icon: List, label: "Lists" },
];

interface ProjectActionsDropdownProps {
  organizationSlug: string;
  projectAlias: string;
  myRole: ProjectRole | null | undefined;
  orgRole: OrgRole | null | undefined;
  onDelete: () => void;
}

export function ProjectActionsDropdown({
  organizationSlug,
  projectAlias,
  myRole,
  orgRole,
  onDelete,
}: ProjectActionsDropdownProps) {
  const { isMobile } = useSidebar();
  const showUnfinishedItems = useShowUnfinishedItems();
  const devSettings = useDevSettings();
  const actions = SECTION_ACTIONS.filter(
    ({ section, permission }) =>
      resolveAvailableSectionId(section, devSettings) === section &&
      (permission ? hasProjectPermission(myRole, permission) : isSectionPermitted(section, myRole, orgRole))
  );
  const canDelete = hasOrgPermission(orgRole, OrgPermission.PROJECT_DELETE);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction showOnHover className="mr-1">
          <MoreHorizontal />
          <span className="sr-only">More</span>
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48 rounded-lg"
        side={isMobile ? "bottom" : "right"}
        align={isMobile ? "end" : "start"}
      >
        {/* Links, not handlers, so middle-click/cmd-click open a new tab natively. */}
        {actions.map(({ section, icon: Icon, label }) => (
          <DropdownMenuItem key={section} asChild className="cursor-pointer">
            <AppLink
              href={href(
                appRoute.projectSettings(organizationSlug, projectAlias, section)
              )}
            >
              <Icon className="text-muted-foreground" />
              <span>{label}</span>
            </AppLink>
          </DropdownMenuItem>
        ))}
        {showUnfinishedItems && (
          <DropdownMenuItem disabled>
            <Archive className="text-muted-foreground" />
            <span>Archive</span>
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onDelete}
            >
              <Trash2 />
              <span>Delete</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
