import { parseRunPatchFiles, splitRunPatch } from "@/lib/threads/run-diff-patch";
import type { Check as TaskCheck } from "../../evidence/fixtures";

export type PullRequest = {
  number: number;
  title: string;
  repo: string;
  author: string;
  assignees: string[];
  // GitHub archive: closed, with the conversation locked.
  archived: boolean;
  // The base branch has commits the head doesn't.
  behind: boolean;
  // GitHub stack number; layers are ordered by PR number, bottom first.
  stack?: number;
  createdAt: number;
  updatedAt: number;
  state: "open" | "draft" | "merged" | "closed";
  updated: string;
  label: string;
  description: string;
  task?: string;
};

export const repositories = ["contoso/convoy", "contoso/docs", "contoso/desktop"];
const descriptions = [
  "Keep the current review visible when a new commit arrives. Readers can choose when to refresh, without losing their place in the diff.",
  "Document the setup steps and make the configuration examples easier to follow. Includes the required callback and webhook URLs.",
  "Reduce unnecessary refreshes and keep the last useful result visible while reconnecting. Includes coverage for interrupted requests.",
];
const seeds: [number, string, number, string, PullRequest["state"], string, string, string?][] = [
  [
    482,
    "Keep review context when new commits arrive",
    0,
    "robin",
    "open",
    "2 minutes ago",
    "enhancement",
    "OS-1852",
  ],
  [
    479,
    "Document self-hosted GitHub App setup",
    1,
    "maya",
    "open",
    "18 minutes ago",
    "documentation",
  ],
  [
    477,
    "Reconnect agents after network interruptions",
    0,
    "alex",
    "draft",
    "42 minutes ago",
    "reliability",
  ],
  [
    475,
    "Add keyboard navigation to repository picker",
    0,
    "maya",
    "open",
    "1 hour ago",
    "accessibility",
  ],
  [92, "Show active runs in the menu bar", 2, "alex", "open", "2 hours ago", "enhancement"],
  [
    470,
    "Preserve task filters between projects",
    0,
    "robin",
    "draft",
    "3 hours ago",
    "enhancement",
  ],
  [
    468,
    "Clarify deployment environment variables",
    1,
    "maya",
    "merged",
    "yesterday",
    "documentation",
  ],
  [466, "Avoid duplicate webhook deliveries", 0, "robin", "merged", "2 days ago", "reliability"],
  [
    460,
    "Experiment with inline review navigation",
    0,
    "alex",
    "closed",
    "3 days ago",
    "experiment",
  ],
  [451, "Improve search result keyboard focus", 0, "maya", "merged", "last week", "accessibility"],
  [
    447,
    "Update installation troubleshooting guide",
    1,
    "robin",
    "merged",
    "last week",
    "documentation",
  ],
  [81, "Restore window position after restart", 2, "alex", "closed", "last month", "reliability"],
  [
    128,
    "Archive legacy authentication guide",
    1,
    "maya",
    "merged",
    "6 months ago",
    "documentation",
  ],
  [483, "Show which revision a comment was left on", 0, "robin", "open", "4 hours ago", "enhancement"],
  [484, "Compare two revisions in the diff", 0, "robin", "draft", "5 hours ago", "enhancement"],
];

export const pullRequests: PullRequest[] = seeds.map(
  ([number, title, repo, author, state, updated, label, task], index) => ({
    number,
    title,
    repo: repositories[repo],
    author,
    state,
    updated,
    label,
    task,
    description: descriptions[index % descriptions.length],
    assignees: index % 3 === 0 ? ["maya"] : index % 3 === 1 ? ["robin", "alex"] : [],
    archived: false,
    behind: number === 479,
    stack: number >= 482 && number <= 484 ? 12 : undefined,
    createdAt: Date.UTC(2026, 8, 1) + (100 - index * 3 - (index % 2) * 8) * 3600000,
    updatedAt: Date.UTC(2026, 9, 6) - index * 3600000,
  }),
);
export const prKey = (pr: PullRequest) => `${pr.repo}#${pr.number}`;
export const isOpen = (pr: PullRequest) => pr.state === "open" || pr.state === "draft";
export const stackOf = (records: PullRequest[], pr: PullRequest) =>
  pr.stack ? records.filter((item) => item.repo === pr.repo && item.stack === pr.stack).sort((a, b) => a.number - b.number) : [];
// The open layers below merge with this one; the nearest of them is the base, otherwise main.
export const layersBelow = (records: PullRequest[], pr: PullRequest) =>
  stackOf(records, pr).filter((item) => item.number < pr.number && isOpen(item));
export const initialStored = () => pullRequests.filter(isOpen).map(prKey);

// One filter state drives both the PR list and the reader sidebar.
export const defaultFilters = {
  tab: "open",
  query: "",
  repo: "all",
  author: "all",
  assignee: "all",
  searchState: "all",
  field: "updatedAt",
  order: "newest",
  page: 0,
};
export type PrFilters = typeof defaultFilters;
export const pageSize = 3;

export function filterPullRequests(records: PullRequest[], filters: PrFilters, currentUser: string | null) {
  const person = (value: string) => (value === "me" ? currentUser ?? "" : value);
  const query = filters.query.trim().toLowerCase();
  return records
    .filter(
      (pr) =>
        (filters.repo === "all" || filters.repo === pr.repo) &&
        (filters.author === "all" || person(filters.author) === pr.author) &&
        (filters.assignee === "all" ||
          (filters.assignee === "none"
            ? !pr.assignees.length
            : pr.assignees.includes(person(filters.assignee)))) &&
        (query
          ? `${pr.title} ${pr.number} ${pr.repo} ${pr.author}`.toLowerCase().includes(query) &&
            (filters.searchState === "all" ||
              (filters.searchState === "open" ? isOpen(pr) : pr.state === filters.searchState))
          : filters.tab === "open"
            ? isOpen(pr)
            : !isOpen(pr)),
    )
    .sort((a, b) => {
      const key = filters.field === "createdAt" ? "createdAt" : "updatedAt";
      return (a[key] - b[key]) * (filters.order === "oldest" ? 1 : -1);
    });
}

export type ChangedFile = {
  path: string;
  kind: "modified" | "renamed" | "deleted" | "binary" | "large";
  previousPath?: string;
  before: string;
  after: string;
};

export function filesFor(pr: PullRequest, refreshed: boolean): ChangedFile[] {
  const docs = pr.repo.endsWith("/docs");
  return [
    {
      path: docs ? "guides/github-setup.md" : "src/reviews/revision.ts",
      kind: "modified",
      before: docs
        ? "# GitHub setup\n\nInstall the GitHub App.\nSelect a repository.\n"
        : "export function resolveRevision(current, incoming) {\n  return incoming;\n}\n",
      after: docs
        ? "# GitHub setup\n\nRegister and install the GitHub App.\nConfigure the webhook endpoint.\nSelect a repository as a project admin.\n"
        : `export function resolveRevision(current, incoming) {\n  if (current.sha === incoming.sha) return current;\n  return {\n    ...current,\n    updateAvailable: true,\n    nextSha: incoming.sha,\n${refreshed ? "    receivedAt: Date.now(),\n" : ""}  };\n}\n`,
    },
    {
      path: "src/reviews/reader.ts",
      previousPath: "src/reviews/view.ts",
      kind: "renamed",
      before: "export const preservePosition = true;\n",
      after: "export const preservePosition = true;\n",
    },
    {
      path: "src/reviews/legacy-refresh.ts",
      kind: "deleted",
      before: "export const refreshInterval = 5000;\n",
      after: "",
    },
    { path: "assets/review-icon.png", kind: "binary", before: "", after: "" },
    { path: "generated/api-schema.json", kind: "large", before: "", after: "" },
  ];
}

export function patchFor(file: ChangedFile) {
  const before = file.before.trimEnd().split("\n");
  const after = file.after ? file.after.trimEnd().split("\n") : [];
  return `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ ${file.kind === "deleted" ? "/dev/null" : `b/${file.path}`}\n@@ -1,${before.length} +${after.length ? 1 : 0},${after.length} @@\n${before.map((line) => `-${line}`).join("\n")}\n${after.map((line) => `+${line}`).join("\n")}${after.length ? "\n" : ""}`;
}

export function statsFor(file: ChangedFile) {
  const parsed = file.kind === "modified" || file.kind === "deleted"
    ? parseRunPatchFiles(splitRunPatch(patchFor(file)))[0]
    : undefined;
  return { parsed, additions: parsed?.additions ?? 0, deletions: parsed?.deletions ?? 0 };
}

export type Commit = { sha: string; message: string; author: string; committedAt: number };
export type Review = { reviewer: string; state: "approved" | "requested"; at: number };
export type PrComment = { id: string; author: string; body: string; createdAt: number; edited?: boolean };
// One agent run's guide for a PR; several members can each request one.
export type Guide = { id: string; requester: string; model: string; revision: string; createdAt: number; writing: boolean; base?: Guide };
// Where guides run, remembered apart from the member's CLI thread defaults.
export type GuideSettings = { profile: string; path: string; worktree: boolean; model: string };
export const defaultGuideSettings: GuideSettings = { profile: "Robin's MacBook Pro", path: "~/code/convoy", worktree: true, model: "Claude Opus 5.5" };
export const guideOptions = {
  profile: ["Robin's MacBook Pro", "Build box"],
  path: ["~/code/convoy", "~/code/convoy-review"],
  model: ["Claude Opus 5.5", "Claude Sonnet 5.5", "GPT-5.5"],
};
// #479 already has guides from two other members, one for an older revision.
export const seedGuidesFor = (pr: PullRequest): Guide[] =>
  pr.number === 479
    ? [
        { id: "479:alex", requester: "alex", model: "GPT-5.5", revision: "51c0b2e", createdAt: pr.updatedAt - 26 * 3600000, writing: false },
        { id: "479:maya", requester: "maya", model: "Claude Opus 5.5", revision: "8a3e7d1", createdAt: pr.updatedAt - 2 * 3600000, writing: false },
      ]
    : [];

// The signed-in user's own GitHub account and repository role; "none" means not connected.
export type GithubAccess = "none" | "read" | "triage" | "write";
const accessLevels: GithubAccess[] = ["none", "read", "triage", "write"];
// Why an action is unavailable, or undefined when the user's GitHub role allows it.
export const blockedBy = (access: GithubAccess, needs: Exclude<GithubAccess, "none">) =>
  accessLevels.indexOf(access) >= accessLevels.indexOf(needs) ? undefined : access === "none" ? "Connect GitHub first" : `Needs ${needs} access`;

const hour = 3600000;
export const branchFor = (pr: PullRequest) =>
  `${pr.label === "documentation" ? "docs" : pr.label === "reliability" ? "fix" : "feat"}/${pr.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`;

// The head sha matches the reader's "Displayed revision" label.
export function commitsFor(pr: PullRequest, refreshed: boolean): Commit[] {
  const commits = [
    { sha: "51c0b2e", message: pr.title, author: pr.author, committedAt: pr.createdAt },
    { sha: "8a3e7d1", message: pr.repo.endsWith("/docs") ? "Address review feedback" : "Preserve the displayed revision", author: pr.author, committedAt: pr.createdAt + 5 * hour },
  ];
  return refreshed
    ? [...commits, { sha: "c91f02a", message: "Record when incoming revisions arrive", author: "Jordan Lee", committedAt: pr.updatedAt }]
    : commits;
}

export function reviewsFor(pr: PullRequest): Review[] {
  const reviewer = pr.author === "maya" ? "alex" : "maya";
  return [{ reviewer, state: pr.state === "draft" || pr.number === 479 ? "requested" : "approved", at: pr.createdAt + 8 * hour }];
}

export type CheckState = "success" | "failure" | "pending";
export type Check = { name: string; state: CheckState; summary: string };

const deploySummaries: Record<CheckState, string> = {
  success: "Deployment has completed",
  failure: "Deployment has failed",
  pending: "Deployment is building",
};

// Check runs and commit statuses on the head: #479's docs deploy fails and drafts are still building.
export function checksFor(pr: PullRequest): Check[] {
  const deploy = (app: string): Check => {
    const state = pr.number === 479 && app === "docs" ? "failure" : pr.state === "draft" && app === "web" ? "pending" : "success";
    return { name: `Vercel – convoy-${app}`, state, summary: deploySummaries[state] };
  };
  return [deploy("web"), { name: "Vercel Preview Comments", state: "success", summary: "No unresolved feedback" }, deploy("docs"), deploy("landing")];
}

const checkTitles: Record<CheckState, string> = {
  success: "All checks have passed",
  failure: "Some checks were not successful",
  pending: "Some checks haven't completed yet",
};
const checkCounts: Record<CheckState, string> = { failure: "failing", pending: "pending", success: "successful" };

// GitHub's rollup: any failure wins, then anything still running.
export function checksSummary(checks: Check[]) {
  const count = (state: CheckState) => checks.filter((check) => check.state === state).length;
  const state: CheckState = count("failure") ? "failure" : count("pending") ? "pending" : "success";
  const parts = (Object.keys(checkCounts) as CheckState[]).filter(count).map((value) => `${count(value)} ${checkCounts[value]}`);
  return { state, title: checkTitles[state], body: `${new Intl.ListFormat("en").format(parts)} checks`, failing: count("failure") };
}

// Pull request checks the project wrote, run at 8a3e7d1: #482 has a failure, #479 passes with a warning.
export const checkedRevision = "8a3e7d1";
export function pullRequestChecksFor(pr: PullRequest): TaskCheck[] {
  const result = (status: TaskCheck["results"][number]["status"], note: string) => ({ status, note, files: [], thread: `Check #${pr.number}`, run: 1, at: "10 min ago" });
  if (pr.number === 479) {
    return [
      { key: "backend", label: "No major backend changes", source: "checklist", results: [result("passed", "Docs only.")] },
      { key: "tests", label: "Tests cover the change", source: "checklist", results: [result("warning", "No tests, but nothing here runs.")] },
      { key: "solo", label: "Safe to merge without a second reviewer", source: "checklist", results: [result("passed", "Setup docs, no code.")] },
    ];
  }
  if (pr.number !== 482) return [];
  return [
    { key: "backend", label: "No major backend changes", source: "checklist", results: [result("warning", "Mostly reader code, but it adds an index on tasks.")] },
    { key: "tests", label: "Tests cover the change", source: "checklist", results: [result("passed", "Revision refresh is covered in reader.test.ts.")] },
    { key: "solo", label: "Safe to merge without a second reviewer", source: "checklist", results: [result("failed", "It changes how the reader refreshes on new commits; worth a human look.")] },
  ];
}

// GitHub's mergeability: #475 conflicts with main, and #483 with #482 below it, which blocks #484.
export const mergeStatusFor = (pr: PullRequest) => ({
  checks: checksFor(pr),
  conflicts: pr.number === 475 || pr.number === 483,
});

export function seedCommentsFor(pr: PullRequest): PrComment[] {
  const reviewer = reviewsFor(pr)[0].reviewer;
  return [
    { id: `${prKey(pr)}:seed`, author: reviewer, body: "Can we keep the scroll position when the diff refreshes?", createdAt: pr.createdAt + 6 * hour },
    { id: `${prKey(pr)}:outside`, author: "sam-oss", body: "Tried this branch locally and it works for me.", createdAt: pr.createdAt + 7 * hour },
  ];
}

export function summaryFor(file: ChangedFile) {
  const { parsed, additions, deletions } = statsFor(file);
  return {
    ...parsed,
    path: file.path,
    kind: file.kind === "deleted" ? "deleted" as const : "modified" as const,
    binary: file.kind === "binary",
    additions,
    deletions,
  };
}

export type GuideStep = {
  title: string;
  body: string;
  paths: string[];
  // The one call a reader should slow down for, if any.
  attention?: { kind: "Tradeoff" | "Contract" | "Product" | "Risk" | "Accessibility"; note: string };
  notes?: Record<string, string>;
  questions?: string[];
  // What a follow-up rewrote; only the first step's files change in the simulated push.
  change?: string;
};

// Convoy writes the guide from the diff; every changed file belongs to one step.
export function guideFor(pr: PullRequest): GuideStep[] {
  const docs = pr.repo.endsWith("/docs");
  return [
    docs
      ? { title: "Setup guide", body: "The setup guide now registers the GitHub App before installing it, adds the webhook endpoint, and notes that only project admins can select a repository.", paths: ["guides/github-setup.md"], change: "The webhook step now names the endpoint path." }
      : {
          title: "Revision tracking",
          body: "resolveRevision keeps the current revision when the incoming sha matches. Otherwise it flags that an update is available and records the next sha, so the reader can offer a refresh instead of replacing the diff.",
          paths: ["src/reviews/revision.ts"],
          attention: { kind: "Contract", note: "Callers now get the same object back when nothing changed. Anything that compared revisions by identity keeps working; anything that expected a copy doesn't." },
          change: "resolveRevision also records when the incoming revision arrived.",
        },
    { title: "Reader cleanup", body: "view.ts moves to reader.ts unchanged. The timed refresh is removed, since updates now arrive with each push.", paths: ["src/reviews/reader.ts", "src/reviews/legacy-refresh.ts"], notes: { "src/reviews/reader.ts": "Renamed from view.ts, no other change.", "src/reviews/legacy-refresh.ts": "Deleted with its interval." }, questions: ["Why remove the timed refresh instead of lengthening it?"] },
    { title: "Generated and binary files", body: "The review icon and the regenerated API schema have no readable diff. Open them on GitHub if you need to check them.", paths: ["assets/review-icon.png", "generated/api-schema.json"], notes: { "generated/api-schema.json": "Regenerated from the schema; no manual edits." } },
  ];
}

export type LinkedTask = { refId: string; name: string; typeKey: string };

// Stands in for the backend lookup of a task ref found in a PR label or title.
const linkedTasks: Record<string, LinkedTask> = {
  "OS-1852": { refId: "OS-1852", name: "Render all github PRs in the UI", typeKey: "epic" },
};
export const taskFor = (pr: PullRequest) => (pr.task ? linkedTasks[pr.task] : undefined);
