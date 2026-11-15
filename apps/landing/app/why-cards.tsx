import { WorkflowPreview, SkillsAgentsPreview } from "@/components/product-preview";
import { WatchTowerPreview } from "@/components/product-preview/watch-tower";
import { ArtifactReviewPreview } from "@/components/product-preview/artifact-review";
import { ThreadGroupsPreview } from "@/components/product-preview/thread-groups";
import { RemoteThreadPreview } from "@/components/product-preview/remote-thread";
import { AgentThreadsPreview } from "@/components/product-preview/agent-threads";

const LINE = "border-white/[0.07]";
const DIM = "text-[#8f94a1]";

const ITEMS = [
  {
    title: "Turn a proven process into a repeatable workflow",
    body: "Define how work moves from planning to review, with agent instructions, automated checks, and human approvals along the way. Save the workflow so your team can use it on the next task.",
    preview: <WorkflowPreview />,
    scene: "workflows",
  },
  {
    title: "Stop making every team start from scratch",
    body: "Turn what works for your most successful teams into a way of working others can adopt. Share agents, skills, and workflows that cover how you plan, build, test, and review software with AI. Give teams a proven starting point they can adapt and improve together.",
    preview: <SkillsAgentsPreview />,
    scene: "skills-agents",
  },
  {
    title: "See which agents need your attention.",
    body: "Watch Tower brings your runs across an organization's projects into one place. Find unanswered questions, failures and work ready for review. Switch between List and Board views and triage runs in batches.",
    preview: <WatchTowerPreview crop />,
    scene: "watch-tower",
  },
  {
    title: "Review the work on the task",
    body: "An agent writes a plan. You comment on a passage. The agent reads your feedback and revises it. Keep that review beside the task, along with editable Markdown documents, HTML reports and interactive outputs.",
    preview: <ArtifactReviewPreview />,
    scene: "artifact-review",
  },
  {
    title: "Keep related conversations together",
    body: "Group related agent threads under one item and move between them in tabs. Share a thread or group when you want project teammates with thread access to follow along. Shared conversations are read-only for teammates.",
    preview: <ThreadGroupsPreview />,
    scene: "thread-groups",
  },
  {
    title: "Let agents work together",
    body: "An agent can start threads for other agents and send them messages. One drafts the plan, another reviews the change, and their replies come back to the thread that asked. Each message links to the thread that sent it.",
    preview: <AgentThreadsPreview />,
    scene: "agent-threads",
  },
  {
    title: "Check on your coding agent from your phone.",
    body: "Your agent works on your code on a computer or server you connect to Convoy. Open Convoy in your phone's browser to see what the agent has done, answer its questions or ask for changes.",
    preview: <RemoteThreadPreview />,
    scene: "remote-thread",
  },
];

export function WhyCards() {
  return (
    <div>
      {ITEMS.map((item) => (
        <div
          key={item.title}
          className={`border-t ${LINE} bg-[#08080d]`}
        >
          <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className={`flex min-w-0 flex-col border-white/[0.07] p-8 max-lg:border-b lg:border-r sm:p-10`}>
              <h3 className="text-[24px] font-[480] leading-snug tracking-[-0.025em] text-[#f2f3f5]">
                {item.title}
              </h3>
              <p className={`mt-4 max-w-[44ch] text-[15px] leading-relaxed ${DIM}`}>
                {item.body}
              </p>
            </div>
            <div data-preview={item.scene} className="min-w-0 self-center p-3 sm:p-6">
              {item.preview}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
