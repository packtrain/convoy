"use client";

import { Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { useMutation, useQuery } from "convex/react";
import { useAppConvexAuth } from "@/lib/auth/hooks";

import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FormFieldExt } from "@/components/custom/form-field-ext";
import { ColorPicker } from "@/components/custom/color-picker";
import {
  SettingsActions,
  SettingsPageContainer,
  SettingsPageHeader,
} from "@/components/custom/settings-layout";
import { NotFoundState } from "@/components/blocks/not-found-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowGrid } from "@/components/blocks/workflows/workflow-grid";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { WorkflowDefinition } from "@/convex/lib/contracts/workflowDefinition";
import { sameStoredValue } from "@/convex/lib/shared/patch";
import { normalizeWorkflowDefinition } from "@/convex/workflows/lib/normalize";
import { createSeedDefinition } from "@/lib/workflows/draft";
import { AGENT_COLOR_PALETTE } from "@/lib/colors/palette";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation, useUnsavedChangesGuard } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const workflowFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().max(2000).optional(),
  category: z.string().max(60).optional(),
  color: z
    .string()
    .nullable()
    .refine(
      (color) => color === null || AGENT_COLOR_PALETTE.some((paletteColor) => paletteColor === color),
      "Choose a supported color"
    ),
});

type WorkflowFormValues = z.infer<typeof workflowFormSchema>;

const EMPTY_WORKFLOW_FORM_VALUES: WorkflowFormValues = {
  name: "",
  description: "",
  category: "",
  color: AGENT_COLOR_PALETTE[0],
};

type WorkflowEditorPageProps =
  | { mode: "create" }
  | { mode: "detail"; workflowId: string };

export function WorkflowEditorPage({
  organizationSlug,
  projectAlias,
  ...props
}: WorkflowEditorPageProps & {
  organizationSlug: string;
  projectAlias: string;
}) {
  const navigation = useNavigation();
  const { isAuthenticated } = useAppConvexAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const org = useQuery(api.organizations.core.getBySlug, isAuthenticated ? { slug: organizationSlug } : "skip");
  const project = useQuery(api.projects.core.getByAlias, org ? { organizationId: org._id, alias: projectAlias } : "skip");
  const projectId = project?._id ?? null;
  const { canManageWorkflows, isLoading: permissionsLoading } = useProjectPermissions(projectId);

  const workflowId = props.mode === "detail" ? (props.workflowId as Id<"workflows">) : null;
  const workflow = useQuery(api.workflows.core.get, workflowId ? { workflowId } : "skip");
  // Offered by the lane settings (single-lane defaults) and the parallel
  // Prompt dialog (per-step agent override).
  const projectAgents = useQuery(api.agents.projectAgents.listByProject, projectId ? { projectId } : "skip");

  // The grid edits a local copy of the draft, persisted only by Save. Create
  // mode starts from the seed; detail mode seeds once when the workflow loads.
  // The starter lane + stage is an authoring convenience, so an empty stored
  // draft is seeded only for members who can actually save it.
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(() =>
    props.mode === "create" ? createSeedDefinition() : null
  );
  useEffect(() => {
    if (props.mode !== "detail" || !workflow || definition !== null || permissionsLoading) {
      return;
    }
    const stored = workflow.draftDefinition;
    const isEmpty = stored.lanes.length === 0 && stored.stages.length === 0;
    setDefinition(isEmpty && canManageWorkflows ? createSeedDefinition() : stored);
  }, [props.mode, workflow, definition, permissionsLoading, canManageWorkflows]);
  // The definition as loaded or seeded, for the leave guard's comparison. Save
  // navigates away, so it never needs re-baselining.
  const savedDefinition = useRef<WorkflowDefinition | null>(null);
  useEffect(() => {
    savedDefinition.current ??= definition;
  }, [definition]);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const definitionDirty =
    definition !== null &&
    savedDefinition.current !== null &&
    !sameStoredValue(normalizeWorkflowDefinition(definition), normalizeWorkflowDefinition(savedDefinition.current));
  // Only a member who could save has something to lose; a Save in flight is
  // about to navigate on its own.
  const leaveGuard = useUnsavedChangesGuard(
    canManageWorkflows && !isSubmitting && (isFormDirty || definitionDirty)
  );

  const createWorkflow = useMutation(api.workflows.core.create);
  const updateWorkflow = useMutation(api.workflows.core.update);
  const removeWorkflow = useMutation(api.workflows.core.remove);

  const backTarget = appRoute.projectSettings(organizationSlug, projectAlias, "workflows");
  const initialValues = useMemo<WorkflowFormValues>(() => {
    if (props.mode === "create" || !workflow) {
      return EMPTY_WORKFLOW_FORM_VALUES;
    }

    return {
      name: workflow.name,
      description: workflow.description ?? "",
      category: workflow.category ?? "",
      color: workflow.color ?? null,
    };
  }, [props.mode, workflow]);

  function goBack() {
    navigation.push(backTarget);
  }

  async function handleSubmit(values: WorkflowFormValues) {
    setIsSubmitting(true);
    try {
      if (props.mode === "create") {
        // Create mode always has the seed definition; the server requires one.
        if (!projectId || !definition) {
          return;
        }
        await createWorkflow({
          projectId,
          name: values.name,
          description: values.description?.trim() ? values.description : undefined,
          category: values.category?.trim() ? values.category : undefined,
          color: values.color ?? undefined,
          definition,
        });
      } else {
        if (!workflowId) {
          return;
        }
        await updateWorkflow({
          workflowId,
          name: values.name,
          description: values.description?.trim() ? values.description : null,
          category: values.category?.trim() ? values.category : null,
          color: values.color,
          // One atomic Save: identity + definition together. The server sets
          // the dirty flag only when the definition actually changed.
          definition: definition ?? undefined,
        });
      }
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not save workflow");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!workflowId) {
      return;
    }

    setIsDeleting(true);
    try {
      await removeWorkflow({ workflowId });
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not delete workflow");
    } finally {
      setIsDeleting(false);
    }
  }

  // Permission loading is not a denial: hold the skeleton until the role settles.
  const isLoading =
    project === undefined ||
    (project != null && permissionsLoading) ||
    (props.mode === "detail" && workflow === undefined);
  // A workflow from another project renders as not found: `get` authorizes
  // against the workflow's own project, not the URL's.
  const workflowMismatch = workflow != null && projectId !== null && workflow.projectId !== projectId;

  // The page wrapper has no padding (the divider column runs edge to edge),
  // so the non-editor branches pad themselves.
  const standalonePadding = "w-full px-6 pt-10 md:pt-12";

  if (isLoading) {
    return <WorkflowEditorSkeleton />;
  }

  if (props.mode === "create" && !canManageWorkflows) {
    return (
      <div className={standalonePadding}>
        <SettingsPageContainer className="space-y-4 rounded-lg border border-border p-6">
          <h1 className="text-xl font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground">You do not have permission to create workflows.</p>
          <Button type="button" variant="outline" onClick={goBack}>
            Back
          </Button>
        </SettingsPageContainer>
      </div>
    );
  }

  if (props.mode === "detail" && (workflow === null || workflowMismatch)) {
    return (
      <div className={standalonePadding}>
        <NotFoundState
          title="Workflow not found"
          action={
            <Button type="button" variant="outline" onClick={goBack}>
              Back
            </Button>
          }
        />
      </div>
    );
  }

  return (
    // Full width, no boxed section: the identity form is the future grid's
    // first column (see /playground/workflow-editor), divided from the grid area.
    <div
      data-testid="workflow-editor-page"
      data-mode={props.mode}
      className="flex min-h-0 w-full flex-1 flex-col md:flex-row"
    >
      <div className="flex w-full shrink-0 flex-col gap-6 border-r border-border p-6 md:w-84">
        <SettingsPageHeader
          title={props.mode === "create" ? "New workflow" : "Edit workflow"}
          backLink={{ href: backTarget, label: "Back to workflows" }}
        />
        <WorkflowForm
          mode={props.mode === "create" ? "create" : "edit"}
          initialValues={initialValues}
          canManage={canManageWorkflows}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          onDelete={props.mode === "detail" ? () => setDeleteOpen(true) : undefined}
          onDirtyChange={setIsFormDirty}
          runInNewWorktree={definition?.runInNewWorktree === true}
          onRunInNewWorktreeChange={(checked) =>
            setDefinition((current) => current && { ...current, runInNewWorktree: checked || undefined })
          }
        />
      </div>
      {definition ? (
        // Flush like a kanban board: no padding, the grid touches the form
        // column's divider, the top, and the bottom of the content area.
        <WorkflowGrid
          className="min-h-0 min-w-0 flex-1"
          definition={definition}
          onChange={canManageWorkflows ? setDefinition : undefined}
          disabled={isSubmitting}
          composer={org && projectId ? { organizationId: org._id, projectId } : undefined}
          projectAgents={projectAgents ?? []}
        />
      ) : null}
      {leaveGuard.blockedHref ? (
        <ConfirmDialog
          open
          size="md"
          title="Unsaved changes"
          description="This workflow has changes that are not saved yet. Save them first, or leave and lose them."
          cancel={{ label: "Stay" }}
          // `leave` clears the block itself, so the dialog must not also "stay".
          confirm={{
            label: "Leave without saving",
            variant: "destructive",
            autoCloseOnClick: false,
            onClick: leaveGuard.leave,
          }}
          onClose={leaveGuard.stay}
        />
      ) : null}
      {props.mode === "detail" && workflow ? (
        <SettingsCatalogDeleteDialog
          title="Delete workflow?"
          description={`Delete ${workflow.name}? This cannot be undone.`}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      ) : null}
    </div>
  );
}

/** Mirrors the loaded editor: the form column plus the Stage × Lane grid. */
function WorkflowEditorSkeleton() {
  const lanes = [0, 1];
  const stages = [0, 1, 2];

  return (
    <div aria-label="Loading workflow" className="flex min-h-0 w-full flex-1 flex-col md:flex-row">
      <div className="flex w-full shrink-0 flex-col gap-6 border-r border-border p-6 md:w-84">
        <div className="space-y-3">
          <Skeleton className="h-4 w-32 rounded-sm" />
          <Skeleton className="h-7 w-40 rounded-sm" />
        </div>
        <div className="flex w-full max-w-72 flex-col gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-12 rounded-sm" />
            <div className="flex gap-2">
              <Skeleton className="size-9 shrink-0 rounded-md" />
              <Skeleton className="h-9 flex-1 rounded-md" />
            </div>
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16 rounded-sm" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20 rounded-sm" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-4 w-36 rounded-sm" />
          </div>
          <Skeleton className="h-9 w-16 self-end rounded-md" />
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          className="grid min-h-full min-w-max"
          style={{
            gridTemplateColumns: `14rem repeat(${lanes.length}, 20rem) minmax(10rem, 1fr)`,
            gridTemplateRows: `repeat(${1 + stages.length}, max-content) minmax(0, 1fr)`,
          }}
        >
          <div className="flex items-center border-b border-r border-border bg-muted px-3 py-2 dark:bg-background">
            <Skeleton className="h-4 w-12 rounded-sm" />
          </div>
          {lanes.map((lane) => (
            <div
              key={lane}
              className="flex items-center gap-2 border-b border-r border-border bg-muted/95 px-3 py-2 dark:bg-background/95"
            >
              <Skeleton className="h-4 w-20 rounded-sm" />
              <Skeleton className="ml-auto h-4 w-24 rounded-sm" />
            </div>
          ))}
          <div className="border-b border-border bg-muted/95 dark:bg-background/95" />

          {stages.map((stage) => {
            const altBg = stage % 2 === 1 && "bg-muted/60 dark:bg-muted/60";
            return (
              <Fragment key={stage}>
                <div className={cn("border-r border-border p-3", altBg)}>
                  <Skeleton className="h-5 w-16 rounded-sm" />
                </div>
                {lanes.map((lane) => (
                  <div key={lane} className={cn("border-r border-border p-3", altBg)}>
                    {/* Only the first stage is pre-filled: cells are empty far more often. */}
                    {stage === 0 ? <Skeleton className="h-24 w-full rounded-lg" /> : null}
                  </div>
                ))}
                <div className={cn(altBg)} />
              </Fragment>
            );
          })}

          <div className="border-r border-border" />
          {lanes.map((lane) => (
            <div key={lane} className="border-r border-border" />
          ))}
          <div />
        </div>
      </div>
    </div>
  );
}

function WorkflowForm({
  mode,
  initialValues,
  canManage,
  isSubmitting,
  onSubmit,
  onDelete,
  onDirtyChange,
  runInNewWorktree,
  onRunInNewWorktreeChange,
}: {
  mode: "create" | "edit";
  initialValues: WorkflowFormValues;
  canManage: boolean;
  isSubmitting: boolean;
  onSubmit: (values: WorkflowFormValues) => Promise<void>;
  onDelete?: () => void;
  /** Feeds the page's leave guard — the form owns react-hook-form's dirty state. */
  onDirtyChange: (dirty: boolean) => void;
  runInNewWorktree: boolean;
  onRunInNewWorktreeChange: (checked: boolean) => void;
}) {
  const form = useForm<WorkflowFormValues>({
    resolver: zodResolver(workflowFormSchema),
    defaultValues: initialValues,
  });

  useEffect(() => {
    form.reset(initialValues);
  }, [form, initialValues]);

  const { isDirty } = form.formState;
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const disabled = !canManage || isSubmitting || form.formState.isSubmitting;

  return (
    <Form {...form}>
      {/* One narrow stacked column, mirroring the grid editor's props column. */}
      <form className="flex w-full max-w-72 flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <div className="flex gap-2">
                <FormField
                  control={form.control}
                  name="color"
                  render={({ field: colorField }) => (
                    <ColorPicker
                      value={colorField.value}
                      onChange={colorField.onChange}
                      allowEmpty
                      palette="extended"
                      columns={8}
                      disabled={disabled}
                      triggerAriaLabel="Select workflow color"
                      triggerClassName="shrink-0"
                    />
                  )}
                />
                <FormControl>
                  <Input {...field} disabled={disabled} placeholder="Release Train" />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormFieldExt
          control={form.control}
          name="category"
          label="Category"
          render={({ field }) => <Input {...field} disabled={disabled} value={field.value ?? ""} placeholder="Delivery" />}
        />

        <FormFieldExt
          control={form.control}
          name="description"
          label="Description"
          render={({ field }) => (
            <Textarea {...field} rows={4} disabled={disabled} value={field.value ?? ""} placeholder="Ships a release end to end." />
          )}
        />

        {/* Lives inside the definition, not on the identity (workflow-data-schema.md). */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="workflow-run-in-new-worktree"
            checked={runInNewWorktree}
            disabled={disabled}
            className="cursor-pointer"
            onCheckedChange={(checked) => onRunInNewWorktreeChange(checked === true)}
          />
          <Label htmlFor="workflow-run-in-new-worktree" className="cursor-pointer text-sm font-normal">
            Run in a new worktree
          </Label>
        </div>

        <SettingsActions
          start={
            mode === "edit" && onDelete && canManage ? (
              <Button type="button" variant="destructive" disabled={disabled} onClick={onDelete}>
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : null
          }
        >
          {canManage ? (
            <Button type="submit" disabled={disabled}>
              {mode === "create" ? "Create" : "Save"}
            </Button>
          ) : null}
        </SettingsActions>
      </form>
    </Form>
  );
}
