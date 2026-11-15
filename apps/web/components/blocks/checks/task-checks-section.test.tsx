/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskChecksSection } from "./task-checks-section";
import { ReplyChecks } from "./reply-checks";
import type { CheckResult, TaskChecks } from "./types";

const queryMock = vi.hoisted(() => ({ current: undefined as unknown }));
const routeParams = vi.hoisted(() => ({ current: {} as Record<string, string> }));
const fileUrls = vi.hoisted(() => ({ current: undefined as Promise<unknown> | undefined }));
const mutations = vi.hoisted(() => ({ send: vi.fn(), setChecklist: vi.fn(), setThreadChecklist: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => routeParams.current,
  usePathname: () => "/o/acme/OS",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => (args === "skip" ? undefined : queryMock.current),
  useMutation: (name: keyof typeof mutations) => mutations[name] ?? vi.fn(),
  useConvex: () => ({ query: vi.fn(() => fileUrls.current ?? new Promise(() => undefined)) }),
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
    expect(screen.getByTitle("Build login").textContent).toBe("Reported just now by Ada in “Build login”");
    expect(screen.queryByRole("link", { name: "Build login" })).toBeNull();
    expect(screen.queryByText(/3 failing/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /older result/ }));
    expect(screen.getByText("Older result")).toBeDefined();
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
    expect((document.querySelector("footer") as HTMLElement).textContent).toBe("Reported just now in “Build login”");
  });

  test("a result from the thread being viewed reads as plain text, not a link that resets the page", () => {
    routeParams.current = { threadId: "thread_1" };
    queryMock.current = taskChecks({
      checks: [{ key: "ui", label: "UI verified", instruction: "", added: false, results: [result({ reportedByViewer: true })] }],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} />);

    fireEvent.click(screen.getByText("UI verified"));
    // In the thread being viewed, Reported is only the time.
    expect((document.querySelector("footer") as HTMLElement).textContent).toBe("Reported just now");
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
    fireEvent.click(screen.getByRole("button", { name: /older result/ }));
    expect(screen.getByText("old.log")).toBeDefined();
  });

  test("a pending row that gets an image result opens without a click (CR round 1 #2)", () => {
    queryMock.current = taskChecks();
    const { rerender } = render(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);
    expect(screen.queryByText(/by Ada in/)).toBeNull();

    const shot = { storageId: "storage_1", fileName: "shot.png", fileSize: 4, contentType: "image/png", uploadedAt: 1 };
    queryMock.current = taskChecks({
      checks: [{ key: "ui", label: "UI verified", instruction: "", added: false, results: [result({ files: [shot as never] })] }],
    });
    rerender(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);
    expect(screen.getByText(/by Ada in/)).toBeDefined();
  });
});

describe("Check values and artifacts (OS-2385)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cleanup();
    queryMock.current = undefined;
    routeParams.current = {};
  });

  const long = `+1 index scan ${"on tasks by list ".repeat(20)}`.trim();

  test("a value stays on one line in the header; the body repeats it only when the header cuts it off", () => {
    queryMock.current = taskChecks({
      checks: [
        {
          key: "perf",
          label: "Performance impact",
          instruction: "",
          added: false,
          results: [
            result({ status: "warning", value: long, note: "Scan on tasks by list" }),
            result({ _id: "result_0" as Id<"checkResults">, value: "+0" }),
          ],
        },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} />);

    const onRow = screen.getByTitle(long);
    expect(onRow.textContent).toBe(long);
    expect(onRow.className).toContain("truncate");
    expect(screen.getAllByText(long)).toHaveLength(1);

    // jsdom reports 0px widths, so the value fits: open, it is not repeated (UX review #1).
    fireEvent.click(screen.getByText("Performance impact"));
    expect(screen.getAllByText(long)).toHaveLength(1);
    expect(onRow.className).not.toMatch(/whitespace-normal/);
    expect(screen.getByText("Scan on tasks by list")).toBeDefined();
    // A history row shows its own value.
    fireEvent.click(screen.getByRole("button", { name: /older result/ }));
    expect(screen.getByText(/\+0/)).toBeDefined();
  });

  test("a value the header cuts off shows in full in the body (UX review 2 #1)", () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400);
    const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      }
    );
    queryMock.current = taskChecks({
      checks: [{ key: "perf", label: "Performance impact", instruction: "", added: false, results: [result({ status: "warning", value: long, note: "Scan" })] }],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} />);

    fireEvent.click(screen.getByText("Performance impact"));
    const [header, body] = screen.getAllByText(long);
    expect(header.className).toContain("truncate");
    expect(body.className).toContain("whitespace-pre-wrap");
    scroll.mockRestore();
    client.mockRestore();
    vi.unstubAllGlobals();
  });

  test("a previous result reads as its value and note, then when and where (UX review 2 #2)", () => {
    queryMock.current = taskChecks({
      checks: [
        {
          key: "db",
          label: "Extra database requests",
          instruction: "",
          added: false,
          results: [result({ status: "warning", note: "Rechecked" }), result({ _id: "result_0" as Id<"checkResults">, status: "warning", value: "+3", note: "Reads labels per row" })],
        },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} />);

    fireEvent.click(screen.getByText("Extra database requests"));
    fireEvent.click(screen.getByRole("button", { name: /older result/ }));
    const value = screen.getByText("+3");
    expect(value.closest("p")?.textContent).toBe("+3 · Reads labels per row");
    const where = screen.getAllByTitle("Build login").at(-1) as HTMLElement;
    expect(where.className).toContain("truncate");
    expect(value.compareDocumentPosition(where) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("an artifact is a pill under Attachments, and earlier results keep theirs", () => {
    queryMock.current = taskChecks({
      checks: [
        {
          key: "test-cases",
          label: "Manual test cases",
          instruction: "",
          added: false,
          results: [
            result({ value: "12 cases", artifactId: "artifact_1" as Id<"taskArtifacts">, artifactName: "Test plan" }),
            result({ _id: "result_0" as Id<"checkResults">, artifactId: "artifact_0" as Id<"taskArtifacts">, artifactName: "Old plan" }),
          ],
        },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} surface="tab" />);

    // The header holds no pill (playground decision, OS-2385).
    expect(screen.queryByRole("link", { name: "Test plan" })).toBeNull();
    fireEvent.click(screen.getByText("Manual test cases"));
    const pill = screen.getByRole("link", { name: "Test plan" });
    expect(pill.getAttribute("href")).toBe("/o/acme/OS/artifacts/artifact_1");
    expect(screen.getByText("Attachments").parentElement?.contains(pill)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /older result/ }));
    expect(screen.getByRole("link", { name: "Old plan" }).getAttribute("href")).toBe("/o/acme/OS/artifacts/artifact_0");
  });

  test("the header is one button: label and value split the free space, and the chevron is inside (CR round 1 #1)", () => {
    queryMock.current = taskChecks({
      checks: [
        {
          key: "perf",
          label: "Performance impact",
          instruction: "",
          added: true,
          results: [result({ value: long, artifactId: "artifact_1" as Id<"taskArtifacts">, artifactName: "A very long artifact name" })],
        },
      ],
    });
    const { container } = render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} surface="tab" />);

    // Both grow from a zero basis, so the value takes at most half and never squeezes the label to nothing.
    expect(screen.getByText("Performance impact").className).toMatch(/\bflex-1\b/);
    expect(screen.getByTitle(long).className).toMatch(/\bflex-1\b.*\bmax-w-fit\b|\bmax-w-fit\b.*\bflex-1\b/);
    const trigger = screen.getByText("Performance impact").closest("button");
    expect(trigger?.contains(container.querySelector(".lucide-chevron-right"))).toBe(true);
    expect(trigger?.querySelector("a")).toBeNull();
  });

  test("the open row is one card: labeled Value, Description and Attachments, then an unlabeled footer", () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400);
    const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: () => void) {}
        observe() {
          this.callback();
        }
        disconnect() {}
      }
    );
    const log = { storageId: "storage_log", fileName: "out.log", fileSize: 4, contentType: "text/plain", uploadedAt: 1 };
    queryMock.current = taskChecks({
      checks: [
        {
          key: "perf",
          label: "Performance impact",
          instruction: "",
          added: false,
          results: [result({ status: "failed", value: long, note: "Scan on tasks by list", files: [log as never], artifactId: "artifact_1" as Id<"taskArtifacts">, artifactName: "Plan" })],
        },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} />);

    fireEvent.click(screen.getByText("Performance impact"));
    const labels = ["Value", "Description", "Attachments"].map((text) => screen.getByText(text));
    const card = labels[0].parentElement?.parentElement;
    expect(card?.className).toContain("divide-y");
    // Same corner radius as the header's hover background.
    expect(card?.className).toMatch(/\brounded-md\b/);
    expect(screen.getByText("Performance impact").closest("button")?.className).toMatch(/\brounded-md\b/);
    for (const label of labels) expect(label.parentElement?.parentElement).toBe(card);
    expect(screen.queryByText("Reported")).toBeNull();
    const footer = (document.querySelector("footer") as HTMLElement);
    expect(card?.lastElementChild).toBe(footer);
    expect(footer.className).toMatch(/\btext-xs\b.*\btext-muted-foreground\b|\btext-muted-foreground\b.*\btext-xs\b/);
    // The section heading says what the note is, so it has no "Failed:" prefix.
    expect(screen.getByText("Scan on tasks by list").textContent).toBe("Scan on tasks by list");
    expect(screen.queryByText(/Failed:/)).toBeNull();
    expect(screen.getByText("out.log")).toBeDefined();
    scroll.mockRestore();
    client.mockRestore();
    vi.unstubAllGlobals();
  });

  test("an inline html file shows as its card only, without the page preview (UX review #2)", async () => {
    const page = { storageId: "storage_1", fileName: "perf.html", fileSize: 523, contentType: "text/html", uploadedAt: 1, display: "inline" };
    fileUrls.current = Promise.resolve([{ storageId: "storage_1", url: "https://files.test/perf.html" }]);
    queryMock.current = taskChecks({
      checks: [{ key: "perf", label: "Performance impact", instruction: "", added: false, results: [result({ files: [page as never] })] }],
    });
    const { container } = render(<TaskChecksSection taskId={taskId} readOnlyReason={null} projectRoute={route} surface="tab" />);

    fireEvent.click(screen.getByText("Performance impact"));
    expect(container.querySelector(".h-60")).toBeNull();
    await act(async () => {
      await fileUrls.current;
    });
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("perf.html")).toBeDefined();
    fileUrls.current = undefined;
  });

  test("an earlier long value wraps as its own block (CR round 1 #2)", () => {
    const unbroken = "x".repeat(500);
    queryMock.current = taskChecks({
      checks: [
        {
          key: "perf",
          label: "Performance impact",
          instruction: "",
          added: false,
          results: [result(), result({ _id: "result_0" as Id<"checkResults">, value: unbroken })],
        },
      ],
    });
    render(<TaskChecksSection taskId={taskId} readOnlyReason={null} />);

    fireEvent.click(screen.getByText("Performance impact"));
    fireEvent.click(screen.getByRole("button", { name: /older result/ }));
    const earlier = screen.getByText(unbroken).closest("p") as HTMLElement;
    expect(earlier.className).toContain("break-words");
    expect(earlier.className).toContain("whitespace-pre-wrap");
  });

  test("the transcript card shows the value and the pill, linked through the page's project", () => {
    routeParams.current = { organizationSlug: "acme", projectAlias: "OS" };
    queryMock.current = taskChecks({
      checks: [
        {
          key: "tests",
          label: "All tests pass",
          instruction: "",
          added: false,
          results: [result({ value: "412 passed", artifactId: "artifact_1" as Id<"taskArtifacts">, artifactName: "Test plan" })],
        },
      ],
    });
    render(<ReplyChecks threadId={undefined} taskId={taskId} messageId="message_1" attachments={[]} />);

    expect(screen.getByTitle("412 passed")).toBeDefined();
    fireEvent.click(screen.getByText("All tests pass"));
    // Inside the transcript card the parts stack plainly: no tinted box, no dividers.
    const parts = screen.getByText("Attachments").parentElement?.parentElement;
    expect(parts?.className).not.toMatch(/divide-y|bg-muted/);
    expect(screen.getByRole("link", { name: "Test plan" }).getAttribute("href")).toBe("/o/acme/OS/artifacts/artifact_1");
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
