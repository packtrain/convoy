/** Local data for the Evidence and Checks UX prototype (OS-2216). Nothing here is a real contract. */

/** `warning`: the claim holds, but a human should look. */
export type CheckStatus = "passed" | "warning" | "failed" | "not_performed";

export interface EvidenceFile {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  /** Stand-in for an image or video thumbnail. */
  tint?: string;
}

export interface CheckResult {
  status: CheckStatus;
  note?: string;
  files: EvidenceFile[];
  artifact?: string;
  thread: string;
  run: number;
  at: string;
}

export interface Check {
  key: string;
  label: string;
  /** `added` checks were asked for in a thread, outside the requested checklist. */
  source: "checklist" | "added";
  /** Newest first; empty while pending. */
  results: CheckResult[];
}

export interface FileGroup {
  thread: string;
  run: number;
  at: string;
  files: EvidenceFile[];
}

export interface EvidenceState {
  owner: { kind: "task"; ref: string; title: string } | { kind: "thread" } | null;
  checklist: string | null;
  checks: Check[];
  /** Files attached with no check. */
  files: FileGroup[];
}

const file = (id: string, fileName: string, contentType: string, fileSize: number, tint?: string): EvidenceFile => ({
  id,
  fileName,
  contentType,
  fileSize,
  tint,
});

const F = {
  testLog: file("f1", "test-output.log", "text/plain", 8_400),
  light: file("f2", "evidence-tab-light.png", "image/png", 412_000, "from-sky-200 to-indigo-300"),
  dark: file("f3", "evidence-tab-dark.png", "image/png", 398_000, "from-slate-700 to-slate-900"),
  demo: file("f4", "demo.mp4", "video/mp4", 3_400_000, "from-violet-400 to-fuchsia-500"),
  lint: file("f5", "tsc-output.log", "text/plain", 1_900),
  mobile: file("f6", "mobile-drawer.png", "image/png", 220_000, "from-emerald-200 to-teal-400"),
  debug: file("f7", "debug-overflow.png", "image/png", 180_000, "from-amber-200 to-orange-400"),
  schema: file("f8", "refs-index.sql", "text/plain", 640),
  oldTest: file("f9", "test-output.log", "text/plain", 9_100),
};

export const THREAD = "Render thread evidence";
const REVIEW_THREAD = "Review OS-2216";
const FIRST_THREAD = "OS-2216 first attempt";

export const ME = "Robin Hale";
export const TEAMMATE = "Alex Kim";
const THREAD_OWNERS: Record<string, string> = { [THREAD]: ME, [FIRST_THREAD]: ME, [REVIEW_THREAD]: TEAMMATE };

/** Threads are private to their owner, so a teammate sees the title and owner but no link. */
export const threadOwner = (thread: string) => THREAD_OWNERS[thread];

const LOOSE_FILES: FileGroup[] = [
  { thread: THREAD, run: 8, at: "1 min ago", files: [F.debug] },
  { thread: THREAD, run: 6, at: "40 min ago", files: [F.schema] },
];

export const TASK = { kind: "task" as const, ref: "OS-2216", title: "Render thread message attachments in the sidebar" };

const TASK_CHECKS: Check[] = [
  {
    key: "tests",
    label: "All tests pass",
    source: "checklist",
    results: [
      { status: "passed", note: "412 passed, 0 failed", files: [F.testLog], thread: THREAD, run: 7, at: "2 min ago" },
      { status: "failed", note: "2 failing in messages.test.ts", files: [F.oldTest], thread: FIRST_THREAD, run: 2, at: "Yesterday" },
    ],
  },
  {
    key: "ui",
    label: "UI verified in the running app",
    source: "checklist",
    results: [{ status: "passed", files: [F.light, F.dark, F.demo], thread: THREAD, run: 7, at: "2 min ago" }],
  },
  {
    key: "types",
    label: "Lint and typecheck clean",
    source: "checklist",
    results: [{ status: "failed", note: "tsc: 1 error in thread-workspace.tsx", files: [F.lint], thread: THREAD, run: 7, at: "2 min ago" }],
  },
  {
    key: "review",
    label: "Code review",
    source: "checklist",
    results: [{ status: "passed", note: "No blocking findings", files: [], artifact: "Review notes", thread: REVIEW_THREAD, run: 1, at: "1 h ago" }],
  },
  {
    key: "spec",
    label: "Spec updated",
    source: "checklist",
    results: [{ status: "not_performed", note: "User asked to land the spec in a separate change", files: [], thread: THREAD, run: 7, at: "2 min ago" }],
  },
  { key: "e2e", label: "E2E smoke on preview", source: "checklist", results: [] },
  {
    key: "mobile",
    label: "Mobile drawer layout",
    source: "added",
    results: [{ status: "passed", files: [F.mobile], thread: THREAD, run: 7, at: "2 min ago" }],
  },
];

/** Thread-owned results before a task is attached. */
const THREAD_ONLY_CHECKS: Check[] = [
  { ...TASK_CHECKS[0], results: [TASK_CHECKS[0].results[0]] },
  TASK_CHECKS[1],
  TASK_CHECKS[2],
  { ...TASK_CHECKS[3], results: [] },
  { ...TASK_CHECKS[4], results: [] },
  TASK_CHECKS[5],
];

export const SCENARIOS = {
  files: {
    label: "1 · Files only",
    note: "Slice 1. The agent attached files with no check. Newest run on top.",
    state: { owner: TASK, checklist: null, checks: [], files: [{ thread: THREAD, run: 7, at: "2 min ago", files: [F.light, F.dark, F.demo, F.testLog] }, ...LOOSE_FILES] },
  },
  task: {
    label: "2 · Task checks",
    note: "Checks belong to the task. Each row shows its latest result from any thread; expand for evidence and history.",
    state: { owner: TASK, checklist: "Feature", checks: TASK_CHECKS, files: LOOSE_FILES },
  },
  thread: {
    label: "3 · No task yet",
    note: "Run checks on a thread without a task. Results belong to the thread until a task is attached.",
    state: { owner: { kind: "thread" }, checklist: "Feature", checks: THREAD_ONLY_CHECKS, files: LOOSE_FILES },
    // The task already held a failed tests run and a review from other threads.
    attached: {
      owner: TASK,
      checklist: "Feature",
      checks: [...TASK_CHECKS.slice(0, 4), { ...TASK_CHECKS[4], results: [] }, TASK_CHECKS[5]],
      files: LOOSE_FILES,
    },
  },
  empty: {
    label: "4 · Nothing yet",
    note: "No files and no checks. The tab is hidden; the task sidebar offers Run checks once a checklist applies.",
    state: { owner: TASK, checklist: "Feature", checks: TASK_CHECKS.map((check) => ({ ...check, results: [] })).slice(0, 6), files: [] },
  },
} satisfies Record<string, { label: string; note: string; state: EvidenceState; attached?: EvidenceState }>;

export type ScenarioKey = keyof typeof SCENARIOS;

export const CHECKLISTS = [
  { name: "Feature", keys: ["tests", "ui", "types", "review", "spec", "e2e"] },
  { name: "Bug fix", keys: ["tests", "regression", "types"] },
  { name: "Refactor", keys: ["tests", "types"] },
];

/** Project settings map task type → default checklist; OS-2216 is a Feature task. */
export const TASK_TYPE_DEFAULT = "Feature";

const CATALOG: Check[] = [...TASK_CHECKS.filter((check) => check.source === "checklist"), { key: "regression", label: "Regression test added", source: "checklist", results: [] }];

/**
 * Switch the checklist without losing work: every check that already has a result stays, the new
 * list's missing checks are added as pending, and only pending checks outside the new list drop.
 */
export function applyChecklist(state: EvidenceState, name: string | null): EvidenceState {
  const keys = CHECKLISTS.find((list) => list.name === name)?.keys ?? [];
  const requested = keys.map((key) => state.checks.find((check) => check.key === key) ?? { ...CATALOG.find((check) => check.key === key)!, results: [] });
  const kept = state.checks.filter((check) => !keys.includes(check.key) && check.results.length > 0);
  return { ...state, checklist: name, checks: [...requested, ...kept] };
}
