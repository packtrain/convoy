"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import { SlashCommandForm, type SlashCommandFormValues } from "./slash-command-form";
import { getSlashCommandDisplayKey } from "./slash-command-list-utils";
import { SlashCommandReadonlyDetail } from "./slash-command-readonly-detail";
import { SettingsPageContainer, SettingsPageHeader } from "@/components/custom/settings-layout";
import { NotFoundState } from "@/components/blocks/not-found-state";
import { Button } from "@/components/ui/button";
import { SettingsCatalogEditorSkeleton } from "@/components/blocks/settings-catalog/settings-catalog-skeletons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgPermission, ProjectPermission, hasOrgPermission, hasProjectPermission } from "@/lib/authz/permissions";
import { appRoute, useNavigation } from "@/lib/navigation";
import { useCurrentOrgProject } from "@/lib/routing/current-org-project-context";
import { showConvexErrorToast } from "@/lib/errors";

type SlashCommandEditorPageProps =
  & ({ mode: "create" } | { mode: "detail"; slashCommandId: string })
  & { scope?: "organization" | "project" };

const CREATE_INITIAL_VALUES: SlashCommandFormValues = {
  key: "",
  description: "",
  category: "",
  autoExpand: false,
  autoSubmit: false,
  content: "",
};

export function SlashCommandEditorPage(props: SlashCommandEditorPageProps) {
  const navigation = useNavigation();
  const { organizationId, organizationSlug, projectAlias } = useCurrentOrgProject();
  const scope = props.scope ?? "organization";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const project = useQuery(
    api.projects.core.getByAlias,
    scope === "project" && projectAlias ? { organizationId, alias: projectAlias } : "skip"
  );
  const projectId = project?._id;
  const orgRole = useQuery(api.organizations.members.getMyRole, scope === "organization" ? { organizationId } : "skip");
  const projectRole = useQuery(api.projects.members.getMyRole, projectId ? { projectId } : "skip");
  const slashCommandId = props.mode === "detail" ? (props.slashCommandId as Id<"slashCommands">) : null;
  const command = useQuery(api.slashCommands.core.get, slashCommandId ? { slashCommandId } : "skip");
  const createSlashCommand = useMutation(api.slashCommands.core.createInOrganization);
  const createProjectSlashCommand = useMutation(api.slashCommands.core.createInProject);
  const updateSlashCommand = useMutation(api.slashCommands.core.update);
  const deleteSlashCommand = useMutation(api.slashCommands.core.deleteSlashCommand);

  const canManage =
    scope === "project"
      ? hasProjectPermission(projectRole, ProjectPermission.SLASH_COMMANDS_MANAGE)
      : hasOrgPermission(orgRole, OrgPermission.SLASH_COMMANDS_MANAGE);
  const backTarget =
    scope === "project" && projectAlias
      ? appRoute.projectSettings(organizationSlug, projectAlias, "prompts")
      : appRoute.organizationPrompts(organizationSlug);
  const scopedCommand =
    command &&
    command.scope === scope &&
    (scope !== "project" || command.projectId === projectId)
      ? command
      : null;
  const pageTitle = props.mode === "create" ? "New prompt" : "Edit prompt";
  const initialValues = useMemo<SlashCommandFormValues>(() => {
    if (props.mode === "create" || !scopedCommand) {
      return CREATE_INITIAL_VALUES;
    }

    return {
      key: scopedCommand.key,
      description: scopedCommand.description ?? "",
      category: scopedCommand.category ?? "",
      autoExpand: scopedCommand.autoExpand,
      autoSubmit: scopedCommand.autoSubmit ?? false,
      content: scopedCommand.content,
    };
  }, [props.mode, scopedCommand]);

  function goBack() {
    navigation.push(backTarget);
  }

  async function handleCreate(values: SlashCommandFormValues) {
    if (scope === "project" && !projectId) {
      return;
    }

    setIsSubmitting(true);
    try {
      const commandInput = {
        key: values.key,
        description: values.description?.trim() || undefined,
        category: values.category?.trim() || undefined,
        content: values.content,
        autoExpand: values.autoExpand,
        autoSubmit: values.autoSubmit,
      };
      if (scope === "project" && projectId) {
        await createProjectSlashCommand({ projectId, ...commandInput });
      } else {
        await createSlashCommand({ organizationId, ...commandInput });
      }
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not save slash command");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdate(values: SlashCommandFormValues) {
    if (!slashCommandId) {
      return;
    }

    setIsSubmitting(true);
    try {
      await updateSlashCommand({
        slashCommandId,
        key: values.key,
        description: values.description?.trim() || null,
        category: values.category?.trim() || null,
        content: values.content,
        autoExpand: values.autoExpand,
        autoSubmit: values.autoSubmit,
      });
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not save slash command");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!slashCommandId) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteSlashCommand({ slashCommandId });
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not delete slash command");
    } finally {
      setIsDeleting(false);
    }
  }

  const isLoading =
    (scope === "project" ? project === undefined || (projectId && projectRole === undefined) : orgRole === undefined) ||
    (props.mode === "detail" && command === undefined);

  if (isLoading) {
    return (
      <main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
        <SettingsCatalogEditorSkeleton label="Loading prompt" />
      </main>
    );
  }

  if (props.mode === "create" && !canManage) {
    return (
      <main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
        <SettingsPageContainer className="space-y-4 rounded-lg border border-border p-6">
          <h1 className="text-xl font-semibold">Prompts</h1>
          <p className="text-sm text-muted-foreground">You do not have permission to create prompts.</p>
          <Button type="button" variant="outline" onClick={goBack}>
            Back
          </Button>
        </SettingsPageContainer>
      </main>
    );
  }

  if (props.mode === "detail" && scopedCommand === null) {
    return (
      <main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
        <NotFoundState
          title="Prompt not found"
          action={
            <Button type="button" variant="outline" onClick={goBack}>
              Back
            </Button>
          }
        />
      </main>
    );
  }

  if (props.mode === "detail" && scopedCommand && !canManage) {
    return (
      <main
        className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12"
        data-testid="slash-command-editor-page"
        data-mode="detail"
        data-slash-command-id={props.slashCommandId}
      >
        <SlashCommandReadonlyDetail command={scopedCommand} onBack={goBack} />
      </main>
    );
  }

  return (
    <main
      className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12"
      data-testid="slash-command-editor-page"
      data-mode={props.mode}
      data-slash-command-id={props.mode === "detail" ? props.slashCommandId : undefined}
    >
      <SettingsPageContainer className="flex flex-1 flex-col gap-6">
        <SettingsPageHeader
          title={pageTitle}
          backLink={{ href: backTarget, label: "Back to prompts" }}
        />
        <SlashCommandForm
          mode={props.mode === "create" ? "create" : "edit"}
          initialValues={initialValues}
          canManage={canManage}
          isSubmitting={isSubmitting}
          onSubmit={props.mode === "create" ? handleCreate : handleUpdate}
          onCancel={goBack}
          onDelete={props.mode === "detail" ? () => setDeleteOpen(true) : undefined}
        />
      </SettingsPageContainer>
      {props.mode === "detail" && scopedCommand ? (
        <SettingsCatalogDeleteDialog
          title="Delete slash command?"
          description={`Delete ${getSlashCommandDisplayKey(scopedCommand.key)}?`}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      ) : null}
    </main>
  );
}
