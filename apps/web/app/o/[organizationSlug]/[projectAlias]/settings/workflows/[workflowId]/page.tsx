import { WorkflowEditorPage } from "@/components/blocks/workflows/workflow-editor-page";

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{
    organizationSlug: string;
    projectAlias: string;
    workflowId: string;
  }>;
}) {
  const { organizationSlug, projectAlias, workflowId } = await params;

  return (
    // No padding: the editor's divider column must run edge to edge.
    <main className="flex min-h-0 w-full flex-1 flex-col">
      {/* Keyed so navigating between workflows can't carry one draft's local
          grid state onto another workflow's Save. */}
      <WorkflowEditorPage
        key={workflowId}
        mode="detail"
        workflowId={workflowId}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
      />
    </main>
  );
}
