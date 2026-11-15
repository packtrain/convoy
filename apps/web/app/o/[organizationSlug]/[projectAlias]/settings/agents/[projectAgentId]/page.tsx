import { ProjectAgentEditorPage } from "@/components/blocks/project/settings/project-agent-editor-page";

export default async function ProjectAgentDetailPage({
  params,
}: {
  params: Promise<{
    organizationSlug: string;
    projectAlias: string;
    projectAgentId: string;
  }>;
}) {
  const { organizationSlug, projectAlias, projectAgentId } = await params;

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
      <ProjectAgentEditorPage
        mode="detail"
        projectAgentId={projectAgentId}
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
      />
    </main>
  );
}
