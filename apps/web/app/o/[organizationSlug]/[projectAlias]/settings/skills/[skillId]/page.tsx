import { SkillEditorPage } from "@/components/blocks/organization/settings/skills/skill-editor-page";

export default async function ProjectSkillDetailPage({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const { skillId } = await params;

  return <SkillEditorPage mode="detail" scope="project" skillId={skillId} />;
}
