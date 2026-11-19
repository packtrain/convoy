import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Playground · Convoy",
  robots: { index: false, follow: false },
};

const previews = [
  { href: "/playground/self-hosting", title: "Self-hosting diagram", description: "Your web app and backend, the machines that connect to them and what stays external." },
  { href: "/playground/project-organization", title: "Project organization preview", description: "Explore a project in Table and Kanban views, expand subtasks and open task details." },
  { href: "/playground/task-assignment", title: "Task assignment preview", description: "Choose a project agent while keeping a teammate responsible for the task." },
  { href: "/playground/remote-thread", title: "Remote thread preview", description: "Follow an agent on a connected machine from a mobile web conversation." },
  { href: "/playground/agent-threads", title: "Agent threads preview", description: "One thread in the centre and the agent threads it started and messages on both sides." },
  { href: "/playground/thread-groups", title: "Thread groups preview", description: "Related conversations in a thread container with tabs at the top." },
  { href: "/playground/task-artifacts", title: "Task artifacts preview", description: "Plans, reports and handoffs listed on a task, with the selected document open." },
  { href: "/playground/artifact-review", title: "Artifact review preview", description: "A plan, a highlighted passage and the feedback attached to it." },
  { href: "/playground/pull-request", title: "Pull request review preview", description: "A pull request's checks and Activity, its Guide, and Reviewed marks on the diff." },
  { href: "/playground/watch-tower", title: "Watch Tower preview", description: "Runs waiting for input, failed runs and work ready for review across projects." },
  {
    href: "/playground/skills-agents",
    title: "Skills and agents preview",
    description: "Reusable review procedures and the instructions that guide a project agent.",
  },
  {
    href: "/playground/hero",
    title: "Hero application preview",
    description: "Explore threads, conversations and task details in the full application frame.",
  },
  {
    href: "/playground/workflows",
    title: "Workflow section preview",
    description: "Agent prompts, human approval and Bash checks, with parallel reviews.",
  },
];

export default function PlaygroundPage() {
  return (
    <main className="mx-auto max-w-[1040px] px-3 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <p className="mb-2 text-xs text-[#8f94a1]">Convoy playground</p>
        <h1 className="text-2xl font-medium tracking-tight">Product previews</h1>
        <p className="mt-3 text-sm text-[#8f94a1]">Review the UI scenes for the landing page.</p>
      </header>
      <nav aria-label="Product previews" className="grid gap-4 sm:grid-cols-2">
        {previews.map((preview) => (
          <Link key={preview.href} href={preview.href} className="group rounded-xl border border-white/10 bg-[#151418] p-6 transition-colors hover:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-500">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-medium tracking-tight">{preview.title}</h2>
              <ArrowUpRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#8f94a1] group-hover:text-white" />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#a8a5ae]">{preview.description}</p>
          </Link>
        ))}
      </nav>
    </main>
  );
}
