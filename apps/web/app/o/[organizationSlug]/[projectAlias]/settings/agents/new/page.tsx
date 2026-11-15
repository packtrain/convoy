import { ProjectAgentEditorPage } from "@/components/blocks/project/settings/project-agent-editor-page";

export default async function NewProjectAgentPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; projectAlias: string }>;
}) {
  const { organizationSlug, projectAlias } = await params;

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
      <ProjectAgentEditorPage
        mode="create"
        organizationSlug={organizationSlug}
        projectAlias={projectAlias}
      />
    </main>
  );
}
