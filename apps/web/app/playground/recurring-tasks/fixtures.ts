import { format } from "date-fns";
import { Status, type Priority, type TaskAgentThreadWorkStatus } from "@/lib/tasks/types";
import type { ComposerRuntimeOverrides } from "@/lib/threads/hooks/use-composer-runtime-overrides";

/** The prototype's clock at load: Mon Nov 23 2026, 08:40. "Next slot" moves it. */
export const START = new Date(2026, 10, 23, 8, 40);

export const UNITS = ["hour", "day", "week", "month", "year"] as const;
export type Unit = (typeof UNITS)[number];

export type Rule = {
  every: number;
  unit: Unit;
  /** JS weekdays, 0 is Sunday. */
  weekdays: number[];
  dayOfMonth: number;
  /** 0 is January. */
  month: number;
  time: string;
};

export const UNIT_LABEL: Record<Unit, [one: string, many: string]> = {
  hour: ["hour", "hours"],
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

/** Monday first, the order the weekday buttons use. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
  day,
  short: format(new Date(2026, 10, 22 + day), "EEE"),
  long: format(new Date(2026, 10, 22 + day), "EEEE"),
}));
export const MONTHS = Array.from({ length: 12 }, (_, month) => format(new Date(2026, month, 1), "MMMM"));

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

const RULE_DETAIL: Record<Unit, (rule: Rule) => string> = {
  hour: () => "",
  day: (rule) => ` at ${rule.time}`,
  week: (rule) => {
    const days = WEEKDAYS.filter(({ day }) => rule.weekdays.includes(day)).map(({ short }) => short);
    return ` on ${days.join(", ") || "no day"} at ${rule.time}`;
  },
  month: (rule) => ` on the ${ordinal(rule.dayOfMonth)} at ${rule.time}`,
  year: (rule) => ` on ${MONTHS[rule.month].slice(0, 3)} ${rule.dayOfMonth} at ${rule.time}`,
};

export function describeRule(rule: Rule): string {
  const isWeekdays =
    rule.unit === "week" && rule.every === 1 && [1, 2, 3, 4, 5].every((day) => rule.weekdays.includes(day)) && rule.weekdays.length === 5;
  if (isWeekdays) return `Every weekday at ${rule.time}`;
  const [one, many] = UNIT_LABEL[rule.unit];
  return `Every ${rule.every === 1 ? one : `${rule.every} ${many}`}${RULE_DETAIL[rule.unit](rule)}`;
}

type DayMatch = { day: Date; daysOut: number; start: Date };

const MATCHES: Record<Exclude<Unit, "hour">, (rule: Rule, match: DayMatch) => boolean> = {
  day: (rule, { daysOut }) => daysOut % rule.every === 0,
  week: (rule, { day, daysOut, start }) =>
    rule.weekdays.includes(day.getDay()) && Math.floor((daysOut + ((start.getDay() + 6) % 7)) / 7) % rule.every === 0,
  month: (rule, { day, start }) => {
    const months = (day.getFullYear() - start.getFullYear()) * 12 + day.getMonth() - start.getMonth();
    return day.getDate() === Math.min(rule.dayOfMonth, lastDayOfMonth(day)) && months % rule.every === 0;
  },
  year: (rule, { day, start }) =>
    day.getMonth() === rule.month &&
    day.getDate() === Math.min(rule.dayOfMonth, lastDayOfMonth(day)) &&
    (day.getFullYear() - start.getFullYear()) % rule.every === 0,
};

function lastDayOfMonth(day: Date): number {
  return new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
}

/** The next `count` slots strictly after `from`, in the browser's zone. A stand-in for the server function. */
export function nextSlots(rule: Rule, from: Date, count: number): Date[] {
  if (rule.unit === "hour") {
    // Slots sit on multiples of the interval from midnight; the real rule counts from the first slot.
    const hour = (Math.floor(from.getHours() / rule.every) + 1) * rule.every;
    const first = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hour);
    return Array.from({ length: count }, (_, i) => new Date(first.getTime() + i * rule.every * 3_600_000));
  }
  const [hours, minutes] = rule.time.split(":").map(Number);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const slots: Date[] = [];
  for (let daysOut = 0; slots.length < count && daysOut < 4000; daysOut++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + daysOut, hours, minutes);
    if (day > from && MATCHES[rule.unit](rule, { day, daysOut, start })) slots.push(day);
  }
  return slots;
}

export const LIST_KEYS = ["inbox", "backlog", "m2", "chores", "schedules"] as const;
export type ListKey = (typeof LIST_KEYS)[number];
export type ListInfo = { type: "list"; name: string; color: string } | { type: "system"; name: string };
export const LISTS: Record<ListKey, ListInfo> = {
  inbox: { type: "list", name: "Inbox", color: "#64748b" },
  backlog: { type: "system", name: "Backlog" },
  m2: { type: "list", name: "Milestone 2", color: "#3b82f6" },
  chores: { type: "list", name: "Chores", color: "#22c55e" },
  schedules: { type: "list", name: "Schedules", color: "#a855f7" },
};

export const ME = "Alice Chen";
export const TIMEZONES = ["Europe/Berlin", "UTC", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
export const AGENTS = ["Cleanup agent", "Dependency agent", "Ops agent"];
/** Each agent's own automation prompt. Picking the agent seeds it into an empty composer, as the real composer does. */
export const AGENT_PROMPTS: Record<string, string> = {
  "Cleanup agent": "Clean up what the task describes and open one PR.",
  "Dependency agent": "Update the dependencies the task names, run the checks, and open one PR.",
  "Ops agent": "Do the check the task describes and report what you find in a comment.",
};
export const WORKFLOWS = ["Plan, build, review", "Fix and verify"];
export const WORKSPACES = ["local", "worktree"] as const;
export type Workspace = (typeof WORKSPACES)[number];
export const WORKSPACE_LABEL: Record<Workspace, string> = { local: "Work locally", worktree: "New worktree" };
export const CLI_PROFILES = ["alice-macbook", "alice-devbox"];
export const PATHS = ["~/code/convoy", "~/code/convoy-infra"];

export type Runner = { profile: string; path: string; user: string };
export type Note = { name: string; updated: string };

export const SKIP_REASONS = ["late", "previous_open", "runner_unavailable"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type LastRun =
  | { slot: Date; outcome: "spawned"; ref: string }
  | { slot: Date; outcome: "skipped"; reason: SkipReason; ref?: string };

export type Template = {
  id: string;
  ref: string;
  name: string;
  typeKey: string;
  status: Status;
  priority: Priority;
  rule: Rule;
  timezone: string;
  /** The list the recurring task lives in. */
  list: ListKey;
  /** The list its Occurrences are created in. Unset: under this task, as subtasks. */
  target?: ListKey | null;
  assignee: string | null;
  agent: string | null;
  runner: Runner | null;
  /** The stored thread composer: first message, runtime overrides, workspace and workflow. */
  prompt?: string;
  runtime?: ComposerRuntimeOverrides;
  workspace?: Workspace;
  workflow?: string | null;
  /** Set when the agent, the acting user or the CLI profile is gone. */
  runnerProblem?: string;
  paused: boolean;
  lastRun: LastRun | null;
  skipped: number;
  description: string;
  subtasks: string[];
};

export type Occurrence = {
  id: string;
  ref: string;
  templateId: string;
  /** Set for a top-level Occurrence created in a list. Unset: a subtask of the recurring task. */
  list?: ListKey;
  name: string;
  status: Status;
  slot: Date;
  runNow?: boolean;
  thread?: { title: string; state: TaskAgentThreadWorkStatus };
  pr?: string;
  artifacts: Note[];
};

export type PlainTask = {
  id: string;
  ref: string;
  name: string;
  typeKey: string;
  status: Status;
  priority: Priority;
  list: ListKey;
  assignee: string | null;
  agent: string | null;
  description: string;
};

const daily = (time: string): Rule => ({ every: 1, unit: "day", weekdays: [1], dayOfMonth: 1, month: 0, time });
const RUNNER: Runner = { profile: "alice-macbook", path: "~/code/convoy", user: ME };

export const SEED_TEMPLATES: Template[] = [
  {
    id: "t1",
    ref: "OS-2510",
    name: "Daily code cleanup",
    typeKey: "chore",
    status: Status.TODO,
    priority: "Medium",
    rule: daily("09:00"),
    timezone: "Europe/Berlin",
    list: "chores",
    assignee: ME,
    agent: "Cleanup agent",
    runner: RUNNER,
    workspace: "worktree",
    prompt: "Run fallow, remove what it flags, and open one PR. Read the last occurrence first so you do not repeat a rejected change.",
    paused: false,
    lastRun: { slot: new Date(2026, 10, 22, 9, 0), outcome: "skipped", reason: "previous_open", ref: "OS-2531" },
    skipped: 2,
    description: "Remove dead code and unused exports found by fallow. Open one PR.",
    subtasks: ["Run fallow and triage findings", "Open the PR"],
  },
  {
    id: "t2",
    ref: "OS-2511",
    name: "Weekly dependency update",
    typeKey: "chore",
    status: Status.TODO,
    priority: "Low",
    rule: { ...daily("06:00"), unit: "week", weekdays: [1] },
    timezone: "Europe/Berlin",
    list: "schedules",
    target: "chores",
    assignee: ME,
    agent: "Dependency agent",
    runner: { ...RUNNER, profile: "alice-devbox" },
    paused: false,
    lastRun: { slot: new Date(2026, 10, 23, 6, 0), outcome: "spawned", ref: "OS-2533" },
    skipped: 0,
    description: "Bump patch and minor versions, run the checks, open a PR.",
    subtasks: [],
  },
  {
    id: "t3",
    ref: "OS-2512",
    name: "Monthly access review",
    typeKey: "task",
    status: Status.TODO,
    priority: "High",
    rule: { ...daily("10:00"), unit: "month", dayOfMonth: 1 },
    timezone: "UTC",
    list: "inbox",
    assignee: "Bob Novak",
    agent: null,
    runner: null,
    paused: false,
    lastRun: { slot: new Date(2026, 10, 1, 10, 0), outcome: "spawned", ref: "OS-2490" },
    skipped: 0,
    description: "Review who has admin access to the organization and the cloud accounts.",
    subtasks: ["Organization admins", "Cloud accounts", "API keys older than 90 days"],
  },
  {
    id: "t4",
    ref: "OS-2513",
    name: "Queue health check",
    typeKey: "investigation",
    status: Status.TODO,
    priority: "Medium",
    rule: { ...daily("00:00"), unit: "hour", every: 6 },
    timezone: "UTC",
    list: "chores",
    assignee: ME,
    agent: "Ops agent",
    runner: { ...RUNNER, profile: "alice-ci-runner" },
    runnerProblem: "CLI profile alice-ci-runner was deleted",
    paused: false,
    lastRun: { slot: new Date(2026, 10, 23, 6, 0), outcome: "skipped", reason: "runner_unavailable" },
    skipped: 5,
    description: "Check the thread queue depth and report anything stuck for more than an hour.",
    subtasks: [],
  },
  {
    id: "t5",
    ref: "OS-2514",
    name: "Sprint retro notes",
    typeKey: "task",
    status: Status.TODO,
    priority: "None",
    rule: { ...daily("16:00"), unit: "week", every: 2, weekdays: [5] },
    timezone: "Europe/Berlin",
    list: "m2",
    assignee: "Bob Novak",
    agent: null,
    runner: null,
    paused: false,
    lastRun: { slot: new Date(2026, 10, 20, 16, 0), outcome: "skipped", reason: "late" },
    skipped: 1,
    description: "Collect what went well and what did not.",
    subtasks: [],
  },
  {
    id: "t6",
    ref: "OS-2515",
    name: "Quarterly dependency audit",
    typeKey: "chore",
    status: Status.TODO,
    priority: "Low",
    rule: { ...daily("09:00"), unit: "month", every: 3, dayOfMonth: 31 },
    timezone: "Europe/Berlin",
    list: "m2",
    assignee: ME,
    agent: "Dependency agent",
    runner: RUNNER,
    paused: true,
    lastRun: { slot: new Date(2026, 8, 30, 9, 0), outcome: "spawned", ref: "OS-2301" },
    skipped: 0,
    description: "Audit licenses and known vulnerabilities across all five apps.",
    subtasks: [],
  },
  {
    id: "t7",
    ref: "OS-2380",
    name: "Launch week standup summary",
    typeKey: "task",
    status: Status.DONE,
    priority: "None",
    rule: { ...daily("17:00"), unit: "week", weekdays: [1, 2, 3, 4, 5] },
    timezone: "Europe/Berlin",
    list: "m2",
    assignee: ME,
    agent: null,
    runner: null,
    paused: false,
    lastRun: { slot: new Date(2026, 9, 30, 17, 0), outcome: "spawned", ref: "OS-2371" },
    skipped: 0,
    description: "",
    subtasks: [],
  },
];

export const SEED_OCCURRENCES: Occurrence[] = [
  {
    id: "o1",
    ref: "OS-2531",
    templateId: "t1",
    name: "Daily code cleanup",
    status: Status.IN_REVIEW,
    slot: new Date(2026, 10, 21, 9, 0),
    thread: { title: "Daily code cleanup", state: "completed" },
    pr: "#1482 Remove unused exports in apps/cli",
    artifacts: [{ name: "Cleanup report.md", updated: "Nov 21" }],
  },
  {
    id: "o2",
    ref: "OS-2524",
    templateId: "t1",
    name: "Daily code cleanup",
    status: Status.DONE,
    slot: new Date(2026, 10, 20, 9, 0),
    thread: { title: "Daily code cleanup", state: "completed" },
    pr: "#1475 Drop dead feature flags",
    artifacts: [{ name: "Cleanup report.md", updated: "Nov 20" }],
  },
  {
    id: "o3",
    ref: "OS-2519",
    templateId: "t1",
    name: "Daily code cleanup",
    status: Status.DONE,
    slot: new Date(2026, 10, 19, 9, 0),
    thread: { title: "Daily code cleanup", state: "completed" },
    artifacts: [],
  },
  {
    id: "o4",
    ref: "OS-2533",
    templateId: "t2",
    list: "chores",
    name: "Weekly dependency update",
    status: Status.IN_PROGRESS,
    slot: new Date(2026, 10, 23, 6, 0),
    thread: { title: "Weekly dependency update", state: "streaming" },
    artifacts: [],
  },
  {
    id: "o5",
    ref: "OS-2490",
    templateId: "t3",
    name: "Monthly access review",
    status: Status.DONE,
    slot: new Date(2026, 10, 1, 10, 0),
    artifacts: [],
  },
];

export const SEED_TASKS: PlainTask[] = [
  {
    id: "p1",
    ref: "OS-2498",
    name: "Rotate staging API keys",
    typeKey: "chore",
    status: Status.TODO,
    priority: "Medium",
    list: "chores",
    assignee: ME,
    agent: "Ops agent",
    description: "Rotate the staging keys and update the secrets store.",
  },
  {
    id: "p2",
    ref: "OS-2502",
    name: "Clean up stale preview deployments",
    typeKey: "chore",
    status: Status.TODO,
    priority: "Low",
    list: "chores",
    assignee: null,
    agent: null,
    description: "",
  },
];

/** Closed Occurrences a recurring task keeps. Older ones are archived when a new one is created. */
export const KEEP_CLOSED = 10;

export const DEFAULT_RULE: Rule = { every: 1, unit: "week", weekdays: [1], dayOfMonth: 1, month: 0, time: "09:00" };

/** "Today, 09:00", "Tomorrow, 09:00", else "Mon, Nov 23, 09:00". */
export function formatSlot(slot: Date, now: Date): string {
  const days = Math.round(
    (new Date(slot.getFullYear(), slot.getMonth(), slot.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      86_400_000
  );
  const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : format(slot, "EEE, MMM d");
  return `${day}, ${format(slot, "HH:mm")}`;
}
