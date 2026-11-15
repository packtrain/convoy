"use client";

import { useState } from "react";
import {
  ArrowUpFromLine,
  Bell,
  CircleDot,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Hand,
  Link2,
  ListPlus,
  Mail,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Tag,
  Terminal,
  Timer,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { StepCardShell, StepPill, WorkflowGrid } from "@/components/blocks/workflows/workflow-grid";
import type { WorkflowDefinition, WorkflowStep } from "@/convex/lib/contracts/workflowDefinition";
import { cn } from "@/lib/utils";

// The grid is the real editor component (OS-1810); this page seeds it with
// demo data. The action catalog below remains a visual-only prototype.

function promptStep(stepId: string, laneId: string, prompt: string): WorkflowStep {
  return { stepId, laneId, action: { type: "prompt", content: { displayContent: prompt } } };
}

const SEED_DEFINITION: WorkflowDefinition = {
  lanes: [
    { laneId: "lane-1", name: "Lane 1", type: "single" },
    { laneId: "lane-2", name: "Lane 2", type: "single" },
    { laneId: "lane-3", name: "Lane 3", type: "parallel" },
  ],
  stages: [
    {
      stageId: "stage-1",
      name: "Stage 1: Planning",
      steps: [promptStep("step-1", "lane-1", "Create a plan for the task")],
    },
    {
      stageId: "stage-2",
      name: "Stage 2: Plan review",
      steps: [
        promptStep(
          "step-2",
          "lane-3",
          "Review the attached plan to the task. Attach the review as a new artifact to the task"
        ),
        promptStep(
          "step-3",
          "lane-3",
          "Review the attached plan to the task. Attach the review as a new artifact to the task"
        ),
      ],
    },
    {
      stageId: "stage-3",
      name: "Stage 3: Plan Update & Implementation",
      steps: [
        promptStep(
          "step-4",
          "lane-1",
          "Check the plan review attached to the task. Is there anything worth adding/changing in the plan"
        ),
        promptStep("step-5", "lane-1", "Implement the plan in a new worktree"),
        {
          stepId: "step-6",
          laneId: "lane-2",
          action: {
            type: "bash",
            script: "pnpm web:lint && npx tsc --noEmit",
            timeoutMs: 600_000,
            reportOutput: "on_failure",
          },
        },
      ],
    },
    {
      stageId: "stage-4",
      name: "Stage 4: Code review",
      steps: [
        promptStep("step-7", "lane-3", "Review the uncommitted code. Attach findings to the task"),
        promptStep("step-8", "lane-3", "Review the uncommitted code. Attach findings to the task"),
      ],
    },
    {
      stageId: "stage-5",
      name: "Stage 5: Ship",
      steps: [
        { stepId: "step-9", laneId: "lane-1", name: "Wait for human approval", action: { type: "wait" } },
        promptStep("step-10", "lane-1", "Commit, push, and open a pull request"),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Action catalog — the deterministic Step types, grouped by where they run.
// ---------------------------------------------------------------------------

interface CatalogAction {
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  /** The config controls this Step would expose in the editor. */
  controls: string[];
  /** Set when the action is blocked on a prerequisite (shown muted). */
  blockedBy?: string;
}

interface CatalogFamily {
  id: string;
  name: string;
  where: string;
  /**
   * Amber = blocks on someone, blue = touches your machine, violet = outbound.
   * Cards are fully tinted like the wait-for-human step card.
   */
  accent: { dot: string; card: string; icon: string; title: string; chip: string };
  actions: CatalogAction[];
}

const ACTION_FAMILIES: CatalogFamily[] = [
  {
    id: "gates",
    name: "Gates",
    where: "Block the Lane until true",
    accent: {
      dot: "bg-amber-500",
      card: "bg-amber-500/10 hover:border-amber-500/60",
      icon: "text-amber-700 dark:text-amber-300",
      title: "text-amber-800 dark:text-amber-200",
      chip: "bg-amber-500/20 text-amber-900 dark:text-amber-100",
    },
    actions: [
      {
        id: "wait.human",
        name: "Wait for human",
        icon: Hand,
        description: "Holds the Lane until the starting user approves in the run navigator.",
        controls: [
          "Approver: starting user",
          "Timeout: 24h → fail",
        ],
      },
      {
        id: "wait.task",
        name: "Wait for task state",
        icon: CircleDot,
        description: "Resumes when the attached Task reaches a status or gains a label.",
        controls: [
          "Status",
          "is Approved",
        ],
      },
      {
        id: "wait.checks",
        name: "Wait for checks",
        icon: ShieldCheck,
        description: "Blocks until GitHub checks pass on the run's branch (gh pr checks).",
        controls: [
          "Branch: run branch",
          "Timeout: 30m",
        ],
      },
      {
        id: "wait.delay",
        name: "Delay",
        icon: Timer,
        description: "Waits a fixed duration before the Lane continues.",
        controls: ["15m"],
      },
    ],
  },
  {
    id: "exec",
    name: "Exec",
    where: "Runs on the run's machine",
    accent: {
      dot: "bg-blue-500",
      card: "bg-blue-500/10 hover:border-blue-500/60",
      icon: "text-blue-700 dark:text-blue-300",
      title: "text-blue-800 dark:text-blue-200",
      chip: "bg-blue-500/20 text-blue-900 dark:text-blue-100",
    },
    actions: [
      {
        id: "exec.bash",
        name: "Bash script",
        icon: Terminal,
        description: "Runs a script in the run's working directory; non-zero exit fails the Step.",
        controls: [
          "Timeout: 10m",
          "Report on failure",
        ],
      },
      {
        id: "exec.push",
        name: "Push",
        icon: ArrowUpFromLine,
        description: "Pushes the Lane's branch, setting upstream on first push.",
        controls: ["Force: never"],
      },
      {
        id: "exec.pr_open",
        name: "Open pull request",
        icon: GitPullRequest,
        description: "Opens a PR through gh and attaches its URL to the Task.",
        controls: ["{{task.ref}} {{task.title}}", "Draft"],
      },
      {
        id: "exec.pr_merge",
        name: "Merge pull request",
        icon: GitMerge,
        description: "Merges the run's PR once its gates have passed.",
        controls: [
          "Squash",
          "Delete branch",
        ],
      },
      {
        id: "exec.commit",
        name: "Commit",
        icon: GitCommit,
        description: "Commits staged work with a generated message instead of a prompt Step.",
        controls: ["Message: from generate"],
        blockedBy: "Needs run variables",
      },
      {
        id: "generate",
        name: "Generate value",
        icon: Sparkles,
        description: "One-shot model call in a throwaway thread; its output becomes a variable.",
        controls: ["Store as: commitMessage"],
        blockedBy: "Needs run variables",
      },
    ],
  },
  {
    id: "effects",
    name: "Effects",
    where: "Runs on the backend",
    accent: {
      dot: "bg-violet-500",
      card: "bg-violet-500/10 hover:border-violet-500/60",
      icon: "text-violet-700 dark:text-violet-300",
      title: "text-violet-800 dark:text-violet-200",
      chip: "bg-violet-500/20 text-violet-900 dark:text-violet-100",
    },
    actions: [
      {
        id: "effect.task_update",
        name: "Update task",
        icon: Tag,
        description: "Sets one field on the attached Task — status, list, label, assignee, priority.",
        controls: [
          "Status",
          "→ In review",
        ],
      },
      {
        id: "effect.task_link",
        name: "Attach link",
        icon: Link2,
        description: "Attaches the run's PR or commit URL to the Task as an external link.",
        controls: ["Link: PR URL"],
      },
      {
        id: "effect.notify",
        name: "Notify",
        icon: Bell,
        description: "Sends an in-app and desktop notification to chosen project members.",
        controls: [
          "To: starting user",
          "Text",
        ],
      },
      {
        id: "effect.webhook",
        name: "Webhook",
        icon: Webhook,
        description: "POSTs the run payload to a stored URL — covers Slack, Discord, PagerDuty.",
        controls: [
          "URL: #deploys",
          "Payload: run summary",
        ],
      },
      {
        id: "effect.comment",
        name: "Post comment",
        icon: MessageSquare,
        description: "Comments on the attached Task with a templated run summary.",
        controls: ["Body: template"],
        blockedBy: "Needs run variables",
      },
      {
        id: "effect.task_create",
        name: "Create task",
        icon: ListPlus,
        description: "Files a follow-up task from a review Stage's findings.",
        controls: ["Title: template"],
        blockedBy: "Needs run variables",
      },
      {
        id: "effect.email",
        name: "Send email",
        icon: Mail,
        description: "Emails a run summary to people who do not live in the app.",
        controls: ["To"],
        blockedBy: "Needs run variables",
      },
    ],
  },
];

/**
 * Config affordance preview: a filled pill in the family accent, like the
 * model pills on step cards — no border, no chevron.
 */
function ControlChip({
  label,
  accent,
}: {
  label: string;
  accent: CatalogFamily["accent"];
}) {
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", accent.chip)}>
      {label}
    </span>
  );
}

function CatalogCard({
  action,
  accent,
}: {
  action: CatalogAction;
  accent: CatalogFamily["accent"];
}) {
  const Icon = action.icon;
  return (
    <StepCardShell
      className={cn("p-3", accent.card, action.blockedBy && "opacity-60")}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className={cn("size-4 shrink-0", accent.icon)} />
        <h4 className={cn("text-sm font-medium leading-snug", accent.title)}>{action.name}</h4>
        <code className="font-mono text-[11px] text-muted-foreground">{action.id}</code>
        {action.blockedBy ? <StepPill>{action.blockedBy}</StepPill> : null}
      </div>
      <p className="pt-1.5 text-xs leading-relaxed text-muted-foreground">{action.description}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
        {action.controls.map((control) => (
          <ControlChip key={control} label={control} accent={accent} />
        ))}
      </div>
    </StepCardShell>
  );
}

function ActionCatalog() {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Action catalog</h2>
        <p className="text-sm text-muted-foreground">
          Deterministic Step types, grouped by where they execute. Chips preview the config
          each one exposes; muted cards ship with run variables.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        {ACTION_FAMILIES.map((family) => (
          <div key={family.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-2 px-1">
              <span className={cn("size-2 rounded-full", family.accent.dot)} />
              <span className="text-sm font-medium text-foreground">{family.name}</span>
              <span className="text-xs text-muted-foreground">{family.where}</span>
            </div>
            {family.actions.map((action) => (
              <CatalogCard key={action.id} action={action} accent={family.accent} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function WorkflowEditorPlaygroundPage() {
  const [definition, setDefinition] = useState(SEED_DEFINITION);

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Workflow editor</h1>
          <p className="text-sm text-muted-foreground">
            The real Stage × Lane grid (structure edits only, not persisted here). Rows are
            Stages, columns are Lanes; a Parallel lane runs its Steps in a Stage concurrently.
          </p>
        </header>
        <WorkflowGrid
          className="max-h-[calc(100vh-11rem)] rounded-lg border border-border"
          definition={definition}
          onChange={setDefinition}
        />
        <ActionCatalog />
      </div>
    </main>
  );
}
