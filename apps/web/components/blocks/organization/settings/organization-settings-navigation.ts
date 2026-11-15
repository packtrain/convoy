import {
  Bot,
  ClipboardList,
  FolderKanban,
  LayoutTemplate,
  MessageSquareText,
  Settings,
  Sparkles,
  UserRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { SubpageNavigationItem } from "@/components/custom/subpage-navigation";
import {
  appRoute,
  ORGANIZATION_SETTINGS_SECTION_LABELS,
  type OrganizationSettingsSection,
} from "@/lib/navigation";
import type { DevSettingsSnapshot } from "@/lib/dev-mode/use-dev-mode";

interface FutureOrganizationSettingsItem {
  id: string;
  label: string;
  icon: LucideIcon;
  disabled: true;
}

const FUTURE_ORGANIZATION_SETTINGS_ITEMS: FutureOrganizationSettingsItem[] = [
  {
    id: "workflows",
    label: "Workflows",
    icon: Workflow,
    disabled: true,
  },
  {
    id: "task-templates",
    label: "Task templates",
    icon: ClipboardList,
    disabled: true,
  },
  {
    id: "project-templates",
    label: "Project templates",
    icon: LayoutTemplate,
    disabled: true,
  },
];

export function getOrganizationSettingsNavItems(
  organizationSlug: string,
  activeSection: OrganizationSettingsSection | null,
  devSettings: DevSettingsSnapshot
): SubpageNavigationItem[] {
  return [
    {
      id: "general",
      label: ORGANIZATION_SETTINGS_SECTION_LABELS.general,
      icon: Settings,
      href: appRoute.organizationSettings(organizationSlug, "general"),
      isActive: activeSection === "general",
    },
    {
      id: "members",
      label: ORGANIZATION_SETTINGS_SECTION_LABELS.members,
      icon: UserRound,
      href: appRoute.organizationSettings(organizationSlug, "members"),
      isActive: activeSection === "members",
    },
    {
      id: "projects",
      label: ORGANIZATION_SETTINGS_SECTION_LABELS.projects,
      icon: FolderKanban,
      href: appRoute.organizationSettings(organizationSlug, "projects"),
      isActive: activeSection === "projects",
    },
    {
      id: "prompts",
      label: ORGANIZATION_SETTINGS_SECTION_LABELS.prompts,
      icon: MessageSquareText,
      href: appRoute.organizationSettings(organizationSlug, "prompts"),
      isActive: activeSection === "prompts",
    },
    {
      id: "agents",
      label: ORGANIZATION_SETTINGS_SECTION_LABELS.agents,
      icon: Bot,
      href: appRoute.organizationSettings(organizationSlug, "agents"),
      isActive: activeSection === "agents",
    },
    {
      id: "skills",
      label: ORGANIZATION_SETTINGS_SECTION_LABELS.skills,
      icon: Sparkles,
      href: appRoute.organizationSettings(organizationSlug, "skills"),
      isActive: activeSection === "skills",
    },
    ...(devSettings.showUnfinishedItems
      ? FUTURE_ORGANIZATION_SETTINGS_ITEMS.map((item) => ({
          ...item,
          isActive: false,
        }))
      : []),
  ];
}
