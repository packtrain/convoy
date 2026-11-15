"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { SettingsCatalogDeleteDialog } from "@/components/blocks/settings-catalog/settings-catalog-delete-dialog";
import {
  AgentForm,
  EMPTY_AGENT_FORM_VALUES,
  type AgentFormValues,
} from "@/components/blocks/agents/agent-form";
import { useAgentFormSubmission } from "@/components/blocks/agents/agent-form-submission";
import { AgentReadonlyDetail } from "./agent-readonly-detail";
import {
  SettingsPageContainer,
  SettingsPageHeader,
} from "@/components/custom/settings-layout";
import { NotFoundState } from "@/components/blocks/not-found-state";
import { Button } from "@/components/ui/button";
import { SettingsCatalogEditorSkeleton } from "@/components/blocks/settings-catalog/settings-catalog-skeletons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgPermission, hasOrgPermission } from "@/lib/authz/permissions";
import {
  agentFormValuesToCreateFields,
  agentFormValuesToUpdateFields,
} from "@/components/blocks/agents/agent-form-values";
import { showConvexErrorToast } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";
import { useCurrentOrgProject } from "@/lib/routing/current-org-project-context";

type AgentEditorPageProps =
  | { mode: "create" }
  | { mode: "detail"; agentId: string };

export function AgentEditorPage(props: AgentEditorPageProps) {
  const navigation = useNavigation();
  const { organizationId, organizationSlug } = useCurrentOrgProject();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const myRole = useQuery(api.organizations.members.getMyRole, {
    organizationId,
  });
  const agentId =
    props.mode === "detail" ? (props.agentId as Id<"agents">) : null;
  const agent = useQuery(api.agents.core.get, agentId ? { agentId } : "skip");
  const createAgent = useMutation(api.agents.core.create);
  const updateAgent = useMutation(api.agents.core.update);
  const deleteAgent = useMutation(api.agents.core.deleteAgent);
  const { isSubmitting, submitAgentForm } =
    useAgentFormSubmission("Could not save agent");

  const canManage = hasOrgPermission(myRole, OrgPermission.AGENTS_MANAGE);
  const backTarget = appRoute.organizationAgents(organizationSlug);
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

  function goBack() {
    navigation.push(backTarget);
  }

  async function handleCreate(values: AgentFormValues) {
    await submitAgentForm(async () => {
      await createAgent({
        organizationId,
        ...agentFormValuesToCreateFields(values),
      });
      goBack();
    });
  }

  async function handleUpdate(values: AgentFormValues) {
    if (!agentId) {
      return;
    }

    await submitAgentForm(async () => {
      await updateAgent({
        agentId,
        ...agentFormValuesToUpdateFields(values),
      });
      goBack();
    });
  }

  async function handleDelete() {
    if (!agentId) {
      return;
    }

    setIsDeleting(true);
    try {
      await deleteAgent({ agentId });
      goBack();
    } catch (error) {
      showConvexErrorToast(error, "Could not delete agent");
    } finally {
      setIsDeleting(false);
    }
  }

  const isLoading =
    myRole === undefined || (props.mode === "detail" && agent === undefined);

  if (isLoading) {
    return (
      <main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
        <SettingsCatalogEditorSkeleton label="Loading agent" />
      </main>
    );
  }

  if (props.mode === "create" && !canManage) {
    return (
      <main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
        <SettingsPageContainer className="space-y-4 rounded-lg border border-border p-6">
          <h1 className="text-xl font-semibold">Agents</h1>
          <p className="text-sm text-muted-foreground">
            You do not have permission to create agents.
          </p>
          <Button type="button" variant="outline" onClick={goBack}>
            Back
          </Button>
        </SettingsPageContainer>
      </main>
    );
  }

  if (props.mode === "detail" && agent === null) {
    return (
      <main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
        <NotFoundState
          title="Agent not found"
          action={
            <Button type="button" variant="outline" onClick={goBack}>
              Back
            </Button>
          }
        />
      </main>
    );
  }

  if (props.mode === "detail" && agent && !canManage) {
    return (
      <main
        className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12"
        data-testid="agent-editor-page"
        data-mode="detail"
        data-agent-id={props.agentId}
      >
        <AgentReadonlyDetail agent={agent} onBack={goBack} />
      </main>
    );
  }

  return (
    <main
      className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12"
      data-testid="agent-editor-page"
      data-mode={props.mode}
      data-agent-id={props.mode === "detail" ? props.agentId : undefined}
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
        />
      </SettingsPageContainer>
      {props.mode === "detail" && agent ? (
        <SettingsCatalogDeleteDialog
          title="Delete agent?"
          description={`Delete ${agent.name}? Existing copied project agents will remain unchanged.`}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={handleDelete}
          isDeleting={isDeleting}
        />
      ) : null}
    </main>
  );
}
