import { expect, it } from "vitest";
import { breakLines, detailLines, scrollWindow, environmentTone, plain, rowCells, warningLines, warningGroups, wrapLines } from "./formatters.js";
import { toServiceInspection } from "../service/validators.js";
import { threadPageSchema } from "./validators.js";
import type { BrowseState } from "./validators.js";
import type { WorkerState } from "../service/validators.js";

const text = (lines: { text: string }[]) => lines.map(line => line.text).join("\n");

it("does not present defaults as observed configuration on an older service", () => {
  const state: BrowseState = {
    scope: { connection: 0, details: true }, rows: [], loading: false, stale: false, pageNumber: 1,
    observations: [{ health: "connected", profiles: [{ profile: "a", status: "online", attempts: 1 }] }],
  };
  expect(text(detailLines(state, "/socket", "1"))).toContain("  a  online · unknown active\n    Project   unknown\n    Endpoint  unknown\n    Settings  unknown");
});

it("shows the service's environment mode under Connection, else the target's, else nothing (OS-2249)", () => {
  const state = (snapshot?: BrowseState["observations"][number]["snapshot"]): BrowseState => ({
    scope: { connection: 0, details: true }, rows: [], loading: false, stale: false, pageNumber: 1,
    observations: [{ health: "connected", profiles: [], snapshot }] });
  const lines = (value: BrowseState, mode?: "shared" | "isolated") => detailLines(value, "/socket", "1", mode).map(line => line.text);
  expect(lines(state({ v: 1, id: "s", ok: true, pid: 1, mode: "shared" }), "isolated")[2]).toBe("  Mode           shared · one account for all projects");
  expect(lines(state(), "isolated")[2]).toBe("  Mode        isolated · a Linux account per project");
  expect(lines(state()).join("\n")).not.toContain("Mode:");
});

it("lists runtimes in one table, with environment-wide columns left of PROJECT (OS-2502)", () => {
  const profiles: WorkerState[] = [
    { profile: "a", status: "online", attempts: 1, versions: { codex: "0.142.3", cursor: "2026.10.22-27dcf5f" }, logins: { codex: "signed-in", "claude-code": "signed-out" }, desiredAuth: { mode: "native", claude: { mode: "disabled" } } },
    { profile: "b", status: "online", attempts: 1, versions: { codex: "0.142.3" }, logins: { codex: "signed-out" } },
    { profile: "c", status: "stopped", attempts: 0 },
  ];
  const state = (mode: "shared" | "isolated", list = profiles): BrowseState => ({ scope: { connection: 0, details: true }, rows: [], loading: false, stale: false, pageNumber: 1,
    observations: [{ health: "connected", profiles: list, snapshot: { v: 1, id: "s", ok: true, pid: 1, mode } }] });
  const shared = detailLines(state("shared"), "/socket", "1");
  expect(text(shared)).toContain(["Runtimes",
    "  RUNTIME      VERSION             LOGIN       PROJECT  CREDENTIAL",
    "  Codex        0.142.3             signed in   a        native",
    "                                               b        native",
    "  Claude Code  unknown             signed out  a        none",
    "  Cursor       2026.10.22-27dcf5f  unknown     a        native"].join("\n"));
  expect(shared.flatMap(line => line.row ? [line.row.id] : [])).toEqual(["a:codex", "b:codex", "a:claude-code", "a:cursor"]);
  expect(text(shared)).toContain("  c  stopped · unknown active\n    Project   unknown\n    Endpoint  unknown\n    Settings  unknown\n    Runtimes  not reported yet");
  // Each isolated project has its own login, so LOGIN moves right of PROJECT.
  expect(text(detailLines(state("isolated"), "/socket", "1"))).toContain(["  RUNTIME      VERSION             PROJECT  LOGIN       CREDENTIAL",
    "  Codex        0.142.3             a        signed in   native", "                                   b        signed out  native"].join("\n"));
  // One project needs no PROJECT column.
  expect(text(detailLines(state("shared", profiles.slice(0, 1)), "/socket", "1"))).toContain("  RUNTIME      VERSION             LOGIN       CREDENTIAL\n  Codex        0.142.3             signed in   native");
});

it("names a service that reports no runtime details (OS-2502)", () => {
  const state: BrowseState = { scope: { connection: 0, details: true }, rows: [], loading: false, stale: false, pageNumber: 1,
    observations: [{ health: "connected", profiles: [{ profile: "a", status: "online", attempts: 1 }] }] };
  const lines = text(detailLines(state, "/socket", "1"));
  expect(lines).toContain("Runtimes\n  Not reported by this service");
  expect(lines).not.toContain("not reported yet");
});

it("removes terminal controls while preserving Unicode", () => {
  expect(plain("\u001b[31m日本語 🚀\n\r\u0007\u202e")).toBe("日本語 🚀    ");
  expect(rowCells({ profile: "a", thread: { threadId: "t", title: "你好\u202e", status: "pending", lastActivityAt: 1 } })).toMatchObject({ task: "", meta: "t", title: "你好 " });
});
it("projects only safe configuration and strips URL credentials, path, query and fragment", () => {
  const value = toServiceInspection([{ key: "a", identity: "identity", config: {
    convexUrl: "https://user:secret@example.com/private?token=secret#secret", apiKey: "api-secret",
    projectId: "project", organizationId: "org", profileKey: "a", concurrency: 2, isolated: true,
  } }]);
  expect(value.profiles).toEqual([{ profile: "a", projectId: "project", endpoint: "https://example.com", mode: "isolated", concurrency: 2, isolated: true, streaming: undefined }]);
  expect(JSON.stringify(value)).not.toContain("secret");
});

it("preserves Unicode joiners while removing bidi controls", () => {
  expect(plain("👩‍💻 می\u200cروم\u202e")).toBe("👩‍💻 می\u200cروم ");
});

it("places the bracketed task reference before the title and preserves it through page parsing", () => {
  const thread = threadPageSchema.parse({ page: [{ threadId: "t", title: "Fix it", lastActivityAt: 1,
    associatedTaskId: "task", associatedTaskRef: "OS-2059" }], isDone: true, continueCursor: "" }).page[0];
  expect(rowCells({ profile: "a", thread })).toMatchObject({ task: "OS-2059", meta: "OS-2059 · t", title: "Fix it", runtime: "" });
  expect(rowCells({ profile: "a", thread, run: { threadId: "t", messageId: "m", status: "completed", createdAt: 1000, updatedAt: 39000 } }))
    .toMatchObject({ status: "completed", symbol: "✓", time: "38s" });
});
it("distinguishes runs of one thread by start time instead of repeating the thread title", () => {
  const thread = { threadId: "t", title: "sup?", lastActivityAt: 1 };
  const run = (messageId: string, createdAt: number) => rowCells({ profile: "a", thread, run: { threadId: "t", messageId, runId: `run-${messageId}`, status: "completed", createdAt, updatedAt: createdAt + 5000 } });
  expect(run("m2", 60000)).toMatchObject({ meta: `Started ${new Date(60000).toLocaleString()}`, title: "Run run-m2" });
  expect(run("m1", 0).title).not.toContain("sup?");
});
it("distinguishes unlinked threads from unavailable task references", () => {
  const thread = { threadId: "t", title: "Fix it", lastActivityAt: 1 };
  expect(rowCells({ profile: "a", thread }).task).toBe("");
  expect(rowCells({ profile: "a", thread: { ...thread, associatedTaskId: "task" } }).meta).toBe("task unavailable · t");
  // A thread shows its runtime when known and the first 8 characters of its ID.
  expect(rowCells({ profile: "a", thread: { ...thread, threadId: "k57abc12def34ghi", cliType: "codex" } })).toMatchObject({ meta: "k57abc12", runtime: "codex" });
});
it("maps service statuses to the design's state symbols and ages", () => {
  const thread = { threadId: "t", title: "Fix it", lastActivityAt: 0 };
  expect(rowCells({ profile: "a", thread: { ...thread, status: "streaming" } }, 252000)).toMatchObject({ symbol: "●", time: "4m 12s ago" });
  expect(rowCells({ profile: "a", thread: { ...thread, status: "waiting_input" } })).toMatchObject({ symbol: "?", label: "needs input" });
  expect(rowCells({ profile: "a", thread: { ...thread, status: "idle", hasPendingUserMessages: true } })).toMatchObject({ status: "idle+queued", label: "idle · queued", symbol: "·" });
  expect(rowCells({ profile: "a", thread, run: { threadId: "t", messageId: "m", status: "streaming", createdAt: 0, updatedAt: 0 } }, 7_260_000).time).toBe("2h 01m");
});

it.each(["pause", "remove"] as const)("describes %s impact with a known count and missing project", async kind => {
  const { confirmationLines } = await import("./actions/formatters.js");
  const state = { scope: { connection: 0, profile: "a", details: false }, observations: [{ health: "connected" as const, profiles: [{ profile: "a", status: "online" as const, attempts: 1, activeRuns: 3 }] }], rows: [], loading: false, stale: false, pageNumber: 1,
    action: { kind, profile: "a", pending: true } };
  const known = confirmationLines(state, "Local", 120).join("\n");
  expect(known).toContain("3 observed active runs");
  if (kind === "remove") expect(known).toContain("Private files are retained");
  expect(confirmationLines({ ...state, observations: [{ health: "connected", profiles: [] }] }, "Local", 120).join("\n")).toContain("Unknown observed active runs");
});

it.each(["status", "logs"] as const)("does not label %s as a service start even in a pending state", async kind => {
  const { confirmationLines } = await import("./actions/formatters.js");
  const state = { scope: { connection: 0, details: true }, observations: [{ health: "connected" as const, profiles: [] }], rows: [], loading: false, stale: false, pageNumber: 1,
    action: { kind, pending: true } };
  expect(confirmationLines(state, "Local", 120).join("\n")).not.toContain("Start this shared service");
});

it("shows a useful unobserved service summary instead of unknown diagnostic fields", () => {
  const state: BrowseState = { scope: { connection: 0, details: true }, rows: [], loading: false, stale: true, pageNumber: 1, observations: [{ health: "reconnecting", profiles: [] }] };
  const summary = text(detailLines(state, "/socket", "1"));
  expect(summary).toContain("Service state has not been observed");
  expect(summary).not.toContain("PID");
  expect(summary).not.toContain("Epoch");
});

it("uses an inspected service state without a browsing snapshot", () => {
  const state: BrowseState = { scope: { connection: 0, details: true }, rows: [], loading: false, stale: true, pageNumber: 1, observations: [{ health: "reconnecting", profiles: [], environmentStatus: { state: "running", serviceRunning: false } }] };
  const summary = text(detailLines(state, "/socket", "1"));
  expect(summary).toMatch(/Service +stopped/);
  expect(summary).not.toContain("Service state has not been observed");
});

it("shows a confirmed stop instead of a stale running snapshot", () => {
  const state: BrowseState = { scope: { connection: 0, details: true }, rows: [], loading: false, stale: true, pageNumber: 1, observations: [{ health: "reconnecting", profiles: [], snapshot: { v: 1, id: "status", ok: true, pid: 123 }, environmentStatus: { state: "stopped", serviceRunning: false } }] };
  expect(text(detailLines(state, "/socket", "1"))).toMatch(/Service +stopped/);
});

it("lists unhealthy projects with their service warning, scoped to the selected project", () => {
  const profiles = [
    { profile: "a", status: "failed" as const, attempts: 4, warning: "codex is not installed.\u001b[31m" },
    { profile: "b", status: "retrying" as const, attempts: 2 },
    { profile: "c", status: "online" as const, attempts: 1 },
  ];
  expect(warningLines(profiles)).toEqual(["a: failed · codex is not installed.", "b: retrying"]);
  expect(warningLines(profiles, "b")).toEqual(["b: retrying"]);
  expect(warningLines(profiles, "c")).toEqual([]);
});

it("groups repeated sign-in notices while retaining every recovery command", () => {
  const warning = "Claude Code is not logged in for this project. Run project login a --runtime claude-code. Cursor is not logged in for this project. Run project login a --runtime cursor.";
  const groups = warningGroups([{ profile: "a", status: "online", attempts: 1, warning }]);
  expect(groups[0].summary).toBe("Needs sign-in: Claude Code, Cursor");
  expect(groups[0].details.join(" ")).toBe(warning);
  expect(warningGroups([{ profile: "a", status: "online", attempts: 1, warning }], "b")).toEqual([]);
});

it("summarizes a shared project's sign-in notice the same way (OS-2247)", () => {
  const warning = "Codex is not logged in on this account. Run codex login --device-auth once for all projects. Cursor is not logged in on this account. Run NO_OPEN_BROWSER=1 cursor-agent login once for all projects.";
  const groups = warningGroups([{ profile: "a", status: "online", attempts: 1, warning }]);
  expect(groups[0].summary).toBe("Needs sign-in: Codex, Cursor");
  expect(groups[0].details).toEqual(["Codex is not logged in on this account.", "Run codex login --device-auth once for all projects.",
    "Cursor is not logged in on this account.", "Run NO_OPEN_BROWSER=1 cursor-agent login once for all projects."]);
});

it("groups an Antigravity sign-in notice with the others (OS-2474)", () => {
  const warning = "Codex is not logged in on this account. Run codex login --device-auth once for all projects. Antigravity is not logged in on this account. Run agy acp --login once for all projects.";
  const groups = warningGroups([{ profile: "a", status: "online", attempts: 1, warning }]);
  expect(groups[0].summary).toBe("Needs sign-in: Codex, Antigravity");
  expect(groups[0].details).toEqual(["Codex is not logged in on this account.", "Run codex login --device-auth once for all projects.",
    "Antigravity is not logged in on this account.", "Run agy acp --login once for all projects."]);
});

it("retains unknown and mixed warning text instead of classifying it as only sign-in", () => {
  const warning = "Backend unavailable. Codex is not logged in for this project. Run project login a --runtime codex.";
  const group = warningGroups([{ profile: "a", status: "failed", attempts: 1, warning }])[0];
  expect(group.summary).toBe("Backend unavailable.");
  expect(group.details.join(" ")).toBe(warning);
  expect(warningGroups([{ profile: "b", status: "retrying", attempts: 1 }])[0].summary).toBe("No additional details from the service.");
});

it("colours an unconnected environment's dot from its last environment check", () => {
  expect(environmentTone({ health: "connected", profiles: [], environmentError: "old" })).toBe("success");
  expect(environmentTone({ health: "unknown", profiles: [], environmentStatus: { state: "running", serviceRunning: true } })).toBe("success");
  expect(environmentTone({ health: "unknown", profiles: [], environmentStatus: { state: "stopped" } })).toBe("muted");
  expect(environmentTone({ health: "unknown", profiles: [], environmentError: "Docker host unavailable." })).toBe("warning");
  expect(environmentTone({ health: "unknown", profiles: [] })).toBe("muted");
});

it("wraps at spaces and breaks only a word longer than the line", () => {
  expect(wrapLines("a managed Docker target or a Linux VM", 24)).toEqual(["a managed Docker target", "or a Linux VM"]);
  expect(wrapLines("run as its control account.", 13)).toEqual(["run as its", "control", "account."]);
  expect(wrapLines("see abcdefghijkl", 8)).toEqual(["see", "abcdefgh", "ijkl"]);
  expect(wrapLines("  indented note that wraps", 16)).toEqual(["  indented note", "that wraps"]);
  expect(wrapLines("日本語 テキスト", 8)).toEqual(["日本語", "テキスト"]);
  expect(wrapLines("", 10)).toEqual([""]);
  // Raw content keeps every character.
  expect(breakLines('{"a": "b c"}', 5).join("")).toBe('{"a": "b c"}');
});

it("gives a line to each hidden side of a scrolled list and keeps the focus in view", () => {
  expect(scrollWindow(5, 8, 0)).toEqual({ start: 0, end: 5, above: 0, below: 0 });
  expect(scrollWindow(20, 8, 0)).toEqual({ start: 0, end: 7, above: 0, below: 13 });
  expect(scrollWindow(20, 8, 5)).toEqual({ start: 5, end: 11, above: 5, below: 9 });
  // Scrolled to the end, the window stays full.
  expect(scrollWindow(20, 8, 99)).toEqual({ start: 13, end: 20, above: 13, below: 0 });
  expect(scrollWindow(20, 8, 0, 6)).toEqual({ start: 0, end: 7, above: 0, below: 13 });
  expect(scrollWindow(20, 8, 0, 7)).toEqual({ start: 2, end: 8, above: 2, below: 12 });
  expect(scrollWindow(20, 8, 10, 3)).toEqual({ start: 3, end: 9, above: 3, below: 11 });
  // Too short for markers: a plain window.
  expect(scrollWindow(20, 2, 0, 5)).toEqual({ start: 4, end: 6, above: 0, below: 0 });
});
