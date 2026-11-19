// Site and feature copy. Content guidelines: docs/specs/landing-hero.md; SEO: docs/specs/landing-seo.md.

export const site = {
  name: "Convoy",
  title: "Convoy | The software factory for AI coding agents",
  description:
    "Run Claude Code, Codex, OpenCode and Cursor from one web UI. Share agents, skills and workflows across your team, assign tasks and review results together.",
  url: "https://convoy.build",
  docsUrl: "https://docs.convoy.build/",
  repoUrl: process.env.LANDING_REPO_URL?.trim() || "https://github.com/packtrain/convoy",
};

export type Feature = { name: string; body: string; soon?: true };
export type FeatureGroup = { title: string; features: Feature[] };

export const featureGroups: FeatureGroup[] = [
  {
    title: "Agent execution",
    features: [
      { name: "Agent threads", body: "Follow coding agents on your connected machines. Read their responses, inspect tool calls and diffs, and send follow-up instructions in a thread." },
      { name: "Supported runtimes", body: "Run Claude Code, Codex, OpenCode or Cursor, and pick the runtime and model for each thread. Steering and approvals depend on what each runtime supports." },
      { name: "Watch Tower", body: "See agent runs from every project in your organization. Find questions, failures and work ready for review in List or Board view, with batch actions for triage." },
      { name: "Agent dispatch", body: "Assign a task to an agent with its own instructions and preferences. Start a thread from the task and follow its progress from the board." },
      { name: "Steering & approvals", body: "Review diffs and send feedback to the agent. Supported runtimes also let you steer a running agent and approve or deny tool use." },
      { name: "Branching", body: "Branch a thread from any earlier run to try a different approach, or retry a run that failed." },
      { name: "Worktree isolation", body: "Start a thread in a separate Git worktree to keep its changes apart from your main checkout." },
      { name: "Sandboxed agents", body: "Run Claude Code or Codex in an OS sandbox (Seatbelt on macOS, bubblewrap on Linux), or inside the devcontainer the CLI generates." },
      { name: "Workflows", body: "Build reusable stages with agent prompts, Bash checks and human approvals. Run lanes in parallel, follow each step, and retry or skip a failed step." },
      { name: "Prompt catalogs", body: "Save reusable messages at organization or project level and insert them into a thread with a slash command." },
      { name: "Skills", body: "Save procedures as reusable instruction bundles. Install organization templates into projects, adapt the copies, and call on them from a thread." },
      { name: "Reusable agents", body: "Give an agent standing instructions for a role such as reviewer or implementer. Install organization templates or copy an agent from another project." },
      { name: "Thread groups", body: "Keep related agent conversations together in one group, with a tab for each thread." },
      { name: "Thread sharing", body: "Share a thread or thread group with project teammates who have thread access. They can follow the live conversation in read-only mode." },
      { name: "Scheduled runs", body: "Run agents on a schedule, such as nightly dependency bumps or weekly triage. Each run shows up as a task on the board with its full history.", soon: true },
    ],
  },
  {
    title: "The agent workforce",
    features: [
      { name: "Usage & costs", body: "See daily spend, tokens by model, and spend per member and per CLI for each project, plus the cost of each task and thread." },
      { name: "Fleet analytics", body: "See success rate and time to merge for each agent.", soon: true },
      { name: "Agent pools & cloud execution", body: "Register your own machines or managed sandboxes as executors. Convoy spreads dispatched tasks across them so the queue keeps moving.", soon: true },
      { name: "Desktop app", body: "A menu bar app that keeps your agents connected, so you don't need a terminal open.", soon: true },
    ],
  },
  {
    title: "Documents & review",
    features: [
      { name: "Checks & evidence", body: "Give tasks reusable checklists. Agents report passed, warning, failed or not-performed results with notes and evidence. Inspect the results and ask for pending and failed checks to run again." },
      { name: "Task artifacts", body: "Keep plans, reviews and handoff notes on the task. Edit Markdown documents or open HTML reports and interactive outputs." },
      { name: "Guided reviews", body: "Ask an agent for a Guide to a pull request. It groups related changes into chapters, with notes beside the code on what changed and where to look closely. Mark files Reviewed as you go." },
      { name: "Artifact comments", body: "Comment on a passage in a Markdown plan or review. Ask an agent to address the feedback, revise the document and resolve the comments." },
      { name: "Project memory", body: "Each new agent run starts with the decisions, specs, review comments and failed attempts from earlier work.", soon: true },
    ],
  },
  {
    title: "Project management",
    features: [
      { name: "Real-time board", body: "Organize work in Lists with Board and Table views. Set priorities, types and labels, choose which built-in statuses to use, and find tasks by refs such as ABC-123." },
      { name: "Rich tasks", body: "Break work into subtasks and keep comments, attachments, artifacts and check results with the task. Commits and pull requests linked by agents or the CLI show up on the task." },
      { name: "Keyboard-first tasks", body: "Create, indent, reorder and update tasks from the keyboard, and open any task by its ref. Bulk edits, archive and delete come with undo." },
      { name: "Teams & permissions", body: "Invite teammates to organizations and projects, and give each role the access it needs." },
      { name: "GitHub pull requests", body: "Read pull requests from connected repositories with their checks, commits and agent threads, then comment, review and merge from Convoy." },
    ],
  },
  {
    title: "Open & extensible",
    features: [
      { name: "Code on GitHub", body: "Read exactly what runs between you and your agents. Licensed under the Elastic License 2.0." },
      { name: "Self-hostable", body: "Run Convoy's web app and backend on your own infrastructure." },
      { name: "MCP server", body: "AI tools can read and update tasks, artifacts, comments, skills and prompts over MCP, and start agent threads. Claude Code connects with a browser sign-in, no API key needed." },
      { name: "Environment management", body: "Manage local and Docker environments with convoy tui. Attach projects, inspect service status, and retry connections from a keyboard-driven terminal interface." },
      { name: "CLI", body: "convoy connect links your agents to threads, and convoy tasks lets you script task work." },
      { name: "Enterprise & on-prem", body: "Air-gapped deployments, SSO with SAML, and audit logs that record every agent action and approval.", soon: true },
    ],
  },
];
