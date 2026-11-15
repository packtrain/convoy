"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { hasProjectPermission, ProjectPermission } from "@/lib/authz/permissions";
import { ActionButton } from "@/components/custom/action-button";
import { TitledDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateTimePicker } from "@/components/lingua-time/datetime-picker";
import { PriorityCell } from "@/components/blocks/tasks/task-table/cells/priority-cell";
import {
  AssigneeSelector,
  TaskAssigneeAvatar,
} from "@/components/blocks/tasks/task-table/cells/assignee-selector";
import { TaskDescriptionEditor } from "@/components/blocks/tasks/task-description-editor";
import { TaskTypeSelector } from "@/components/blocks/tasks/task-ref-with-type";
import { DATE_FORMAT } from "@/lib/tasks/constants";
import { resolveCreateTaskListRef } from "@/lib/tasks/create-list";
import {
  parseTaskTitleForCreate,
  sanitizeTaskTitleInputForCreate,
} from "@/lib/tasks/create-title";
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
  DEFAULT_TASK_TYPE_KEY,
  type TaskTypeDefinition,
} from "@/lib/tasks/task-types";
import { appRoute, useNavigation, withProjectTask } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { ChevronDown, Tag, User } from "lucide-react";
import { TaskLabelPicker } from "@/components/blocks/tasks/task-label-picker";
import { useProjectLabels } from "@/lib/tasks/hooks/use-project-labels";
import { PriorityIcon, StatusIcon } from "@/components/blocks/tasks/task-table/badges";
import { StatusDropdownMenu } from "@/components/blocks/tasks/status-dropdown-menu";
import type { UseDialogReturn } from "@/hooks/ui/use-dialog";

type ProjectOption = {
  value: string;
  label: string;
  alias: string;
  projectId: Id<"projects">;
};

interface CreateTaskDialogProps {
  dialog: Pick<UseDialogReturn, "isOpen" | "close">;
  organizationId: Id<"organizations">;
  organizationSlug: string;
  activeProjectAlias: string | null;
  activeListRef?: string | null;
}

const compactGhostButtonClassName = "h-8 px-2";

interface ProjectSelectorDropdownProps {
  projects: ProjectOption[];
  selectedProject: ProjectOption | null;
  onProjectChange: (project: ProjectOption) => void;
  disabled?: boolean;
}

function ProjectSelectorDropdown({
  projects,
  selectedProject,
  onProjectChange,
  disabled = false,
}: ProjectSelectorDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery.length === 0) {
      return projects;
    }

    return projects.filter((project) => {
      const haystack = `${project.alias} ${project.label}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [projects, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setQuery("");
        }
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            compactGhostButtonClassName,
            "max-w-[240px] min-w-0 justify-start gap-2"
          )}
          aria-label="Project"
        >
          {selectedProject ? (
            <>
              <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                {selectedProject.alias}
              </span>
              <span className="truncate text-sm text-foreground">
                {selectedProject.label}
              </span>
            </>
          ) : (
            <span className="truncate text-sm text-muted-foreground">
              Project
            </span>
          )}
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-0">
        <Command
          shouldFilter={false}
          className="p-0 **:data-[slot=command-input-wrapper]:h-auto"
        >
          <CommandInput
            ref={inputRef}
            placeholder="Search projects..."
            value={query}
            onValueChange={setQuery}
            className="h-auto py-3.5"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
                return;
              }

              event.stopPropagation();
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
                      onClick={(event) => event.stopPropagation()}
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

export function CreateTaskDialog({
  dialog,
  organizationId,
  organizationSlug,
  activeProjectAlias,
  activeListRef = null,
}: CreateTaskDialogProps) {
  const open = dialog.isOpen;
  const closeDialog = dialog.close;
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
        .filter((project) => hasProjectPermission(project.myRole, ProjectPermission.TASK_CREATE))
        .map((project) => ({
          value: String(project._id),
          label: project.name,
          alias: project.alias,
          projectId: project._id,
        })),
    [projects]
  );
  const defaultProject = useMemo(
    () =>
      projectOptions.find((project) => project.alias === activeProjectAlias) ?? null,
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
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [assignee, setAssignee] = useState<TaskUserAssigneeDetails>(null);
  const [delegatedToAgent, setDelegatedToAgent] =
    useState<TaskDelegatedAgentDetails>(null);
  const [labelId, setLabelId] = useState<Id<"projectLabels"> | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didInitialize, setDidInitialize] = useState(false);
  const previousProjectIdRef = useRef<Id<"projects"> | null>(null);

  const selectedProjectId = selectedProject?.projectId;
  const { labels, labelsById } = useProjectLabels(selectedProjectId);
  const selectedLabel = labelId ? (labelsById.get(String(labelId)) ?? null) : null;

  const resetDraft = useCallback((initialProject: ProjectOption | null) => {
    setSelectedProject(initialProject);
    setTaskType(BUILT_IN_TASK_TYPES[0]);
    setTitle("");
    setStatus(Status.TODO);
    setPriority("None");
    setDueDate(undefined);
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

    if (didInitialize || projects === undefined) {
      return;
    }

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
  const submittedTaskTypeKey =
    taskType.key !== DEFAULT_TASK_TYPE_KEY
      ? taskType.key
      : parsedTitle.taskTypeKey ?? taskType.key;

  const isCreateDisabled =
    isSubmitting || !selectedProjectId || parsedTitleName.length === 0;

  const handleDescriptionSave = useCallback((value: string | null) => {
    setDescription(value);
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!selectedProject || parsedTitleName.length === 0) {
        return;
      }

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
          taskTypeKey: submittedTaskTypeKey,
          description: description ?? undefined,
          priority,
          dueDate: dueDate?.getTime(),
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
          closeDialog();
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
      closeDialog,
      description,
      dueDate,
      labelId,
      organizationSlug,
      parsedTitleName,
      parsedTitleTags,
      priority,
      status,
      navigation,
      selectedProject,
      submittedTaskTypeKey,
    ]
  );

  return (
    <TitledDialog
      open={open}
      onClose={closeDialog}
      size="lg"
      dialogContentClassName="sm:max-w-2xl"
      screenReaderTitle="Create task"
      showCloseButton={false}
    >
      <form onSubmit={handleSubmit}>
        <div
          data-testid="task-create-title-row"
          className={cn(TASK_CREATE_TITLE_ROW_CLASS_NAME, "-mt-2")}
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
            value={title}
            onChange={(event) => {
              setTitle(sanitizeTaskTitleInputForCreate(event.target.value));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
              }
            }}
            placeholder="Add task..."
            aria-label="Task title"
            rows={1}
            className={cn(TASK_CREATE_TITLE_INPUT_CLASS_NAME, "max-h-40")}
            autoFocus
            required
          />
        </div>

        <div aria-hidden="true" className="-mx-4 border-t mt-2" />

        <TaskDescriptionEditor
          value={description}
          onSave={handleDescriptionSave}
          placeholder="Add a description"
          showToolbar={false}
          borderless
          className="border-0 bg-transparent"
          editorContentClassName="min-h-[72px] max-h-[240px] overflow-y-auto overscroll-contain px-0 text-sm [&_.tiptap.ProseMirror_p]:!text-sm [&_.tiptap.ProseMirror_p]:!leading-6"
        />

        <div className="-mx-4 -mb-4 border-t px-4 pt-4 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1">
              <StatusDropdownMenu
                status={status}
                onStatusChange={setStatus}
                trigger={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(compactGhostButtonClassName, "gap-1")}
                    aria-label={`Status: ${status}`}
                  >
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(compactGhostButtonClassName, "gap-1")}
                    aria-label={`Priority: ${priority}`}
                  >
                    <PriorityIcon priority={priority} />
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </Button>
                }
                align="center"
                sideOffset={8}
              />
              <DateTimePicker
                dateTime={dueDate}
                setDateTime={setDueDate}
                variant="icon-or-date"
                mode="date"
                dateFormat={DATE_FORMAT}
                className="h-8"
                aria-label="Due date"
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn(compactGhostButtonClassName, "gap-1")}
                  >
                    {(delegatedToAgent ?? assignee) ? (
                      <TaskAssigneeAvatar
                        assignee={delegatedToAgent ?? assignee}
                        className="!size-4 after:border-0"
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
              <ProjectSelectorDropdown
                projects={projectOptions}
                selectedProject={selectedProject}
                onProjectChange={setSelectedProject}
                disabled={projects === undefined || projectOptions.length === 0}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={closeDialog}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <ActionButton busy={isSubmitting} disabled={isCreateDisabled}>
                Create
              </ActionButton>
            </div>
          </div>
        </div>
      </form>
    </TitledDialog>
  );
}
