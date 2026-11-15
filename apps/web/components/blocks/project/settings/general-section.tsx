"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { showConvexErrorToast } from "@/lib/errors";

import { ActionButton } from "@/components/custom/action-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import { ColorPicker } from "@/components/custom/color-picker";
import { SettingsActions } from "@/components/custom/settings-layout";
import {
  BOARD_GROUP_BY_OPTIONS,
  resolveDefaultView,
  type BoardGroupBy,
  type BoardRowGroupBy,
  type ListGroupBy,
} from "@/lib/navigation";

// ============================================================================
// Form Schema
// ============================================================================

const generalFormSchema = z.object({
  name: z
    .string()
    .min(2, { message: "Name must be at least 2 characters." })
    .refine((val) => val.trim() === val, {
      message: "No leading or trailing spaces allowed.",
    }),
  description: z.string().optional(),
  color: z.string().nullable(),
  showArtifactsCount: z.boolean(),
  defaultViewMode: z.enum(["list", "board"]),
  // Values only come from the selects below.
  defaultListGroupBy: z.custom<ListGroupBy>(),
  defaultBoardGroupBy: z.custom<BoardGroupBy>(),
  defaultBoardRowGroupBy: z.custom<BoardRowGroupBy>(),
});

type GeneralFormValues = z.infer<typeof generalFormSchema>;

function toDefaultViewFields(project: Doc<"projects"> | null | undefined) {
  const { viewMode, listGroupBy, boardGroupBy, boardRowGroupBy } = resolveDefaultView(project);
  return {
    defaultViewMode: viewMode,
    defaultListGroupBy: listGroupBy,
    defaultBoardGroupBy: boardGroupBy,
    defaultBoardRowGroupBy: boardRowGroupBy,
  };
}

const groupByLabel = (value: ListGroupBy) =>
  BOARD_GROUP_BY_OPTIONS.find((option) => option.value === value)?.label;

// ============================================================================
// Props
// ============================================================================

interface GeneralSectionProps {
  project: Doc<"projects"> | null | undefined;
  onSaved?: () => void;
  onAliasChanged?: (newAlias: string) => void;
  canEdit?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function GeneralSection({ project, onSaved, onAliasChanged, canEdit = true }: GeneralSectionProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const updateProject = useMutation(api.projects.core.update);
  const updateAlias = useMutation(api.projects.core.updateAlias);

  // Alias state (managed separately from form, saved by the same Save)
  const [alias, setAlias] = useState(project?.alias ?? "");

  const form = useForm<GeneralFormValues>({
    resolver: zodResolver(generalFormSchema),
    defaultValues: {
      name: project?.name ?? "",
      description: project?.description ?? "",
      color: project?.color ?? null,
      showArtifactsCount: project?.showArtifactsCount ?? true,
      ...toDefaultViewFields(project),
    },
  });

  // Reset form when project changes
  useEffect(() => {
    if (project) {
      form.reset({
        name: project.name,
        description: project.description ?? "",
        color: project.color ?? null,
        showArtifactsCount: project.showArtifactsCount ?? true,
        ...toDefaultViewFields(project),
      });
      setAlias(project.alias);
    }
  }, [project, form]);

  const handleAliasChange = (value: string) => {
    const formatted = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    setAlias(formatted.slice(0, 5));
  };

  const isAliasValid = /^[A-Z][A-Z0-9]{1,4}$/.test(alias);
  const isAliasDirty = alias !== project?.alias;

  const saveFields = async (data: GeneralFormValues) => {
    if (!project) return;
    await updateProject({
      id: project._id,
      name: data.name,
      description: data.description?.trim() || undefined,
      color: data.color, // null means "clear color", string means "set color"
      showArtifactsCount: data.showArtifactsCount,
      defaultViewMode: data.defaultViewMode,
      defaultListGroupBy: data.defaultListGroupBy,
      defaultBoardGroupBy: data.defaultBoardGroupBy,
      defaultBoardRowGroupBy: data.defaultBoardRowGroupBy,
    });
    toast.success("Project settings updated");
  };

  // One Save covers the form fields and the project key.
  const handleSubmit = async (data: GeneralFormValues) => {
    if (!project) return;

    setIsSubmitting(true);
    try {
      if (form.formState.isDirty) {
        await saveFields(data);
      }
      if (isAliasDirty && isAliasValid) {
        await updateAlias({ id: project._id, alias });
        toast.success("Project key updated");
        onAliasChanged?.(alias);
      }
      onSaved?.();
    } catch (error) {
      console.error("Failed to update project:", error);
      showConvexErrorToast(error, "Failed to update project settings");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Loading state when project is loading
  if (project === undefined) {
    return (
      <div className="space-y-6" aria-label="Loading project settings">
        <div className="space-y-8">
          <div className="space-y-4">
            <Skeleton className="h-4 w-24 rounded-sm" />
            <div className="flex gap-2">
              <Skeleton className="size-9 rounded-md" />
              <Skeleton className="h-9 flex-1 rounded-md" />
            </div>
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-4 w-28 rounded-sm" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        </div>
      </div>
    );
  }

  // No project selected
  if (project === null) {
    return (
      <p className="text-sm text-muted-foreground">No project selected.</p>
    );
  }

  const color = form.watch("color");
  const boardColumns = form.watch("defaultBoardGroupBy");

  return (
    <div className="space-y-6">
      {!canEdit && (
        <div className="rounded-lg border border-info/40 bg-info-soft p-3">
          <p className="text-sm text-info-foreground">
            Only Project Admins can edit project settings.
          </p>
        </div>
      )}

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-8"
        >
          {/* Name, Description, Color */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Project name</Label>
              <div className="flex gap-2">
                <ColorPicker
                  value={color}
                  onChange={(c) => form.setValue("color", c, { shouldDirty: true })}
                  disabled={isSubmitting || !canEdit}
                />
                <FormFieldExt
                  control={form.control}
                  name="name"
                  className="flex-1"
                  render={({ field }) => (
                    <Input
                      placeholder="Enter project name"
                      {...field}
                      disabled={isSubmitting || !canEdit}
                    />
                  )}
                />
              </div>
            </div>

            <FormFieldExt
              control={form.control}
              name="description"
              label="Description"
              render={({ field }) => (
                <Textarea
                  placeholder="What is this project about?"
                  rows={3}
                  {...field}
                  disabled={isSubmitting || !canEdit}
                />
              )}
            />

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label>Default view</Label>
                <p className="text-sm text-muted-foreground">
                  The view this project opens with.
                </p>
              </div>
              <FormFieldExt
                control={form.control}
                name="defaultViewMode"
                className="shrink-0"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={isSubmitting || !canEdit}>
                    <SelectTrigger aria-label="Default view" variant="badge">
                      <SelectValue>{field.value === "board" ? "Board" : "List"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="list">List</SelectItem>
                      <SelectItem value="board">Board</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label>Default list grouping</Label>
                <p className="text-sm text-muted-foreground">
                  How the list view groups tasks.
                </p>
              </div>
              <FormFieldExt
                control={form.control}
                name="defaultListGroupBy"
                className="shrink-0"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={isSubmitting || !canEdit}>
                    <SelectTrigger aria-label="Default list grouping" variant="badge">
                      <SelectValue>{field.value === "none" ? "No grouping" : `by ${groupByLabel(field.value)}`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No grouping</SelectItem>
                      {BOARD_GROUP_BY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label>Default board grouping</Label>
                <p className="text-sm text-muted-foreground">
                  Columns and rows of the Board view.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <FormFieldExt
                  control={form.control}
                  name="defaultBoardGroupBy"
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(value) => {
                        // Like the board: choosing the rows dimension swaps the axes.
                        if (value === form.getValues("defaultBoardRowGroupBy")) {
                          form.setValue("defaultBoardRowGroupBy", field.value, { shouldDirty: true });
                        }
                        field.onChange(value);
                      }}
                      disabled={isSubmitting || !canEdit}
                    >
                      <SelectTrigger aria-label="Default board columns" variant="badge">
                        <SelectValue>{`Columns by ${groupByLabel(field.value)}`}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {BOARD_GROUP_BY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FormFieldExt
                  control={form.control}
                  name="defaultBoardRowGroupBy"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={isSubmitting || !canEdit}>
                      <SelectTrigger aria-label="Default board rows" variant="badge">
                        <SelectValue>{field.value === "none" ? "No rows" : `Rows by ${groupByLabel(field.value)}`}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No rows</SelectItem>
                        {BOARD_GROUP_BY_OPTIONS.filter((option) => option.value !== boardColumns).map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label>Show resource count in task list</Label>
                <p className="text-sm text-muted-foreground">
                  Display a paperclip with the number of attachments and artifacts after the task name.
                </p>
              </div>
              <FormFieldExt
                control={form.control}
                name="showArtifactsCount"
                className="shrink-0"
                render={({ field }) => (
                  <Switch
                    aria-label="Show resource count in task list"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isSubmitting || !canEdit}
                    className="cursor-pointer"
                  />
                )}
              />
            </div>
          </div>

          <Separator />

          {/* Identifier / Project Key */}
          <div>
            <div className="space-y-2">
              <Label htmlFor="project-alias">Project key</Label>
              <div className="flex gap-2 items-center">
                <Input
                  id="project-alias"
                  value={alias}
                  onChange={(e) => handleAliasChange(e.target.value)}
                  placeholder="ABC"
                  maxLength={5}
                  className="w-24 font-mono uppercase"
                  disabled={isSubmitting || !canEdit}
                />
                <div className="flex-1 flex items-center">
                  <span className="text-sm text-muted-foreground">
                    Task IDs will look like:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {alias || "ABC"}-123
                    </span>
                  </span>
                </div>
              </div>
              {alias && !isAliasValid && (
                <p className="text-xs text-destructive">
                  Must be 2-5 characters, start with a letter, uppercase only.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-warning/40 bg-warning-soft p-3 mt-3">
              <p className="text-xs text-warning-foreground">
                <strong>Warning:</strong> Changing the project key will affect all
                existing task references.
              </p>
            </div>
          </div>

          <SettingsActions>
            <ActionButton
              type="submit"
              busy={isSubmitting}
              disabled={
                !canEdit ||
                (!form.formState.isDirty && !isAliasDirty) ||
                (isAliasDirty && !isAliasValid)
              }
              showIcon={false}
            >
              Save
            </ActionButton>
          </SettingsActions>
        </form>
      </Form>
    </div>
  );
}
