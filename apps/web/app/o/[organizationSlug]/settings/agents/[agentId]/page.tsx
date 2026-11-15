import { AgentEditorPage } from "@/components/blocks/organization/settings/agents/agent-editor-page";

export default async function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;

  return <AgentEditorPage mode="detail" agentId={agentId} />;
}
