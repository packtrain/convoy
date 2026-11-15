import { WorkflowEditorPage } from "@/components/blocks/workflows/workflow-editor-page";

export default async function NewWorkflowPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; projectAlias: string }>;
}) {
  const { organizationSlug, projectAlias } = await params;

  return (
    // No padding: the editor's divider column must run edge to edge.
    <main className="flex min-h-0 w-full flex-1 flex-col">
      <WorkflowEditorPage
        mode="create"
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
      />
    </main>
  );
}
