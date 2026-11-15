import { SkillEditorPage } from "@/components/blocks/organization/settings/skills/skill-editor-page";

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const { skillId } = await params;

  return <SkillEditorPage mode="detail" skillId={skillId} />;
}
