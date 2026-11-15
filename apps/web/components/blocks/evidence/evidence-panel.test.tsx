/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { EvidencePanel, useThreadEvidence } from "./evidence-panel";

// `checks` answers both getForTask and getForThread: they return the same shape.
const queries = vi.hoisted(() => ({ files: undefined as unknown, checks: undefined as unknown, role: undefined as unknown }));

const queryCalls = vi.hoisted(() => [] as [string, unknown][]);

vi.mock("convex/react", () => ({
  useQuery: (query: string, args: unknown) =>
    (queryCalls.push([query, args]), args === "skip")
      ? undefined
      : query === "files"
        ? queries.files
        : query === "role"
          ? queries.role
          : queries.checks,
  useMutation: () => vi.fn(),
  useConvex: () => ({ query: vi.fn(() => new Promise(() => undefined)) }),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    cli: { messages: { listAgentAttachmentsByThread: "files", getMessageAttachmentUrls: "urls" }, threads: { core: { setChecklist: "setThreadChecklist" } } },
    checks: { checklists: { getForTask: "taskChecks", getForThread: "threadChecks" }, results: { getFileUrls: "urls" } },
    tasks: { core: { setChecklist: "setChecklist" } },
    projects: { members: { getMyRole: "role" } },
    organizations: { members: { getMyRole: "orgRole" } },
  },
}));

const threadId = "thread_1" as Id<"cliThreads">;
const taskId = "task_1" as Id<"tasks">;
const route = { organizationSlug: "acme", projectAlias: "OS" };
const file = (storageId: string, fileName: string) => ({ storageId, fileName, fileSize: 4, contentType: "text/plain", uploadedAt: 1 });
const result = (files: ReturnType<typeof file>[]) => ({
  _id: "result_1",
  messageId: "message_1",
  threadId,
  threadTitle: "Build login",
  reporterName: "Ada",
  reportedByViewer: true,
  status: "passed",
  files,
  reportedAt: 1,
});

describe("useThreadEvidence (OS-2291)", () => {
  afterEach(() => {
    cleanup();
    queries.files = undefined;
    queries.checks = undefined;
  });

  test("a Check result shows, and check evidence leaves the files list", () => {
    queries.files = [{ messageId: "message_1", attachments: [file("storage_log", "out.log"), file("storage_debug", "debug.txt")] }];
    queries.checks = {
      checklists: [],
      checklistId: null,
      checks: [{ key: "tests", label: "All tests pass", instruction: "", added: true, results: [result([file("storage_log", "out.log")])] }],
    };

    const { result: hook } = renderHook(() => useThreadEvidence(threadId, { taskId }));
    expect(hook.current?.groups.map((group) => group.attachments.map((attachment) => attachment.fileName))).toEqual([["debug.txt"]]);

    render(<EvidencePanel threadId={threadId} thread={{ taskId }} projectRoute={route} />);
    expect(screen.getByText("All tests pass")).toBeDefined();
    expect(screen.getByText("1/1")).toBeDefined();
    expect(screen.getByText("Other files")).toBeDefined();

    queries.files = [];
    const { result: resultsOnly } = renderHook(() => useThreadEvidence(threadId, { taskId }));
    expect(resultsOnly.current).not.toBeNull();
  });

  test("a thread with no task shows its own results (OS-2293)", () => {
    queries.files = [];
    queries.checks = {
      checklists: [],
      checklistId: null,
      checks: [{ key: "tests", label: "All tests pass", instruction: "", added: true, results: [result([])] }],
    };
    render(<EvidencePanel threadId={threadId} thread={{ taskId: undefined }} projectRoute={route} />);
    expect(screen.getByText("All tests pass")).toBeDefined();
    queries.checks = undefined;
  });

  test("a task-less thread's owner can pick a first Checklist from the tab (CR OS-2293 round 1 #1)", () => {
    queries.files = [];
    queries.checks = {
      checklists: [{ _id: "checklist_1", name: "Feature", isDefault: false, checkKeys: ["tests"], taskTypeKeys: [] }],
      checklistId: null,
      checks: [],
    };
    render(<EvidencePanel threadId={threadId} thread={{ taskId: undefined }} isOwner projectRoute={route} />);
    expect(screen.getByRole("button", { name: "Run checks" })).toBeDefined();
    queries.checks = undefined;
  });

  test("reads the Checks by thread from the first render, before the thread doc lands", () => {
    queries.files = [];
    queryCalls.length = 0;
    renderHook(() => useThreadEvidence(threadId, null));
    expect(queryCalls).toContainEqual(["threadChecks", { threadId }]);
  });

  test("null only while the files, the thread, or its Checks load; empty evidence after (OS-2293)", () => {
    queries.files = [];
    queries.checks = { checklists: [], checklistId: null, checks: [] };
    expect(renderHook(() => useThreadEvidence(threadId, null)).result.current).toBeNull();
    expect(renderHook(() => useThreadEvidence(threadId, { taskId })).result.current).toEqual({ taskId, hasChecks: false, hasChecklists: false, groups: [] });
    queries.checks = undefined;
    expect(renderHook(() => useThreadEvidence(threadId, { taskId })).result.current).toBeNull();
  });
});

describe("EvidencePanel empty states (OS-2293)", () => {
  const projectId = "project_1" as Id<"projects">;

  afterEach(() => {
    cleanup();
    queries.files = undefined;
    queries.checks = undefined;
    queries.role = undefined;
  });

  test("a project admin who owns the thread gets Add checks, linking to Settings → Checks", () => {
    queries.checks = { checklists: [], checklistId: null, checks: [] };
    queries.files = [];
    queries.role = "project-admin";
    render(<EvidencePanel threadId={threadId} thread={{ taskId }} isOwner projectRoute={route} projectId={projectId} />);
    expect(screen.getByRole("link", { name: "Add checks" }).getAttribute("href")).toBe("/o/acme/OS/settings/checks");
    expect(screen.getByText("No files attached yet")).toBeDefined();
  });

  test("an owner who can't edit the project is told to ask an admin", () => {
    queries.checks = { checklists: [], checklistId: null, checks: [] };
    queries.files = [];
    queries.role = "member";
    render(<EvidencePanel threadId={threadId} thread={{ taskId }} isOwner projectRoute={route} projectId={projectId} />);
    expect(screen.queryByRole("link", { name: "Add checks" })).toBeNull();
    expect(screen.getByText(/Ask a project admin/)).toBeDefined();
  });

  test("a viewer sees the empty states without actions", () => {
    queries.checks = { checklists: [], checklistId: null, checks: [] };
    queries.files = [];
    queries.role = "project-admin";
    render(<EvidencePanel threadId={threadId} thread={{ taskId }} projectRoute={route} projectId={projectId} />);
    expect(screen.getByText("No checks yet")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Add checks" })).toBeNull();
    expect(screen.queryByText(/Ask a project admin/)).toBeNull();
  });

  test("a viewer sees the Checks heading read-only when the thread has No checks picked", () => {
    queries.checks = {
      checklists: [{ _id: "checklist_1", name: "Feature", isDefault: false, checkKeys: ["tests"], taskTypeKeys: [] }],
      checklistId: null,
      checks: [],
    };
    queries.files = [];
    render(<EvidencePanel threadId={threadId} thread={{ taskId }} projectRoute={route} projectId={projectId} />);
    expect(screen.getByRole("heading", { name: "Checks" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Run checks" })).toBeNull();
  });

  test("a skeleton while the evidence loads", () => {
    const { container } = render(<EvidencePanel threadId={threadId} thread={null} projectRoute={route} />);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });
});

describe("EvidencePanel Run checks (OS-2292)", () => {
  const projectId = "project_1" as Id<"projects">;
  const checklistId = "checklist_1";
  afterEach(() => {
    cleanup();
    queries.checks = undefined;
    queries.role = undefined;
  });

  const renderPanel = (taskArchived: boolean) => {
    queries.checks = {
      checklists: [{ _id: checklistId, name: "Feature", isDefault: true, checkKeys: ["tests"], taskTypeKeys: ["feature"] }],
      checklistId,
      checks: [{ key: "tests", label: "All tests pass", instruction: "", added: false, results: [result([])] }],
    };
    queries.files = [];
    render(<EvidencePanel threadId={threadId} thread={{ taskId, taskArchived }} isOwner projectRoute={route} projectId={projectId} />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Run checks" }));
    return screen.getByRole("menuitemradio", { name: "No checks" }).getAttribute("aria-disabled");
  };

  test("a member can switch the checklist", () => {
    queries.role = "member";
    expect(renderPanel(false)).toBeNull();
  });

  test("an archived task or a viewer role cannot (CR round 1 #1)", () => {
    queries.role = "member";
    expect(renderPanel(true)).toBe("true");
    cleanup();
    queries.role = "viewer";
    expect(renderPanel(false)).toBe("true");
  });
});
