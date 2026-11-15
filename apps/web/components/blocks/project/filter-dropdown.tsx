"use client";

import { useState, type ReactNode } from "react";
import {
  Check,
  ChevronRight,
  List,
  User,
  Users,
  UserX,
  Loader,
  CheckCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  taskAssigneeInputsEqual,
  taskAssigneeToKey,
} from "@/lib/tasks/assignees";
import type {
  StatusFilterKey,
  AssigneeFilter,
  TaskAssigneeInput,
} from "@/lib/tasks/types";
import { useAssignableTaskAssignees } from "@/lib/tasks/hooks/use-assignable-task-assignees";
import { TaskAssigneeAvatar } from "@/components/blocks/tasks/task-table/cells/assignee-selector";
import { HeaderMenu } from "./header-menu";

type AssignableTaskAssigneeDirectory = ReturnType<typeof useAssignableTaskAssignees>;

type StatusFilterConfig = {
  value: StatusFilterKey;
  label: string;
  icon: LucideIcon;
  iconColor?: string;
  triggerClassName?: string;
};

const STATUS_FILTERS: StatusFilterConfig[] = [
  { value: "all", label: "All", icon: List },
  {
    value: "active",
    label: "Active",
    icon: Loader,
    iconColor: "text-warning",
    triggerClassName:
      "bg-amber-50 text-amber-900 hover:bg-amber-100 aria-expanded:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50 dark:aria-expanded:bg-amber-900/50",
  },
  {
    value: "done",
    label: "Done",
    icon: CheckCircle,
    iconColor: "text-success",
    triggerClassName:
      "bg-emerald-50 text-emerald-900 hover:bg-emerald-100 aria-expanded:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-900/50 dark:aria-expanded:bg-emerald-900/50",
  },
  {
    value: "canceled",
    label: "Canceled",
    icon: XCircle,
    iconColor: "text-muted-foreground",
    triggerClassName: "bg-muted text-foreground hover:bg-muted aria-expanded:bg-muted",
  },
];

interface FilterDropdownProps {
  statusFilter: StatusFilterKey;
  assigneeFilter: AssigneeFilter;
  projectId?: Id<"projects">;
  isActive?: boolean;
  onStatusFilterChange: (filter: StatusFilterKey) => void;
  onAssigneeFilterChange: (filter: AssigneeFilter) => void;
}

function FilterIcon({
  filter,
  className,
}: {
  filter: StatusFilterConfig;
  className?: string;
}) {
  const Icon = filter.icon;
  return <Icon className={cn("size-3", className)} />;
}

interface FilterButtonContentProps {
  Icon?: LucideIcon;
  label?: string;
  labelContent?: ReactNode;
  leading?: ReactNode;
  className?: string;
}

function FilterButtonContent({
  Icon,
  label,
  labelContent,
  leading,
  className,
}: FilterButtonContentProps) {
  return (
    <>
      {leading ?? (Icon ? <Icon className={cn("size-3.5 text-muted-foreground", className)} /> : null)}
      <span className="text-sm">{labelContent ?? label}</span>
    </>
  );
}

const activeTriggerClasses = "bg-muted text-foreground hover:bg-muted aria-expanded:bg-muted";

function isSelectedAssigneeOption(
  filter: AssigneeFilter,
  option: NonNullable<TaskAssigneeInput>
) {
  return taskAssigneeInputsEqual(assigneeFilterToInput(filter), option);
}

function assigneeFilterToInput(filter: AssigneeFilter): TaskAssigneeInput | undefined {
  if (!filter) return undefined;
  if (filter.type === "user") return { type: "user", userId: filter.userId };
  if (filter.type === "projectAgent") {
    return { type: "projectAgent", projectAgentId: filter.projectAgentId };
  }
  return undefined;
}

function AssigneeFilterTriggerContent({
  assigneeFilter,
  projectId,
  directory,
}: {
  assigneeFilter: NonNullable<AssigneeFilter>;
  projectId?: Id<"projects">;
  directory: AssignableTaskAssigneeDirectory;
}) {
  if (assigneeFilter.type === "me") {
    return (
      <FilterButtonContent
        Icon={User}
        label="My tasks"
        className="text-muted-foreground"
      />
    );
  }

  if (assigneeFilter.type === "unassigned") {
    return (
      <FilterButtonContent
        Icon={UserX}
        label="No assignee"
        className="text-muted-foreground"
      />
    );
  }

  if (!projectId) {
    return (
      <FilterButtonContent
        Icon={User}
        label="Assigned"
        className="text-muted-foreground"
      />
    );
  }

  return (
    <ProjectResolvedAssigneeFilterTriggerContent
      assigneeFilter={assigneeFilter}
      directory={directory}
    />
  );
}

function ProjectResolvedAssigneeFilterTriggerContent({
  assigneeFilter,
  directory,
}: {
  assigneeFilter: Extract<NonNullable<AssigneeFilter>, { type: "user" | "projectAgent" }>;
  directory: AssignableTaskAssigneeDirectory;
}) {
  const selectedOption = directory.findOption(assigneeFilterToInput(assigneeFilter));

  if (selectedOption) {
    return (
      <FilterButtonContent
        labelContent={
          <span className="flex min-w-0 items-center gap-1.5">
            <AssigneeOptionLabel option={selectedOption} />
          </span>
        }
        leading={<TaskAssigneeAvatar assignee={selectedOption.details} />}
      />
    );
  }

  return (
    <FilterButtonContent
      Icon={User}
      label="Assigned"
      className="text-muted-foreground"
    />
  );
}

function AssignableAssigneeFilterOptions({
  directory,
  assigneeFilter,
  onSelect,
}: {
  directory: AssignableTaskAssigneeDirectory;
  assigneeFilter: AssigneeFilter;
  onSelect: (filter: AssigneeFilter) => void;
}) {
  return (
    <>
      {directory.sections.map((section) =>
        section.options.length > 0 ? (
          <div key={section.label}>
            <div className="px-1.5 py-1 text-xs text-muted-foreground">
              {section.label}
            </div>
            {section.options.map((option) => (
              <button
                key={taskAssigneeToKey(option.value)}
                type="button"
                role="menuitem"
                aria-label={assigneeOptionAccessibleLabel(option)}
                onClick={() => onSelect(option.value)}
                className="relative flex w-full cursor-pointer select-none items-center justify-between gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <TaskAssigneeAvatar assignee={option.details} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                </span>
                {option.type === "user" && option.isCurrentUser ? (
                  <span className="text-xs text-muted-foreground">(you)</span>
                ) : null}
                {isSelectedAssigneeOption(assigneeFilter, option.value) && (
                  <Check className="size-4 text-primary" />
                )}
              </button>
            ))}
          </div>
        ) : null
      )}
    </>
  );
}

function AssigneeOptionLabel({
  option,
}: {
  option: AssignableTaskAssigneeDirectory["options"][number];
}) {
  return (
    <>
      <span className="truncate">{option.label}</span>
      {option.type === "user" && option.isCurrentUser ? (
        <span className="text-xs text-muted-foreground">(you)</span>
      ) : null}
    </>
  );
}

function assigneeOptionAccessibleLabel(
  option: AssignableTaskAssigneeDirectory["options"][number]
) {
  return option.type === "user" && option.isCurrentUser
    ? `${option.label} (you)`
    : option.label;
}

function menuItemClassName(className?: string) {
  return cn(
    "relative flex w-full cursor-pointer select-none items-center justify-between gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
    className
  );
}

export function FilterDropdown({
  statusFilter,
  assigneeFilter,
  projectId,
  isActive = false,
  onStatusFilterChange,
  onAssigneeFilterChange,
}: FilterDropdownProps) {
  const [assignedToMenuOpen, setAssignedToMenuOpen] = useState(false);
  const assigneeDirectory = useAssignableTaskAssignees(projectId);
  const activeStatusConfig =
    STATUS_FILTERS.find((filter) => filter.value === statusFilter) ?? STATUS_FILTERS[0];

  const handleNavigatingSelect = (close: () => void, navigate: () => void) => {
    close();
    navigate();
  };

  const handleAssigneeSelect = (close: () => void, filter: AssigneeFilter) => {
    handleNavigatingSelect(close, () => {
      onAssigneeFilterChange(filter);
    });
  };

  const handleAssigneeToggle = (close: () => void, filter: AssigneeFilter) => {
    const nextFilter =
      filter?.type === "me" && assigneeFilter?.type === "me" ? null : filter;
    handleAssigneeSelect(close, nextFilter);
  };

  const handleStatusSelect = (close: () => void, filter: StatusFilterKey) => {
    handleNavigatingSelect(close, () => {
      onStatusFilterChange(filter);
    });
  };

  return (
    <HeaderMenu
      menuClassName="p-1"
      onClose={() => setAssignedToMenuOpen(false)}
      trigger={({ open, toggle }) => (
        <Button
          variant="ghost"
          size="sm"
          shape="pill"
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            "gap-1.5 px-3 text-foreground",
            isActive && activeTriggerClasses,
            activeStatusConfig.triggerClassName
          )}
          onClick={toggle}
        >
          {assigneeFilter ? (
            <AssigneeFilterTriggerContent
              assigneeFilter={assigneeFilter}
              projectId={projectId}
              directory={assigneeDirectory}
            />
          ) : (
            <FilterButtonContent
              Icon={activeStatusConfig.icon}
              label={activeStatusConfig.label}
              className={activeStatusConfig.iconColor}
            />
          )}
        </Button>
      )}
    >
      {({ close }) => (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleAssigneeToggle(close, { type: "me" })}
            className={menuItemClassName()}
          >
            <span className="flex items-center gap-2">
              <User className="size-3.5 text-muted-foreground" />
              My tasks
            </span>
            {assigneeFilter?.type === "me" && (
              <Check className="size-4 text-primary" />
            )}
          </button>

          <div
            className="relative"
            onMouseEnter={() => setAssignedToMenuOpen(true)}
            onMouseLeave={() => setAssignedToMenuOpen(false)}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={assignedToMenuOpen}
              onClick={() => setAssignedToMenuOpen((open) => !open)}
              onFocus={() => setAssignedToMenuOpen(true)}
              className={menuItemClassName()}
            >
              <span className="flex items-center gap-2">
                <Users className="size-3.5 text-muted-foreground" />
                Assigned to
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
            {assignedToMenuOpen ? (
              <div
                role="menu"
                className="absolute left-full top-0 z-50 pl-1"
              >
                <div className="w-56 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleAssigneeSelect(close, null)}
                    className={menuItemClassName()}
                  >
                    <span className="flex items-center gap-2">
                      <User className="size-3.5 text-muted-foreground" />
                      Any assignee
                    </span>
                    {assigneeFilter === null && (
                      <Check className="size-4 text-primary" />
                    )}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      handleAssigneeSelect(close, { type: "unassigned" })
                    }
                    className={menuItemClassName()}
                  >
                    <span className="flex items-center gap-2">
                      <UserX className="size-3.5 text-muted-foreground" />
                      No assignee
                    </span>
                    {assigneeFilter?.type === "unassigned" && (
                      <Check className="size-4 text-primary" />
                    )}
                  </button>
                  {projectId ? (
                    <AssignableAssigneeFilterOptions
                      directory={assigneeDirectory}
                      assigneeFilter={assigneeFilter}
                      onSelect={(filter) => handleAssigneeSelect(close, filter)}
                    />
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="-mx-1 my-1 h-px bg-border" />

          {/* Status filters - radio style */}
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              role="menuitem"
              onClick={() => handleStatusSelect(close, filter.value)}
              className={menuItemClassName()}
            >
              <span className="flex items-center gap-2">
                <FilterIcon filter={filter} className={filter.iconColor ?? "text-muted-foreground"} />
                {filter.label}
              </span>
              {statusFilter === filter.value && (
                <Check className="size-4 text-primary" />
              )}
            </button>
          ))}
        </>
      )}
    </HeaderMenu>
  );
}
