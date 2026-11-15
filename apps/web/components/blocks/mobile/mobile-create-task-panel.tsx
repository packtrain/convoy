"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import { ArrowUp, ChevronDown, Tag, User } from "lucide-react";
import { TaskLabelPicker } from "@/components/blocks/tasks/task-label-picker";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { hasProjectPermission, ProjectPermission } from "@/lib/authz/permissions";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/custom/spinner";
import { DropdownSearchInput } from "@/components/custom/dropdown-search-input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PriorityCell } from "@/components/blocks/tasks/task-table/cells/priority-cell";
import {
  AssigneeSelector,
  TaskAssigneeAvatar,
} from "@/components/blocks/tasks/task-table/cells/assignee-selector";
import { TaskDescriptionEditor } from "@/components/blocks/tasks/task-description-editor";
import { TaskTypeSelector } from "@/components/blocks/tasks/task-ref-with-type";
import { StatusDropdownMenu } from "@/components/blocks/tasks/status-dropdown-menu";
import { PriorityIcon, StatusIcon } from "@/components/blocks/tasks/task-table/badges";
import {
  parseTaskTitleForCreate,
  sanitizeTaskTitleInputForCreate,
} from "@/lib/tasks/create-title";
import { resolveCreateTaskListRef } from "@/lib/tasks/create-list";
import {
  TASK_CREATE_TITLE_INPUT_CLASS_NAME,
  TASK_CREATE_TITLE_ROW_CLASS_NAME,
  TASK_CREATE_TYPE_SLOT_CLASS_NAME,
} from "@/lib/tasks/create-title-row";
import type {
  Priority,
  TaskDelegatedAgentDetails,
  TaskUserAssigneeDetails,
} from "@/lib/tasks/types";
import { Status } from "@/lib/tasks/types";
import {
  BUILT_IN_TASK_TYPES,
  type TaskTypeDefinition,
} from "@/lib/tasks/task-types";
import { appRoute, useNavigation, withProjectTask } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const compactGhostButtonClassName = "h-8 px-2";

function CompactProjectSelector({
  projects,
  selectedProject,
  onProjectChange,
}: {
  projects: ProjectOption[];
  selectedProject: ProjectOption | null;
  onProjectChange: (project: ProjectOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) return projects;
    return projects.filter((p) => {
      const haystack = `${p.alias} ${p.label}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [projects, query]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(compactGhostButtonClassName, "gap-1 font-mono text-xs text-muted-foreground")}
        >
          {selectedProject ? selectedProject.alias : "Project"}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-0">
        <Command shouldFilter={false} className="p-0">
          <DropdownSearchInput
            mode="command"
            ref={inputRef}
            placeholder="Search projects…"
            value={query}
            onValueChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeMenu();
                return;
              }
              e.stopPropagation();
            }}
          />
          <CommandList>
            {filteredProjects.length === 0 ? (
              <CommandEmpty className="py-2.5">No projects found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredProjects.map((project) => {
                  const isSelected = project.projectId === selectedProject?.projectId;
                  return (
                    <CommandItem
                      key={project.value}
                      value={`${project.alias} ${project.label}`}
                      data-interactive
                      data-checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onSelect={() => {
                        onProjectChange(project);
                        window.setTimeout(closeMenu, 0);
                      }}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                          {project.alias}
                        </span>
                        <span className="truncate">{project.label}</span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface MobileCreateTaskPanelProps {
  open: boolean;
  organizationId: Id<"organizations">;
  organizationSlug: string;
  activeProjectAlias: string;
  activeListRef: string | null;
  onClose: () => void;
}

type ProjectOption = {
  value: string;
  label: string;
  alias: string;
  projectId: Id<"projects">;
};

export function MobileCreateTaskPanel({
  open,
  organizationId,
  organizationSlug,
  activeProjectAlias,
  activeListRef,
  onClose,
}: MobileCreateTaskPanelProps) {
  const navigation = useNavigation();
  const createTask = useMutation(api.tasks.core.create);
  const projects = useQuery(
    api.projects.core.listByOrganization,
    open ? { organizationId } : "skip"
  );

  const projectOptions = useMemo<ProjectOption[]>(
    () =>
      // Only projects the caller can create tasks in (read-only-viewer-ux.md).
      (projects ?? [])
        .filter((p) => hasProjectPermission(p.myRole, ProjectPermission.TASK_CREATE))
        .map((p) => ({
          value: String(p._id),
          label: p.name,
          alias: p.alias,
          projectId: p._id,
        })),
    [projects]
  );
  const defaultProject = useMemo(
    () =>
      projectOptions.find((p) => p.alias === activeProjectAlias) ?? null,
    [activeProjectAlias, projectOptions]
  );

  const [storedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  // A project that loses create access while the form is open drops out of the selection.
  const selectedProject =
    projectOptions.find((project) => project.projectId === storedProject?.projectId) ?? null;
  const [taskType, setTaskType] = useState<TaskTypeDefinition>(BUILT_IN_TASK_TYPES[0]);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>(Status.TODO);
  const [priority, setPriority] = useState<Priority>("None");
  const [assignee, setAssignee] = useState<TaskUserAssigneeDetails>(null);
  const [delegatedToAgent, setDelegatedToAgent] =
    useState<TaskDelegatedAgentDetails>(null);
  const [labelId, setLabelId] = useState<Id<"projectLabels"> | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didInitialize, setDidInitialize] = useState(false);
  const previousProjectIdRef = useRef<Id<"projects"> | null>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);

  const selectedProjectId = selectedProject?.projectId;
  const { labels, labelsById } = useProjectLabels(selectedProjectId);
  const selectedLabel = labelId ? (labelsById.get(String(labelId)) ?? null) : null;

  const resetDraft = useCallback((initialProject: ProjectOption | null) => {
    setSelectedProject(initialProject);
    setTaskType(BUILT_IN_TASK_TYPES[0]);
    setTitle("");
    setStatus(Status.TODO);
    setPriority("None");
    setAssignee(null);
    setDelegatedToAgent(null);
    setLabelId(null);
    setDescription(null);
  }, []);

  useEffect(() => {
    if (!open) {
      setDidInitialize(false);
      previousProjectIdRef.current = null;
      return;
    }
    if (didInitialize || projects === undefined) return;
    resetDraft(defaultProject);
    previousProjectIdRef.current = defaultProject?.projectId ?? null;
    setDidInitialize(true);
  }, [defaultProject, didInitialize, open, projects, resetDraft]);

  // Assignments belong to one project: clear them on any change, including the
  // selected project dropping out of the picker.
  useEffect(() => {
    const previousProjectId = previousProjectIdRef.current;
    if (previousProjectId && previousProjectId !== selectedProjectId) {
      setAssignee(null);
      setDelegatedToAgent(null);
      setLabelId(null);
    }
    previousProjectIdRef.current = selectedProjectId ?? null;
  }, [selectedProjectId]);

  const parsedTitle = useMemo(() => parseTaskTitleForCreate(title), [title]);
  const parsedTitleName = parsedTitle.name;
  const parsedTitleTags = parsedTitle.tags;
  const isCreateDisabled =
    isSubmitting || !selectedProjectId || parsedTitleName.length === 0;

  useEffect(() => {
    if (!didInitialize) return;
    const timer = setTimeout(() => titleInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [didInitialize]);

  const handleDescriptionSave = useCallback((value: string | null) => {
    setDescription(value);
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedProject || parsedTitleName.length === 0) return;

      setIsSubmitting(true);
      try {
        const listRef = resolveCreateTaskListRef({
          activeProjectAlias,
          selectedProjectAlias: selectedProject.alias,
          activeListRef,
        });
        const createResult = await createTask({
          projectId: selectedProject.projectId,
          clientId: crypto.randomUUID(),
          name: parsedTitleName,
          taskTypeKey: taskType.key,
          description: description ?? undefined,
          priority,
          status,
          ...(listRef ? { listRef } : {}),
          ...(assignee ? { assigneeId: assignee.userId } : {}),
          ...(delegatedToAgent ? { delegatedToAgentId: delegatedToAgent.projectAgentId } : {}),
          ...(labelId ? { labelId } : {}),
          tags: parsedTitleTags,
        });

        const nextTarget = withProjectTask(
          appRoute.project(organizationSlug, selectedProject.alias).pathname,
          { list: listRef },
          createResult.refId
        );

        startTransition(() => {
          onClose();
          navigation.push(nextTarget);
        });
      } catch (error) {
        console.error("Failed to create task", error);
        toast.error("Failed to create task", { description: getErrorMessage(error, "Unknown error") });
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      assignee,
      delegatedToAgent,
      activeListRef,
      activeProjectAlias,
      createTask,
      onClose,
      description,
      labelId,
      organizationSlug,
      parsedTitleName,
      parsedTitleTags,
      priority,
      status,
      navigation,
      selectedProject,
      taskType.key,
    ]
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col">
      {/* Title row */}
      <div
        data-testid="task-create-title-row"
        className={cn(TASK_CREATE_TITLE_ROW_CLASS_NAME, "px-4 py-3")}
      >
        <div
          data-testid="task-create-type-slot"
          className={TASK_CREATE_TYPE_SLOT_CLASS_NAME}
        >
          <TaskTypeSelector
            taskType={taskType}
            taskTypes={BUILT_IN_TASK_TYPES}
            onTaskTypeChange={setTaskType}
            variant="icon"
            className="shrink-0"
            contentClassName="w-44"
          />
        </div>
        <textarea
          ref={titleInputRef}
          value={title}
          onChange={(e) => setTitle(sanitizeTaskTitleInputForCreate(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
          }}
          placeholder="Add task..."
          aria-label="Task title"
          rows={1}
          className={cn(TASK_CREATE_TITLE_INPUT_CLASS_NAME, "max-h-30")}
          autoFocus
          required
        />
      </div>

      <div className="border-t" />

      {/* Description */}
      <div className="px-4">
        <TaskDescriptionEditor
          value={description}
          onSave={handleDescriptionSave}
          placeholder="Add a description"
          showToolbar={false}
          borderless
          className="border-0 bg-transparent"
          editorContentClassName="min-h-[100px] max-h-[180px] overflow-y-auto overscroll-contain px-0 text-sm"
        />
      </div>

      {/* Footer: selectors + create */}
      <div className="border-t px-4 pt-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <StatusDropdownMenu
              status={status}
              onStatusChange={setStatus}
              trigger={
                <Button type="button" variant="ghost" size="sm" className={cn(compactGhostButtonClassName, "gap-1")} aria-label={`Status: ${status}`}>
                  <StatusIcon status={status} />
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              }
              align="center"
              sideOffset={8}
            />
            <PriorityCell
              priority={priority}
              onPriorityChange={setPriority}
              trigger={
                <Button type="button" variant="ghost" size="sm" className={cn(compactGhostButtonClassName, "gap-1")} aria-label={`Priority: ${priority}`}>
                  <PriorityIcon priority={priority} />
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              }
              align="center"
              sideOffset={8}
            />
            <AssigneeSelector
              projectId={selectedProjectId}
              assignee={assignee}
              delegatedToAgent={delegatedToAgent}
              onAssigneeChange={(change) => {
                if (change.assigneeDetails !== undefined) setAssignee(change.assigneeDetails);
                if (change.delegatedToAgentDetails !== undefined) setDelegatedToAgent(change.delegatedToAgentDetails);
              }}
              variant="icon"
              trigger={
                <Button type="button" variant="ghost" size="sm" className={cn(compactGhostButtonClassName, "gap-1")}>
                  {(delegatedToAgent ?? assignee) ? (
                    <TaskAssigneeAvatar
                      assignee={delegatedToAgent ?? assignee}
                      className="size-4! after:border-0"
                    />
                  ) : (
                    <User className="h-4 w-4 text-muted-foreground" />
                  )}
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              }
              align="center"
              sideOffset={8}
            />
            <TaskLabelPicker
              labels={labels}
              value={labelId}
              onChange={setLabelId}
              align="center"
              sideOffset={8}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={selectedLabel ? `Label: ${selectedLabel.name}` : "Set label"}
                  className={cn(compactGhostButtonClassName, "gap-1")}
                >
                  {selectedLabel ? (
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: selectedLabel.color }} />
                  ) : (
                    <Tag className="h-4 w-4 text-muted-foreground" />
                  )}
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </Button>
              }
            />
            <CompactProjectSelector
              projects={projectOptions}
              selectedProject={selectedProject}
              onProjectChange={setSelectedProject}
            />
          </div>
          <Button
            type="submit"
            aria-label="Create"
            disabled={isCreateDisabled}
            size="icon"
            className="size-8 shrink-0 rounded-full"
          >
            {isSubmitting ? <Spinner /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
      </div>
    </form>
  );
}
