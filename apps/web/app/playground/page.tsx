import { AppLink, routeTarget } from "@/lib/navigation";

interface PlaygroundLink {
  href: string;
  title: string;
  description: string;
}

const ACTIVE_PLAYGROUNDS: PlaygroundLink[] = [
  {
    href: "/playground/tui-layout",
    title: "TUI layout",
    description: "Proposed terminal layout with titled panes, scope tabs, a command palette and a key reference, drawn at 110×34 and 80×24 next to frames from today's TUI (OS-2547).",
  },
  {
    href: "/playground/git-history",
    title: "Git history",
    description: "Commit history as a plain list (diff on the right) or a branch graph, on the worktree page and in the thread Changes tab, with the real diff renderer on fixtures (OS-2508).",
  },
  {
    href: "/playground/recurring-tasks",
    title: "Recurring tasks",
    description: "A recurring task in any list with its occurrences as subtasks: table, board, the Recurring filter, the repeat dropdown and a clock to step through slots, on local state (OS-2506).",
  },
  {
    href: "/playground/single-project-sidebar",
    title: "Single-project sidebar",
    description: "Left sidebar scoped to one project: a selector at the top, then that project's notifications, Watch Tower, threads, PRs and lists (OS-1755).",
  },
  {
    href: "/playground/software-factory",
    title: "Software factory",
    description: "Landing-page candidate: an isometric conveyor line where an agent, checks and a review gate process task cards.",
  },
  {
    href: "/playground/agent-exchange",
    title: "Agent post",
    description: "Landing-page candidate: Convoy's architecture as a pneumatic tube post, with the browser desk, the Convex sorting hub, your machine and its runtimes.",
  },
  {
    href: "/playground/watch-tower-console",
    title: "Watch Tower console",
    description: "Landing-page candidate: Watch Tower as an isometric controller's desk, a radar scope of live runs and a four-bay strip board for triage.",
  },
  {
    href: "/playground/user-environments",
    title: "User environments",
    description: "One enrolled machine offered in every project, set up on first use from the composer, on local state (OS-2241).",
  },
  {
    href: "/playground/pull-request-checks",
    title: "Pull request checks",
    description: "The PR page's checks card in every state, Run checks' disabled reasons, and the PR list icons, using the real components on fixtures (OS-2400).",
  },
  {
    href: "/playground/check-rows",
    title: "Check rows",
    description: "Proposed check row: one-line header, then the answer, its files and artifact as cards, and a muted footer, all in one type size (OS-2385).",
  },
  {
    href: "/playground/evidence",
    title: "Evidence and checks",
    description: "Evidence tab, task checks, and the compact task-sidebar checklist, on local state (OS-2216).",
  },
  {
    href: "/playground/task-links",
    title: "Task links",
    description: "Task links in agent replies as snapshot blocks and chips, read from the markdown link title (OS-2149).",
  },
  {
    href: "/playground/task-sections",
    title: "Task sections",
    description: "Asana-style sections in the real task table and board, on local state (OS-2104).",
  },
  {
    href: "/playground/github-integration",
    title: "GitHub integration",
    description: "Connect repositories, browse and search PRs, and read diffs in an interactive prototype (OS-1852).",
  },
  {
    href: "/playground/convoy-tui",
    title: "Convoy terminal",
    description: "Interactive terminal UI proposal with run navigation, transcripts, and connection states (OS-1997).",
  },
  {
    href: "/playground/question-stack",
    title: "Question stack",
    description: "Overlapping question cards with hover spread, answer-in-any-order selection, and motion controls (OS-1965).",
  },
  {
    href: "/playground/workflow-run-rail",
    title: "Workflow run rail",
    description: "Run navigator docked to the transcript's right edge, with step and run controls (OS-1368).",
  },
  {
    href: "/playground/codex-sleep",
    title: "Codex sleep",
    description: "Interactive sleep event UX with countdown, completion, and interruption states (OS-1922).",
  },
  {
    href: "/playground/emails",
    title: "Emails",
    description: "Preview the live shared email templates using the current outbound minimal renderer.",
  },
  {
    href: "/playground/tasks",
    title: "Tasks",
    description: "Local-state task table playground for interaction and performance testing.",
  },
  {
    href: "/playground/kanban-card",
    title: "Kanban Card",
    description: "Real task data variants for the Board card component.",
  },
  {
    href: "/playground/timeline",
    title: "Task Timeline",
    description: "Unified comments + agent threads + activity stream with an inline composer (visuals only).",
  },
  {
    href: "/playground/watch-tower",
    title: "Watch Tower",
    description: "GitHub-PR-dashboard-style global thread inbox layout (visuals only).",
  },
  {
    href: "/playground/workflow-editor",
    title: "Workflow Editor",
    description: "Stage × Lane authoring grid layout for agentic Workflows (visuals only).",
  },
  {
    href: "/playground/threads-demo",
    title: "Threads Demo",
    description: "Early threads layout on mock conversations, kept as a design reference.",
  },
  {
    href: "/playground/tiptap-composer",
    title: "Tiptap Composer",
    description: "Composer prototype with mentions, commands, and markdown output.",
  },
  {
    href: "/playground/tiptap-simple",
    title: "Tiptap Simple",
    description: "Minimal rich text editor sandbox.",
  },
  {
    href: "/playground/date-time-selector",
    title: "Date Time Selector",
    description: "Standalone date and time selection playground.",
  },
  {
    href: "/playground/ask-question-tabs",
    title: "AskUserQuestion Tabs",
    description: "Tabbed one-question-at-a-time agent question card compared against today's stacked layout (OS-1456).",
  },
  {
    href: "/playground/claude-system-subtypes",
    title: "Claude System Subtypes",
    description:
      "Proposed handling for unmapped Claude SDK system subtypes, today's output vs. proposed, per subtype (OS-1598).",
  },
  {
    href: "/playground/cli-loaders",
    title: "CLI Loaders",
    description: "Pixel snake and grid wave loader variants for CLI and agent states.",
  },
  {
    href: "/playground/components",
    title: "Components",
    description: "Real app component states rendered in isolation for visual review.",
  },
  {
    href: "/playground/mdx-editor",
    title: "MDX Editor",
    description: "Reusable MDX authoring surface with live preview and source inspection.",
  },
  {
    href: "/playground/mermaid-diagrams",
    title: "Mermaid diagrams",
    description: "Mermaid fences rendered in the artifact editor: one example of each diagram type, plus an invalid one (OS-913).",
  },
  {
    href: "/playground/tanstack-table-dnd-div-virtualization-native_dnd",
    title: "TanStack Table DnD",
    description: "Native drag-and-drop table virtualization experiment.",
  },
];

const ARCHIVE_PLAYGROUNDS: PlaygroundLink[] = [
  {
    href: "/playground/emails-boxed",
    title: "Archived: Emails Boxed",
    description: "Older boxed brutalist email layout kept as a design reference.",
  },
  {
    href: "/playground/emails-minimal",
    title: "Archived: Emails Minimal",
    description: "Standalone minimal-layout variant preserved for comparison with the default email route.",
  },
  {
    href: "/playground/obsolete/tanstack-table-dnd-div",
    title: "Obsolete: TanStack Div DnD",
    description: "Older div-based table drag-and-drop experiment kept for reference.",
  },
  {
    href: "/playground/obsolete/tanstack-table-dnd-div-virtualization",
    title: "Obsolete: TanStack Div Virtualization",
    description: "Earlier virtualization experiment retained for comparison.",
  },
  {
    href: "/playground/obsolete/tanstack-table-dnd-tr",
    title: "Obsolete: TanStack TR DnD",
    description: "Original table-row drag-and-drop prototype.",
  },
];

function PlaygroundSection({
  title,
  description,
  links,
}: {
  title: string;
  description: string;
  links: PlaygroundLink[];
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {links.map((link) => (
          <AppLink
            key={link.href}
            href={routeTarget(link.href)}
            className="group rounded-[24px] border border-border/70 bg-card/85 p-5 transition-colors hover:border-primary/40 hover:bg-card"
          >
            <div className="space-y-2">
              <div className="text-lg font-medium transition-colors group-hover:text-primary">
                {link.title}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">{link.description}</p>
              <div className="pt-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Open playground
              </div>
            </div>
          </AppLink>
        ))}
      </div>
    </section>
  );
}

export default function PlaygroundIndexPage() {
  return (
    <main
      className="min-h-screen bg-background text-foreground"
      style={{
        backgroundImage:
          "radial-gradient(circle at top left, color-mix(in oklab, var(--primary) 14%, transparent), transparent 46%)",
      }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-10">
        <header className="max-w-3xl space-y-4">
          <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Playground index
          </div>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-balance">
              Browse every local playground from one page
            </h1>
            <p className="text-base leading-7 text-muted-foreground">
              This route is a central directory for the internal playgrounds under
              <span className="font-medium text-foreground"> /playground</span>. Active demos are
              listed first, with older experiments kept in a separate section below.
            </p>
          </div>
        </header>

        <PlaygroundSection
          title="Active playgrounds"
          description="Current sandboxes and design-review routes that are still useful during active development."
          links={ACTIVE_PLAYGROUNDS}
        />

        <PlaygroundSection
          title="Archived experiments"
          description="Older playgrounds that are still reachable but not part of the current preferred set."
          links={ARCHIVE_PLAYGROUNDS}
        />
      </div>
    </main>
  );
}
