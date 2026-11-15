import { SlashCommandEditorPage } from "@/components/blocks/organization/settings/prompts/slash-command-editor-page";

export default async function SlashCommandDetailPage({
  params,
}: {
  params: Promise<{ slashCommandId: string }>;
}) {
  const { slashCommandId } = await params;

  return (
    <SlashCommandEditorPage
      mode="detail"
      slashCommandId={slashCommandId}
    />
  );
}
