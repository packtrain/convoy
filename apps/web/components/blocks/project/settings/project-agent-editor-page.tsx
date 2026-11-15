"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAppConvexAuth } from "@/lib/auth/hooks";

import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import {
  AgentForm,
  EMPTY_AGENT_FORM_VALUES,
  type AgentFormValues,
} from "@/components/blocks/agents/agent-form";
import {
  AgentAutomationFields,
  automationToDraft,
  draftToAutomation,
  type AgentAutomationDraft,
} from "@/components/blocks/agents/agent-automation-fields";
import { useAgentFormSubmission } from "@/components/blocks/agents/agent-form-submission";
import { AgentReadonlyDetail } from "@/components/blocks/organization/settings/agents/agent-readonly-detail";
import {
  SettingsPageContainer,
  SettingsPageHeader,
  SettingsTwoColumnSection,
} from "@/components/custom/settings-layout";
import { NotFoundState } from "@/components/blocks/not-found-state";
import { Button } from "@/components/ui/button";
import { SettingsCatalogEditorSkeleton } from "@/components/blocks/settings-catalog/settings-catalog-skeletons";
import {
  agentFormValuesToCreateFields,
  agentFormValuesToUpdateFields,
} from "@/components/blocks/agents/agent-form-values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProjectPermissions } from "@/lib/authz/use-project-permissions";
import { showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";

type ProjectAgentEditorPageProps =
  | { mode: "create" }
  | { mode: "detail"; projectAgentId: string };

export function ProjectAgentEditorPage({
  organizationSlug,
  projectAlias,
  ...props
}: ProjectAgentEditorPageProps & {
  organizationSlug: string;
  projectAlias: string;
}) {
  const navigation = useNavigation();
  const { isAuthenticated } = useAppConvexAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [automationDraft, setAutomationDraft] =
    useState<AgentAutomationDraft | null>(null);

  const org = useQuery(
    api.organizations.core.getBySlug,
    isAuthenticated ? { slug: organizationSlug } : "skip"
  );
  const project = useQuery(
    api.projects.core.getByAlias,
    org ? { organizationId: org._id, alias: projectAlias } : "skip"
  );
  const projectId = project?._id ?? null;
  const organizationId = org?._id ?? null;
  const { canManageProjectAgents } = useProjectPermissions(projectId);

  const projectAgentId =
    props.mode === "detail"
      ? (props.projectAgentId as Id<"projectAgents">)
      : null;
  const agent = useQuery(
    api.agents.projectAgents.get,
    projectAgentId ? { projectAgentId } : "skip"
  );
  const createProjectAgent = useMutation(api.agents.projectAgents.create);
  const updateProjectAgent = useMutation(api.agents.projectAgents.update);
  const deleteProjectAgent = useMutation(
    api.agents.projectAgents.deleteProjectAgent
  );
  const { isSubmitting, submitAgentForm } = useAgentFormSubmission(
    "Could not save project agent"
  );

  const canManage = canManageProjectAgents;
  const backTarget = appRoute.projectSettings(
    organizationSlug,
    projectAlias,
    "agents"
  );
  const pageTitle = props.mode === "create" ? "New agent" : "Edit agent";
  const initialValues = useMemo<AgentFormValues>(() => {
    if (props.mode === "create" || !agent) {
      return EMPTY_AGENT_FORM_VALUES;
    }

    return {
      name: agent.name,
      description: agent.description ?? "",
      category: agent.category ?? "",
      prompt: agent.prompt ?? "",
      appearance: agent.appearance,
    };
  }, [agent, props.mode]);
  const resolvedAutomationDraft =
    automationDraft ?? automationToDraft(agent?.automation);

  function goBack() {
    navigation.push(backTarget);
  }

  async function handleCreate(values: AgentFormValues) {
    if (!projectId) {
      return;
    }

    await submitAgentForm(async () => {
      const automation = draftToAutomation(resolvedAutomationDraft);
      await createProjectAgent({
        projectId,
        ...agentFormValuesToCreateFields(values),
        ...(automation ? { automation } : {}),
      });
      goBack();
    });
  }

  async function handleUpdate(values: AgentFormValues) {
    if (!projectAgentId) {
      return;
    }

    await submitAgentForm(async () => {
      await updateProjectAgent({
        projectAgentId,
        ...agentFormValuesToUpdateFields(values),
        automation: draftToAutomation(resolvedAutomationDraft),
      });
      goBack();
    });
  }

  async function handleDelete() {
    if (!projectAgentId) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteProjectAgent({ projectAgentId });
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not delete project agent");
    } finally {
      setIsDeleting(false);
    }
  }

  const isLoading =
    project === undefined ||
    (props.mode === "detail" && agent === undefined);

  if (isLoading) {
    return (
      <SettingsCatalogEditorSkeleton label="Loading agent" />
    );
  }

  if (props.mode === "create" && !canManage) {
    return (
      <SettingsPageContainer className="space-y-4 rounded-lg border border-border p-6">
        <h1 className="text-xl font-semibold">Agents</h1>
        <p className="text-sm text-muted-foreground">
          You do not have permission to create project agents.
        </p>
        <Button type="button" variant="outline" onClick={goBack}>
          Back
        </Button>
      </SettingsPageContainer>
    );
  }

  if (props.mode === "detail" && agent === null) {
    return (
      <NotFoundState
        title="Agent not found"
        action={
          <Button type="button" variant="outline" onClick={goBack}>
            Back
          </Button>
        }
      />
    );
  }

  if (props.mode === "detail" && agent && !canManage) {
    return (
      <div
        data-testid="project-agent-editor-page"
        data-mode="detail"
        data-agent-id={props.projectAgentId}
      >
        <AgentReadonlyDetail agent={agent} onBack={goBack} />
      </div>
    );
  }

  return (
    <div
      data-testid="project-agent-editor-page"
      data-mode={props.mode}
      data-agent-id={props.mode === "detail" ? props.projectAgentId : undefined}
    >
      <SettingsPageContainer className="flex flex-1 flex-col gap-6">
        <SettingsPageHeader
          title={pageTitle}
          backLink={{ href: backTarget, label: "Back to agents" }}
        />
        <AgentForm
          mode={props.mode === "create" ? "create" : "edit"}
          layout="settings-page"
          initialValues={initialValues}
          canManage={canManage}
          isSubmitting={isSubmitting}
          onSubmit={props.mode === "create" ? handleCreate : handleUpdate}
          onCancel={goBack}
          onDelete={
            props.mode === "detail" ? () => setDeleteOpen(true) : undefined
          }
          extraSettingsPageSection={
            organizationId && projectId ? (
              <SettingsTwoColumnSection
                title="Automation"
                description="Optionally start a thread when a task is assigned to this agent."
              >
                <AgentAutomationFields
                  key={projectAgentId ?? "new"}
                  organizationId={organizationId}
                  projectId={projectId}
                  value={resolvedAutomationDraft}
                  onChange={(patch) =>
                    setAutomationDraft((previous) => ({
                      ...(previous ?? automationToDraft(agent?.automation)),
                      ...patch,
                    }))
                  }
                  disabled={!canManage || isSubmitting}
                />
              </SettingsTwoColumnSection>
            ) : null
          }
        />
      </SettingsPageContainer>
      {props.mode === "detail" && agent ? (
        <SettingsCatalogDeleteDialog
          title="Delete project agent?"
          description={`Delete ${agent.name}? Existing task assignments will keep their stored reference.`}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      ) : null}
    </div>
  );
}
