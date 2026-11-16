"use client";

import { useState } from "react";
import { ArrowLeft, GitPullRequest, ListChecks } from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { ChecksCard, PullRequestCheckIcons } from "@/components/blocks/checks";
import { Button } from "@/components/ui/button";
import type { api } from "@/convex/_generated/api";
import { AppLink, routeTarget } from "@/lib/navigation";

type TaskChecks = NonNullable<FunctionReturnType<typeof api.checks.checklists.getForPullRequest>>;
type TaskCheck = TaskChecks["checks"][number];
type CheckResult = TaskCheck["results"][number];
type ListedCheck = FunctionReturnType<typeof api.checks.results.listForPullRequestList>[number]["checks"][number];

/** The real button's reasons, in its order (run-pull-request-checks.tsx). */
function runBlocker(checkCount: number, headSha: string | null | undefined, profileOnline: boolean) {
  if (checkCount === 0) return "The Pull request checklist has no checks";
  if (!headSha) return "Convoy has not synced this pull request yet";
  return profileOnline ? null : "No CLI profile is online";
}

const HEAD = "f9e8d7c4b3a2";
const OLD_HEAD = "a1b2c3d4e5f6";
const CATALOG = [
  { key: "risk", label: "Merge risk", instruction: "Rate the risk of merging: low, medium or high." },
  { key: "tests", label: "All tests pass", instruction: "Run pnpm web:test:once." },
  { key: "db", label: "Extra database requests", instruction: "List any new reads or writes per request." },
  { key: "scope", label: "Scope", instruction: "Does the diff stay inside the task?" },
];
const HOUR = 3_600_000;
const now = Date.now();

let nextId = 0;
function result(status: CheckResult["status"], extra: Partial<CheckResult> = {}): CheckResult {
  nextId += 1;
  return {
    _id: `result_${nextId}`,
    messageId: `message_${nextId}`,
    threadId: "thread_1",
    threadTitle: "Run pull request checks on #482",
    reporterName: "gecko0",
    reportedByViewer: true,
    status,
    files: [],
    headSha: HEAD,
    reportedAt: now - HOUR,
    ...extra,
  } as CheckResult;
}

type Results = Partial<Record<string, CheckResult[]>>;

function checksOf(results: Results, { keys = CATALOG.map((check) => check.key), headSha = HEAD as string | null } = {}): TaskChecks {
  const rows: TaskCheck[] = CATALOG.filter((check) => keys.includes(check.key)).map((check) => ({ ...check, added: false, results: results[check.key] ?? [] }));
  return {
    checklists: [{ _id: "checklist_pr", name: "Review signals", isDefault: false, checkKeys: keys, taskTypeKeys: [] as string[] }],
    checklistId: "checklist_pr",
    followsTypeDefault: false,
    catalog: CATALOG,
    checks: rows,
    pullRequest: { headSha },
  } as unknown as TaskChecks;
}

const SCENARIOS = {
  hidden: { label: "No checklist", data: null },
  notRun: { label: "Not run yet", data: checksOf({}) },
  running: {
    label: "Running",
    data: checksOf({ risk: [result("passed", { value: "low", reportedAt: now - 60_000 })], tests: [result("passed", { reportedAt: now - 30_000 })] }),
  },
  passed: {
    label: "All passed",
    data: checksOf({
      risk: [result("passed", { value: "low" })],
      tests: [result("passed")],
      db: [result("passed", { value: "0", note: "No new reads." })],
      scope: [result("passed")],
    }),
  },
  failures: {
    label: "Failed and warning",
    data: checksOf({
      risk: [result("warning", { value: "medium", note: "Touches the checkResults index; needs a schema push." })],
      tests: [result("failed", { note: "2 failures in checks-settings-section.test.tsx" })],
      db: [result("passed", { value: "1", note: "One extra read per PR list batch." })],
      scope: [result("not_performed", { note: "No task attached to compare against." })],
    }),
  },
  outdated: {
    label: "Outdated",
    data: checksOf({
      risk: [result("passed", { value: "low", headSha: OLD_HEAD, reportedAt: now - 5 * HOUR })],
      tests: [result("failed", { note: "Lint failed", headSha: OLD_HEAD, reportedAt: now - 5 * HOUR })],
      db: [result("passed", { headSha: OLD_HEAD, reportedAt: now - 5 * HOUR })],
      scope: [result("passed", { headSha: OLD_HEAD, reportedAt: now - 5 * HOUR })],
    }),
  },
  history: {
    label: "Rerun after push",
    data: checksOf({
      risk: [result("passed", { value: "low" }), result("warning", { value: "high", headSha: OLD_HEAD, reportedAt: now - 5 * HOUR })],
      tests: [result("passed"), result("failed", { note: "Lint failed", headSha: OLD_HEAD, reportedAt: now - 5 * HOUR })],
      db: [result("passed", { value: "0" })],
      scope: [result("passed")],
    }),
  },
  teammate: {
    label: "Teammate's run",
    data: checksOf({
      risk: [result("passed", { value: "low", reporterName: "Dana", reportedByViewer: false })],
      tests: [result("warning", { note: "Flaky retry on one test", reporterName: "Dana", reportedByViewer: false })],
    }),
  },
  emptyChecklist: { label: "Empty checklist", data: checksOf({}, { keys: [] }) },
  notSynced: { label: "Not synced", data: checksOf({}, { headSha: null }) },
} satisfies Record<string, { label: string; data: TaskChecks | null }>;
type ScenarioKey = keyof typeof SCENARIOS;

/** The PR list rows: up to three "Show in pull request list" checks each. */
// The server's type spells optional fields as `string | undefined`, so the fixtures are cast once below.
const LIST_ROWS: { number: number; title: string; checks: Partial<ListedCheck>[] }[] = [
  { number: 482, title: "All three reported on the current head", checks: [
    { key: "risk", label: "Merge risk", status: "passed", value: "low", outdated: false },
    { key: "tests", label: "All tests pass", status: "failed", note: "2 failures", outdated: false },
    { key: "db", label: "Extra database requests", status: "warning", value: "3", note: "Three new reads per row", outdated: false },
  ] },
  { number: 481, title: "Only Merge risk reported: the others keep their slots", checks: [
    { key: "risk", label: "Merge risk", status: "warning", value: "medium", outdated: false },
    { key: "tests", label: "All tests pass", status: "pending", outdated: false },
    { key: "db", label: "Extra database requests", status: "pending", outdated: false },
  ] },
  { number: 480, title: "Pushed since the run: every result outdated", checks: [
    { key: "risk", label: "Merge risk", status: "passed", value: "low", outdated: true },
    { key: "tests", label: "All tests pass", status: "failed", note: "Lint failed", outdated: true },
    { key: "db", label: "Extra database requests", status: "passed", value: "0", outdated: true },
  ] },
  { number: 479, title: "Rerun after a push: one result still from the old head", checks: [
    { key: "risk", label: "Merge risk", status: "passed", value: "low", outdated: false },
    { key: "tests", label: "All tests pass", status: "passed", outdated: false },
    { key: "db", label: "Extra database requests", status: "warning", value: "3", outdated: true },
  ] },
  { number: 478, title: "Outdated and pending together", checks: [
    { key: "risk", label: "Merge risk", status: "failed", value: "high", outdated: true },
    { key: "tests", label: "All tests pass", status: "pending", outdated: false },
    { key: "db", label: "Extra database requests", status: "not_performed", note: "No CLI on this branch", outdated: false },
  ] },
  { number: 477, title: "Never checked: no icons", checks: [] },
];

/** Pull request checks (OS-2400): the PR page card in every state, Run checks' reasons, and the PR list icons, on fixtures. */
export default function PullRequestChecksPlaygroundPage() {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("failures");
  const [profileOnline, setProfileOnline] = useState(true);
  const [log, setLog] = useState<string | null>(null);
  const data = SCENARIOS[scenarioKey].data;
  const checks = data?.checks.filter((check) => !check.added) ?? [];
  const reason = data ? runBlocker(checks.length, data.pullRequest?.headSha, profileOnline) : null;

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <AppLink href={routeTarget("/playground")} className="mr-2 inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden="true" className="size-3.5" /> Playground
        </AppLink>
        <span className="font-medium">Pull request checks</span>
        <span className="rounded-md border border-border px-2 py-0.5 text-muted-foreground">OS-2400 · real components, fixture data</span>
        <span className="mx-2 h-4 w-px bg-border" />
        {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => (
          <Button
            key={key}
            size="xs"
            variant={key === scenarioKey ? "default" : "outline"}
            onClick={() => {
              setScenarioKey(key);
              setLog(null);
            }}
          >
            {SCENARIOS[key].label}
          </Button>
        ))}
        <span className="mx-2 h-4 w-px bg-border" />
        <Button size="xs" variant={profileOnline ? "outline" : "default"} onClick={() => setProfileOnline(!profileOnline)}>
          {profileOnline ? "CLI profile online" : "No CLI profile online"}
        </Button>
      </div>

      <div className="mx-auto grid w-full max-w-6xl gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">PR page · Overview</h2>
          {data ? (
            <ChecksCard
              data={data}
              title={(count) => `Pull request checks: ${count}`}
              onFix={(failed) => setLog(`Fix → drafts in Activity:\n${failed.map((row) => `- ${row.label}${row.note ? `: ${row.note}` : ""}`).join("\n")}`)}
              action={
                // The real button opens the thread composer; its disabled reasons are the same function.
                <span title={reason ?? undefined}>
                  <Button size="xs" variant="ghost" disabled={reason !== null} onClick={() => setLog("Run checks → opens the thread composer, prefilled with the checks prompt for this head")}>
                    <ListChecks /> Run checks
                  </Button>
                </span>
              }
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
              No card: the project has no Pull request checklist and this PR has no results.
            </p>
          )}
          <div className="rounded-lg border p-3 text-xs text-muted-foreground">GitHub checks card sits here.</div>
          {reason ? <p className="text-xs text-muted-foreground">Run checks is disabled: {reason}.</p> : null}
          {log ? <pre className="rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">{log}</pre> : null}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">PR list · status icons</h2>
          <div className="divide-y rounded-lg border">
            {LIST_ROWS.map((row) => (
              <div key={row.number} className="flex items-center gap-3 px-3 py-2 text-sm">
                <GitPullRequest className="size-4 shrink-0 text-success" />
                <span className="min-w-0 flex-1 truncate">{row.title}</span>
                <PullRequestCheckIcons checks={row.checks as ListedCheck[]} />
                <span className="shrink-0 text-xs text-muted-foreground">#{row.number}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Columns, in Pull request checklist order: Merge risk · All tests pass · Extra database requests. A checked PR keeps every
            slot (the empty circle is not reported yet); a dimmed icon was reported on an older commit. Hover for the label, value, and
            note. A PR nobody checked shows no icons.
          </p>
        </section>
      </div>
    </main>
  );
}
