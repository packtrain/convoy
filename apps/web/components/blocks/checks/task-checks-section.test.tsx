/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskChecksSection } from "./task-checks-section";
import { ReplyChecks } from "./reply-checks";
import type { CheckResult, TaskChecks } from "./types";

const queryMock = vi.hoisted(() => ({ current: undefined as unknown }));
const routeParams = vi.hoisted(() => ({ current: {} as Record<string, string> }));
const mutations = vi.hoisted(() => ({ send: vi.fn(), setChecklist: vi.fn(), setThreadChecklist: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => routeParams.current,
  usePathname: () => "/o/acme/OS",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : queryMock.current),
  useMutation: (name: keyof typeof mutations) => mutations[name] ?? vi.fn(),
  useConvex: () => ({ query: vi.fn(() => new Promise(() => undefined)) }),
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    checks: { checklists: { getForTask: "getForTask", getForThread: "getForThread" }, results: { getFileUrls: "getFileUrls" } },
    tasks: { core: { setChecklist: "setChecklist" } },
    cli: {
      messages: { getMessageAttachmentUrls: "getMessageAttachmentUrls", send: "send" },
      threads: { core: { setChecklist: "setThreadChecklist" } },
    },
  },
}));

const taskId = "task_1" as Id<"tasks">;
const feature = "checklist_feature" as Id<"checklists">;
const route = { organizationSlug: "acme", projectAlias: "OS" };

function result(overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    _id: "result_1" as Id<"checkResults">,
    messageId: "message_1" as Id<"cliMessages">,
    threadId: "thread_1" as Id<"cliThreads">,
    threadTitle: "Build login",
    reporterName: "Ada",
    reportedByViewer: false,
    status: "passed",
    files: [],
    reportedAt: Date.now(),
    ...overrides,
  } as CheckResult;
}

function taskChecks(overrides: Partial<TaskChecks> = {}): TaskChecks {
  return {
    checklists: [{ _id: feature, name: "Feature", isDefault: true, checkKeys: ["tests", "ui"], taskTypeKeys: ["feature"] }],
    checklistId: feature,
    followsTypeDefault: true,
    catalog: [],
    checks: [
      { key: "tests", label: "All tests pass", instruction: "", added: false, results: [] },
      { key: "ui", label: "UI verified", instruction: "", added: false, results: [] },
    ],
    ...overrides,
  };
}

describe("TaskChecksSection", () => {
  afterEach(() => {
    cleanup();
    queryMock.current = undefined;
    routeParams.current = {};
  });

  test("shows the checklist in effect and its pending checks", () => {
    queryMock.current = taskChecks();
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);

    expect(screen.getByRole("combobox", { name: "Checklist" }).textContent).toBe("Feature");
    expect(screen.getByText("0/2")).toBeDefined();
    expect(screen.getByText("All tests pass")).toBeDefined();
    expect(screen.getAllByLabelText("Pending")).toHaveLength(2);
  });

  test("the heading links to the Checks docs, in the sidebar and the Checks tab", () => {
    queryMock.current = taskChecks();
    const { rerender } = render(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);
    expect(screen.getByRole("link", { name: "About checks" }).getAttribute("href")).toBe("https://docs.convoy.build/docs/using/checks");

    rerender(<TaskChecksSection taskId={taskId} readOnlyReason={null} surface="tab" />);
    expect(screen.getByRole("link", { name: "About checks" }).getAttribute("target")).toBe("_blank");
  });

  test("No checks shows the empty line and no pass count", () => {
    queryMock.current = taskChecks({ checklistId: null, checks: [] });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);

    expect(screen.getByRole("combobox", { name: "Checklist" }).textContent).toBe("No checks");
    expect(screen.getAllByText("No checks")).toHaveLength(2);
    expect(screen.queryByText(/^0\//)).toBeNull();
  });

  test("a read-only role sees the checklist as plain text", () => {
    queryMock.current = taskChecks();
    render(<TaskChecksSection taskId={taskId} readOnlyReason="View only" />);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTitle("View only").textContent).toBe("Feature");
  });

  test("renders nothing while loading or when the project has no checklists", () => {
    const { container, rerender } = render(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);
    expect(container.firstChild).toBeNull();

    queryMock.current = taskChecks({ checklists: [], checklistId: null, checks: [] });
    rerender(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);
    expect(container.firstChild).toBeNull();
  });

  test("counts a warning as passed, and a teammate's result reads as plain text with history", () => {
    queryMock.current = taskChecks({
      checks: [
        {
          key: "tests",
          label: "All tests pass",
          instruction: "",
          added: false,
          results: [
            result({ status: "warning", note: "One flaky test" }),
            result({ _id: "result_0" as Id<"checkResults">, status: "failed", note: "3 failing" }),
          ],
        },
        { key: "mobile", label: "Mobile layout", instruction: "", added: true, results: [result({ _id: "result_2" as Id<"checkResults"> })] },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} />);

    expect(screen.getByText("2/2")).toBeDefined();
    expect(screen.getByText("Added")).toBeDefined();
    fireEvent.click(screen.getByText("All tests pass"));
    expect(screen.getByText("One flaky test")).toBeDefined();
    expect(screen.getByText(/Reported by Ada in/)).toBeDefined();
    expect(screen.queryByRole("link", { name: "Build login" })).toBeNull();
    expect(screen.getByText("Earlier")).toBeDefined();
    expect(screen.getByText(/3 failing/)).toBeDefined();
  });

  test("the viewer's own result links to its thread, and image evidence starts expanded", () => {
    const shot = { storageId: "storage_1", fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 };
    queryMock.current = taskChecks({
      checks: [
        { key: "ui", label: "UI verified", instruction: "", added: false, results: [result({ reportedByViewer: true, files: [shot as never] })] },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} surface="tab" />);

    expect(screen.getByRole("link", { name: "Build login" }).getAttribute("href")).toBe("/o/acme/OS/threads/thread_1");
    expect(screen.getByText(/Reported in/)).toBeDefined();
  });

  test("a result from the thread being viewed reads as plain text, not a link that resets the page", () => {
    routeParams.current = { threadId: "thread_1" };
    queryMock.current = taskChecks({
      checks: [{ key: "ui", label: "UI verified", instruction: "", added: false, results: [result({ reportedByViewer: true })] }],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} />);

    fireEvent.click(screen.getByText("UI verified"));
    expect(screen.getByText(/Reported in this thread/)).toBeDefined();
    expect(screen.queryByRole("link", { name: "Build login" })).toBeNull();
  });

  test("an earlier result keeps its files reachable (CR round 1 #1)", () => {
    const old = { storageId: "storage_old", fileName: "old.log", fileSize: 4, contentType: "text/plain", uploadedAt: 1 };
    queryMock.current = taskChecks({
      checks: [
        {
          key: "tests",
          label: "All tests pass",
          instruction: "",
          added: false,
          results: [result(), result({ _id: "result_0" as Id<"checkResults">, status: "failed", note: "3 failing", files: [old as never] })],
        },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);

    fireEvent.click(screen.getByText("All tests pass"));
    expect(screen.getByText("old.log")).toBeDefined();
  });

  test("a pending row that gets an image result opens without a click (CR round 1 #2)", () => {
    queryMock.current = taskChecks();
    const { rerender } = render(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);
    expect(screen.queryByText(/Reported by/)).toBeNull();

    const shot = { storageId: "storage_1", fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 };
    queryMock.current = taskChecks({
      checks: [{ key: "ui", label: "UI verified", instruction: "", added: false, results: [result({ files: [shot as never] })] }],
    });
    rerender(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);
    expect(screen.getByText(/Reported by Ada/)).toBeDefined();
  });
});

describe("Run checks menu (OS-2292)", () => {
  const threadId = "thread_1" as Id<"cliThreads">;
  const bugFix = "checklist_bug" as Id<"checklists">;

  beforeEach(() => {
    mutations.send.mockReset().mockResolvedValue("message_1");
    mutations.setChecklist.mockReset().mockResolvedValue(null);
    mutations.setThreadChecklist.mockReset().mockResolvedValue(null);
  });
  afterEach(() => {
    cleanup();
    queryMock.current = undefined;
  });

  const openMenu = () => fireEvent.pointerDown(screen.getByRole("button", { name: "Run checks" }));

  const mixed = () =>
    taskChecks({
      checklists: [
        { _id: feature, name: "Feature", isDefault: true, checkKeys: ["tests", "ui", "lint"], taskTypeKeys: ["feature"] },
        { _id: bugFix, name: "Bug fix", isDefault: false, checkKeys: ["tests"], taskTypeKeys: [] },
      ],
      checks: [
        { key: "tests", label: "All tests pass", instruction: "Run the test suite and attach the output", added: false, results: [result({ status: "failed", note: "3 failing" })] },
        { key: "ui", label: "UI verified", instruction: "", added: false, results: [] },
        { key: "lint", label: "Lint is clean", instruction: "Run pnpm lint", added: false, results: [result({ status: "passed" })] },
      ],
    });

  test("Pending and failed sends the thread a prompt naming only those checks", () => {
    queryMock.current = mixed();
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} surface="tab" runThreadId={threadId} />);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Pending and failed" }));

    expect(mutations.send).toHaveBeenCalledTimes(1);
    const { threadId: sentTo, content } = mutations.send.mock.calls[0][0];
    expect(sentTo).toBe(threadId);
    expect(content).toContain("`tests` All tests pass: Run the test suite and attach the output");
    expect(content).toContain("`ui` UI verified");
    expect(content).not.toContain("`lint`");
    expect(content).toContain(`convoy threads attach ${threadId} [file...] --check <key>`);
  });

  test("All checks sends every row", () => {
    queryMock.current = mixed();
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} surface="tab" runThreadId={threadId} />);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "All checks" }));

    const { content } = mutations.send.mock.calls[0][0];
    expect(content).toContain("`tests`");
    expect(content).toContain("`ui`");
    expect(content).toContain("`lint` Lint is clean: Run pnpm lint");
  });

  test("Pending and failed is disabled when every check passed", () => {
    queryMock.current = taskChecks({
      checks: [{ key: "tests", label: "All tests pass", instruction: "", added: false, results: [result({ status: "passed" })] }],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} surface="tab" runThreadId={threadId} />);

    openMenu();
    expect(screen.getByRole("menuitem", { name: "Pending and failed" }).getAttribute("aria-disabled")).toBe("true");
  });

  test("Switch checklist marks the current one and switches the task", () => {
    queryMock.current = mixed();
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} surface="tab" runThreadId={threadId} />);

    openMenu();
    expect(screen.getByRole("menuitemradio", { name: /Feature/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Bug fix" }));
    expect(mutations.setChecklist).toHaveBeenCalledWith({ taskId, checklistId: bugFix });
  });

  test("with No checks, the tab still offers Switch checklist and nothing to run", () => {
    queryMock.current = taskChecks({ checklistId: null, checks: [] });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} surface="tab" runThreadId={threadId} />);

    openMenu();
    expect(screen.queryByRole("menuitem", { name: "All checks" })).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "No checks" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Feature/ }));
    expect(mutations.setChecklist).toHaveBeenCalledWith({ taskId, checklistId: feature });
  });

  test("a thread with no task runs and switches its own checks (OS-2293)", () => {
    queryMock.current = taskChecks({ checklists: [{ ...taskChecks().checklists[0], isDefault: false }] });
    render(<TaskChecksSection taskId={undefined} threadId={threadId} readOnlyReason={null} surface="tab" runThreadId={threadId} />);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "All checks" }));
    expect(mutations.send.mock.calls[0][0].content).toContain("Run all checks for this thread:");
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No checks" }));
    expect(mutations.setThreadChecklist).toHaveBeenCalledWith({ threadId, checklistId: null });
    expect(mutations.setChecklist).not.toHaveBeenCalled();
  });

  test("a read-only task keeps Run checks but disables Switch checklist (CR round 1 #1)", () => {
    queryMock.current = mixed();
    render(<TaskChecksSection taskId={taskId} readOnlyReason="Archived tasks are read-only" surface="tab" runThreadId={threadId} />);

    openMenu();
    expect(screen.getByRole("menuitem", { name: "All checks" }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByRole("menuitemradio", { name: "Bug fix" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Archived tasks are read-only")).toBeDefined();
  });

  test("a check outside the catalog tells the agent to pass its label (CR round 1 #2)", () => {
    queryMock.current = taskChecks({
      catalog: [{ key: "tests", label: "All tests pass", instruction: "" }],
      checks: [
        { key: "tests", label: "All tests pass", instruction: "", added: false, results: [] },
        { key: "mobile", label: "Mobile layout", instruction: "", added: true, results: [result({ status: "failed", note: "Overflows" })] },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} surface="tab" runThreadId={threadId} />);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Pending and failed" }));
    const { content } = mutations.send.mock.calls[0][0];
    expect(content).toContain('- `mobile` Mobile layout (not in the catalog: add --label "Mobile layout")');
    expect(content).not.toContain('--label "All tests pass"');
  });

  test("a viewer who cannot send to the thread gets no menu", () => {
    queryMock.current = mixed();
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} surface="tab" />);

    expect(screen.queryByRole("button", { name: "Run checks" })).toBeNull();
  });
});

describe("ReplyChecks", () => {
  afterEach(() => {
    cleanup();
    queryMock.current = undefined;
  });

  test("a reply that reported checks shows the card with Not reported rows, and moves its evidence into it", () => {
    const log = { storageId: "storage_log", fileName: "out.log", fileSize: 4, contentType: "text/plain", uploadedAt: 1 };
    const other = { storageId: "storage_other", fileName: "debug.txt", fileSize: 4, contentType: "text/plain", uploadedAt: 1 };
    queryMock.current = taskChecks({
      checks: [
        { key: "tests", label: "All tests pass", instruction: "", added: false, results: [result({ status: "failed", note: "3 failing", files: [log as never] })] },
        { key: "ui", label: "UI verified", instruction: "", added: false, results: [] },
        // Reported by another run: not this card's.
        { key: "mobile", label: "Mobile", instruction: "", added: true, results: [result({ messageId: "message_2" as Id<"cliMessages"> })] },
      ],
    });
    render(<ReplyChecks threadId={undefined} taskId={taskId} messageId="message_1" attachments={[log, other]} />);

    expect(screen.getByText("0/2 checks passed")).toBeDefined();
    // The card's icon follows its worst status, like the row's (CR round 1 #3).
    expect(screen.getAllByLabelText("Failed")).toHaveLength(2);
    expect(screen.getByText("Feature · 1 failed · 1 pending")).toBeDefined();
    expect(screen.getByText("Not reported")).toBeDefined();
    expect(screen.queryByText("Mobile")).toBeNull();
    expect(screen.getByText("debug.txt")).toBeDefined();
    expect(screen.queryByText("out.log")).toBeNull();
  });

  test("a reply with no results shows only its files", () => {
    const other = { storageId: "storage_other", fileName: "debug.txt", fileSize: 4, contentType: "text/plain", uploadedAt: 1 };
    queryMock.current = taskChecks();
    render(<ReplyChecks threadId={undefined} taskId={taskId} messageId="message_1" attachments={[other]} />);

    expect(screen.queryByText(/checks passed/)).toBeNull();
    expect(screen.getByText("debug.txt")).toBeDefined();
  });
});
