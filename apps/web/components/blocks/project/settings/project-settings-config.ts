import {
  AlertTriangle,
  Bot,
  Coins,
  Download,
  FileText,
  GitPullRequest,
  List,
  ListChecks,
  Plug,
  Repeat,
  Settings,
  Sliders,
  Sparkles,
  Tag,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  getAvailableDevSettingItemId,
  isDevSettingItemAvailable,
  type DevSettingControlledItem,
} from "@/lib/dev-mode/selection";
import type { DevSettingsSnapshot } from "@/lib/dev-mode/use-dev-mode";
import type { ProjectSettingsSection } from "@/lib/navigation";
import {
  hasOrgPermission,
  hasProjectPermission,
  OrgPermission,
  ProjectPermission,
} from "@/lib/authz/permissions";
import type { OrgRole, ProjectRole } from "@/lib/authz/roles";

// SectionId is the routed project settings section union. It is kept in sync
// with the route-layer ProjectSettingsSection via the assignment below.
export type SectionId = ProjectSettingsSection;

export type CustomizationTabId =
  | "statuses"
  | "task-types"
  | "columns"
  | "filters";

export interface SettingsSectionConfig
  extends DevSettingControlledItem<SectionId> {
  icon: LucideIcon;
  label: string;
  /** Shown under the page title by the settings shell. */
  description?: string;
  destructive?: boolean;
}

export interface CustomizationTabConfig
  extends DevSettingControlledItem<CustomizationTabId> {
  label: string;
}

const PROJECT_SETTINGS_PRIMARY_SECTION_CONFIG: readonly SettingsSectionConfig[] = [
  { id: "general", icon: Settings, label: "General", description: "Basic project information and settings." },
  { id: "members", icon: Users, label: "Members", description: "Manage who has access to this project." },
  {
    id: "agents",
    icon: Bot,
    label: "Agents",
    description: "Manage project-local agents that can later be assigned to tasks.",
  },
  {
    id: "prompts",
    icon: FileText,
    label: "Prompts",
    description: "Reusable prompts you insert in chat with a slash command.",
  },
  {
    id: "skills",
    icon: Sparkles,
    label: "Skills",
    description: "Instruction bundles that agents in this project load on demand.",
  },
  {
    id: "workflows",
    icon: Workflow,
    label: "Workflows",
    description: "Orchestrate multi-step agent runs across stages and lanes.",
  },
  {
    id: "lists",
    icon: List,
    label: "Lists",
    description:
      "Lists group project work into separate backlogs, milestones, or workflows so teams can organize tasks by context.",
  },
  {
    id: "labels",
    icon: Tag,
    label: "Labels",
    description:
      "Each task can have one label. Label order defines the Board column order when grouping by label.",
  },
  {
    id: "checks",
    icon: ListChecks,
    label: "Checks",
    description: "Checks are claims agents prove with evidence. A checklist groups them and can be a task type's default.",
  },
  {
    id: "customization",
    icon: Sliders,
    label: "Customization",
    description: "Customize statuses, task types, columns, and filters.",
  },
  {
    id: "templates",
    icon: FileText,
    label: "Templates",
    description: "Create reusable task templates with predefined subtasks.",
    devSettingId: "extraProjectSettings",
  },
  {
    id: "recurring",
    icon: Repeat,
    label: "Recurring tasks",
    description: "Create tasks that repeat on a schedule.",
    devSettingId: "extraProjectSettings",
  },
  {
    id: "automations",
    icon: Zap,
    label: "Automations",
    description: "Automate task status changes and archiving.",
    devSettingId: "extraProjectSettings",
  },
  {
    id: "pull-requests",
    icon: GitPullRequest,
    label: "Pull requests",
    description: "How Convoy checks pull requests and writes their Guides.",
    devSettingId: "githubIntegration",
  },
  {
    id: "integrations",
    icon: Plug,
    label: "Integrations",
    description: "Connect the tools your project works with.",
    devSettingId: "githubIntegration",
  },
  {
    id: "import-export",
    icon: Download,
    label: "Import & export",
    description: "Import tasks from other tools or export your data.",
    devSettingId: "extraProjectSettings",
  },
  {
    id: "usage",
    icon: Coins,
    label: "Usage",
    description: "Agent token spend recorded from CLI threads.",
  },
];

const PROJECT_SETTINGS_DANGER_SECTION_CONFIG = {
  id: "danger",
  icon: AlertTriangle,
  label: "Danger zone",
  description: "Actions that cannot be undone.",
  destructive: true,
} satisfies SettingsSectionConfig;

export const PROJECT_SETTINGS_SECTION_CONFIG: readonly SettingsSectionConfig[] = [
  ...PROJECT_SETTINGS_PRIMARY_SECTION_CONFIG,
  PROJECT_SETTINGS_DANGER_SECTION_CONFIG,
];

export const PROJECT_SETTINGS_SECTION_LABELS = Object.fromEntries(
  PROJECT_SETTINGS_SECTION_CONFIG.map((section) => [section.id, section.label])
) as Record<SectionId, string>;

export const PROJECT_SETTINGS_SECTION_DESCRIPTIONS = Object.fromEntries(
  PROJECT_SETTINGS_SECTION_CONFIG.map((section) => [section.id, section.description])
) as Record<SectionId, string | undefined>;

export const PROJECT_SETTINGS_NAV_ITEM_CONFIG: readonly SettingsSectionConfig[] =
  PROJECT_SETTINGS_SECTION_CONFIG;

export const PROJECT_SETTINGS_CUSTOMIZATION_TAB_CONFIG: readonly CustomizationTabConfig[] =
  [
    { id: "statuses", label: "Statuses" },
    { id: "task-types", label: "Task types" },
    { id: "columns", label: "Columns" },
    {
      id: "filters",
      label: "Filters",
      devSettingId: "extraProjectSettings",
    },
  ];

export function isCustomizationTabId(
  value: string
): value is CustomizationTabId {
  return PROJECT_SETTINGS_CUSTOMIZATION_TAB_CONFIG.some(
    (tab) => tab.id === value
  );
}

export function isSectionAvailable(
  section: SettingsSectionConfig,
  devSettings: DevSettingsSnapshot
): boolean {
  return isDevSettingItemAvailable(section, devSettings);
}

// Sections with nothing to read without these are hidden and their routes
// blocked (docs/specs/read-only-viewer-ux.md#settings-sidebar-and-mobile-chrome-slice-6-os-1546).
const SECTION_PERMISSIONS: Partial<Record<SectionId, ProjectPermission>> = {
  agents: ProjectPermission.AGENTS_MANAGE,
  prompts: ProjectPermission.SLASH_COMMANDS_MANAGE,
  skills: ProjectPermission.SKILLS_MANAGE,
  workflows: ProjectPermission.TASK_UPDATE,
  lists: ProjectPermission.LIST_MANAGE,
};

/** False while either role loads, so a gated section never flashes in. */
export function isSectionPermitted(
  id: SectionId,
  projectRole: ProjectRole | null | undefined,
  orgRole: OrgRole | null | undefined
): boolean {
  // Project delete is an org permission (`requireOrgPermission` in convex/projects/core.ts).
  if (id === "danger") {
    return hasOrgPermission(orgRole, OrgPermission.PROJECT_DELETE);
  }
  const permission = SECTION_PERMISSIONS[id];
  return !permission || hasProjectPermission(projectRole, permission);
}

export function resolveAvailableSectionId(
  requestedId: SectionId,
  devSettings: DevSettingsSnapshot
): SectionId {
  return getAvailableDevSettingItemId(
    PROJECT_SETTINGS_SECTION_CONFIG,
    requestedId,
    devSettings,
    "general"
  );
}

export function isCustomizationTabAvailable(
  tab: CustomizationTabConfig,
  devSettings: DevSettingsSnapshot
): boolean {
  return isDevSettingItemAvailable(tab, devSettings);
}

export function resolveAvailableCustomizationTabId(
  requestedId: CustomizationTabId,
  devSettings: DevSettingsSnapshot
): CustomizationTabId {
  return getAvailableDevSettingItemId(
    PROJECT_SETTINGS_CUSTOMIZATION_TAB_CONFIG,
    requestedId,
    devSettings,
    "statuses"
  );
}
