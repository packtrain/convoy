"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  CheckCircle,
  Circle,
  Download,
  FileText,
  Import,
  Loader,
  Plus,
  Repeat,
  Sliders,
  Trash2,
  XCircle,
  Lock,
} from "lucide-react";
import { showConvexErrorToast } from "@/lib/errors";

import { EmptyState } from "@/components/custom/empty-state";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATUS_CONFIG } from "@/lib/tasks/constants";
import { Status } from "@/lib/tasks/status";
import {
  ALL_TASK_STATUSES,
  getDisabledTaskStatuses,
  isProjectStatusRequired,
} from "@/lib/tasks/status-policy";
import { cn } from "@/lib/utils";
import type { DevSettingsSnapshot } from "@/lib/dev-mode/use-dev-mode";
import { TaskTypesSection } from "./task-types-section";
import { useProjectTaskTableColumnVisibility } from "@/lib/tasks/hooks/use-project-task-table-column-visibility";
import { PROJECT_TASK_TABLE_COLUMNS } from "@/lib/tasks/task-table-columns";
import {
  PROJECT_SETTINGS_CUSTOMIZATION_TAB_CONFIG,
  resolveAvailableCustomizationTabId,
  isCustomizationTabAvailable,
  isCustomizationTabId,
  type CustomizationTabId,
} from "./project-settings-config";

// ============================================================================
// Constants
// ============================================================================

const MOCK_TEMPLATES = [
  {
    id: "1",
    name: "Bug Report",
    subtasks: ["Reproduce", "Investigate", "Fix", "Test"],
    priority: "High",
  },
  {
    id: "2",
    name: "Feature Request",
    subtasks: ["Design", "Implement", "Review", "Deploy"],
    priority: "Medium",
  },
];

const STATUS_CATEGORY_BY_VALUE: Record<Status, string> = {
  [Status.TODO]: "unstarted",
  [Status.TRIAGE]: "unstarted",
  [Status.PLANNING]: "started",
  [Status.PLAN_REVIEW]: "started",
  [Status.IN_PROGRESS]: "started",
  [Status.IN_REVIEW]: "started",
  [Status.BLOCKED]: "started",
  [Status.DONE]: "completed",
  [Status.CANCELED]: "canceled",
};

// ============================================================================
// Section Components
// ============================================================================

export function CustomizationSection({
  project,
  canEdit,
  organizationId,
  devSettings,
}: {
  project: Doc<"projects"> | null | undefined;
  canEdit: boolean;
  organizationId: Id<"organizations"> | null;
  devSettings: DevSettingsSnapshot;
}) {
  const [requestedTab, setRequestedTab] = useState<CustomizationTabId>("statuses");
  const activeTab = resolveAvailableCustomizationTabId(requestedTab, devSettings);

  return (
    <div className="space-y-6">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (!isCustomizationTabId(value)) {
            return;
          }

          setRequestedTab(value);
        }}
        className="w-full"
      >
        <TabsList variant="underline">
          {PROJECT_SETTINGS_CUSTOMIZATION_TAB_CONFIG.filter(
            (tab) =>
              devSettings.showUnfinishedItems ||
              isCustomizationTabAvailable(tab, devSettings)
          ).map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              disabled={!isCustomizationTabAvailable(tab, devSettings)}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="statuses" className="mt-4">
          <StatusesTab project={project} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="columns" className="mt-4">
          <ColumnsTab project={project} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="filters" className="mt-4">
          <FiltersTab />
        </TabsContent>

        <TabsContent value="task-types" className="mt-4">
          {organizationId && (
            <TaskTypesSection organizationId={organizationId} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusesTab({
  project,
  canEdit,
}: {
  project: Doc<"projects"> | null | undefined;
  canEdit: boolean;
}) {
  const updateProject = useMutation(api.projects.core.update);
  const [pendingDisabledStatuses, setPendingDisabledStatuses] = useState<Status[] | null>(
    null
  );
  const [savingStatus, setSavingStatus] = useState<Status | null>(null);

  const categories = [
    {
      id: "unstarted",
      label: "Unstarted",
      icon: Circle,
      color: "text-muted-foreground",
    },
    { id: "started", label: "Started", icon: Loader, color: "text-warning" },
    {
      id: "completed",
      label: "Completed",
      icon: CheckCircle,
      color: "text-success",
    },
    {
      id: "canceled",
      label: "Canceled",
      icon: XCircle,
      color: "text-muted-foreground",
    },
  ];
  const projectDisabledStatuses = getDisabledTaskStatuses(project);
  // Both arrays are normalized to canonical workflow order via
  // getDisabledTaskStatuses, so an index-by-index comparison is stable here.
  const pendingMatchesProject =
    pendingDisabledStatuses !== null &&
    pendingDisabledStatuses.length === projectDisabledStatuses.length &&
    pendingDisabledStatuses.every(
      (status, index) => status === projectDisabledStatuses[index]
    );
  const disabledStatuses = pendingMatchesProject
    ? projectDisabledStatuses
    : pendingDisabledStatuses ?? projectDisabledStatuses;
  const disabledStatusSet = new Set(disabledStatuses);

  const toggleStatus = async (status: Status) => {
    if (!project || !canEdit || isProjectStatusRequired(status)) {
      return;
    }

    const nextDisabledStatuses = disabledStatusSet.has(status)
      ? disabledStatuses.filter((disabledStatus) => disabledStatus !== status)
      : getDisabledTaskStatuses({
          disabledStatuses: [...disabledStatuses, status],
        });

    setPendingDisabledStatuses(nextDisabledStatuses);
    setSavingStatus(status);

    try {
      await updateProject({
        id: project._id,
        disabledStatuses: nextDisabledStatuses,
      });
      setSavingStatus(null);
    } catch (error) {
      console.error("Failed to update project statuses:", error);
      setPendingDisabledStatuses(null);
      setSavingStatus(null);
      showConvexErrorToast(error, "Failed to update project statuses");
    }
  };

  if (project === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-4/5 rounded-sm" />
        <div className="space-y-2 pl-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-2 py-1.5">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-4 flex-1 rounded-sm" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">No project selected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enable or disable optional statuses for this project. `To Do` and `Done`
        always remain available.
      </p>

      {categories.map((category) => {
        const categoryStatuses = ALL_TASK_STATUSES.filter(
          (status) => STATUS_CATEGORY_BY_VALUE[status] === category.id
        );
        if (categoryStatuses.length === 0) return null;

        return (
          <div key={category.id} className="space-y-2">
            <div className="flex items-center gap-2 py-2">
              <category.icon className={cn("h-4 w-4", category.color)} />
              <span className="text-sm font-medium">{category.label}</span>
            </div>
            <div className="space-y-1 pl-6">
              {categoryStatuses.map((status) => (
                <div
                  key={status}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <StatusIcon status={status} />
                  <span className="flex-1 text-sm">{status}</span>
                  {isProjectStatusRequired(status) ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" />
                      Required
                    </span>
                  ) : null}
                  <Switch
                    aria-label={`Toggle ${status} status`}
                    checked={!disabledStatusSet.has(status)}
                    disabled={
                      !canEdit ||
                      savingStatus !== null ||
                      isProjectStatusRequired(status)
                    }
                    onCheckedChange={() => {
                      void toggleStatus(status);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  const sharedConfig = STATUS_CONFIG[status];
  const Icon = sharedConfig?.icon ?? Circle;
  const color = sharedConfig?.color ?? "text-muted-foreground";

  return <Icon className={cn("h-4 w-4", color)} />;
}

function ColumnsTab({
  project,
  canEdit,
}: {
  project: Doc<"projects"> | null | undefined;
  canEdit: boolean;
}) {
  const {
    isColumnVisible,
    toggleColumnVisibility,
    canToggleColumns,
  } = useProjectTaskTableColumnVisibility({
    projectId: project?._id ?? null,
    hiddenTaskTableColumns: project?.hiddenTaskTableColumns,
    canEdit,
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Configure which optional task table columns are visible.
      </p>

      <div className="space-y-1">
        {PROJECT_TASK_TABLE_COLUMNS.map((column) => {
          const visible = isColumnVisible(column.id);

          return (
            <div
              key={column.id}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
            >
              <span className="flex-1 text-sm">{column.label}</span>
              <Switch
                aria-label={`Toggle ${column.label} column`}
                checked={visible}
                disabled={!canToggleColumns}
                onCheckedChange={() => {
                  void toggleColumnVisibility(column.id);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FiltersTab() {
  return (
    <div className="space-y-4">
      <EmptyState
        icon={Sliders}
        title="No saved filters"
        description="Save filter presets for quick access."
        action={
          <Button variant="secondary">
            <Plus className="mr-2 h-4 w-4" />
            Create filter
          </Button>
        }
      />
    </div>
  );
}

export function TemplatesSection() {
  const [templates] = useState(MOCK_TEMPLATES);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Button variant="outline" size="settings">
          <Plus className="mr-2 h-4 w-4" />
          New template
        </Button>

        <div className="space-y-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className="rounded-lg border p-4 hover:bg-muted/50"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium">{template.name}</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {template.subtasks.length} subtasks • {template.priority}{" "}
                    priority
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${template.name}`}>
                    <FileText className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={`Delete ${template.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {template.subtasks.map((subtask, i) => (
                  <span
                    key={i}
                    className="rounded bg-muted px-2 py-0.5 text-xs"
                  >
                    {subtask}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RecurringTasksSection() {
  return (
    <div className="flex flex-1 flex-col">
      <EmptyState
        fill
        icon={Repeat}
        title="No recurring tasks"
        description="Schedule daily, weekly, or monthly tasks."
        action={
          <Button variant="secondary">
            <Plus className="mr-2 h-4 w-4" />
            New recurring task
          </Button>
        }
      />
    </div>
  );
}

export function AutomationsSection() {
  const [autoCloseParent, setAutoCloseParent] = useState(false);
  const [autoCloseSubtasks, setAutoCloseSubtasks] = useState(false);
  const [autoCloseStale, setAutoCloseStale] = useState(true);
  const [staleDuration, setStaleDuration] = useState("6months");
  const [staleStatus, setStaleStatus] = useState("canceled");
  const [autoArchive, setAutoArchive] = useState("6months");
  const [duplicateStatus, setDuplicateStatus] = useState("duplicate");

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        {/* Auto-close automations */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium">Auto-close automations</h3>
          <p className="text-xs text-muted-foreground">
            Automate closing tasks based on status changes or staleness.
          </p>

          <div className="rounded-lg border divide-y">
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium">Auto-close parent issues</p>
                <p className="text-xs text-muted-foreground">
                  Automatically close parent when last sub-issue is closed
                </p>
              </div>
              <Switch
                checked={autoCloseParent}
                onCheckedChange={setAutoCloseParent}
              />
            </div>

            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium">Auto-close sub-issues</p>
                <p className="text-xs text-muted-foreground">
                  Automatically close all sub-issues when parent is closed
                </p>
              </div>
              <Switch
                checked={autoCloseSubtasks}
                onCheckedChange={setAutoCloseSubtasks}
              />
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Auto-close stale issues</p>
                  <p className="text-xs text-muted-foreground">
                    Automatically close issues not updated in...
                  </p>
                </div>
                <Switch
                  checked={autoCloseStale}
                  onCheckedChange={setAutoCloseStale}
                />
              </div>

              {autoCloseStale && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Close after being stale for
                    </Label>
                    <Select
                      value={staleDuration}
                      onValueChange={setStaleDuration}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1month">1 month</SelectItem>
                        <SelectItem value="3months">3 months</SelectItem>
                        <SelectItem value="6months">6 months</SelectItem>
                        <SelectItem value="1year">1 year</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Set status to</Label>
                    <Select value={staleStatus} onValueChange={setStaleStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="canceled">Canceled</SelectItem>
                        <SelectItem value="done">Done</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Auto-archive */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium">Auto-archive</h3>
          <p className="text-xs text-muted-foreground">
            Completed or canceled tasks are automatically archived after the set
            time.
          </p>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm">Auto-archive closed items after</p>
              <Select value={autoArchive} onValueChange={setAutoArchive}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1month">1 month</SelectItem>
                  <SelectItem value="3months">3 months</SelectItem>
                  <SelectItem value="6months">6 months</SelectItem>
                  <SelectItem value="1year">1 year</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Duplicate status */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium">Duplicate issue status</h3>
          <p className="text-xs text-muted-foreground">
            Status to set when marking an issue as duplicate.
          </p>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm">Status for duplicates</p>
              <Select
                value={duplicateStatus}
                onValueChange={setDuplicateStatus}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="duplicate">Duplicate</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ImportExportSection() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <Import className="h-5 w-5" />
            <h3 className="font-medium">Import</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Import tasks from CSV or JSON files
          </p>
          <Button variant="outline" size="settings" className="w-full">
            Select file
          </Button>
        </div>

        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 mb-2">
            <Download className="h-5 w-5" />
            <h3 className="font-medium">Export</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Export all tasks to CSV or JSON
          </p>
          <Select defaultValue="csv">
            <SelectTrigger className="mb-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="settings" className="w-full">
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}
