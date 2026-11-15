/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { format, formatDistanceToNow } from "date-fns";
import type { Id } from "@/convex/_generated/dataModel";
import { Status, type Task } from "@/lib/tasks/types";
import { getDefaultTaskTypeSummary } from "@/lib/tasks/task-types";
import { withProjectRole } from "@/test-utils/project-role";
import { TaskDetailSidebar } from "./task-detail-sidebar";

const uploadFilesMock = vi.hoisted(() => vi.fn());
const createArtifactMock = vi.hoisted(() => vi.fn());
const taskArtifactPanelMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const baseTaskForPasteTests: Task = {
  delegatedToAgent: null,
  _id: "task_paste_base" as Task["_id"],
  clientId: "task_paste_base",
  refNumber: 100,
  refId: "ABC-100",
  name: "Task name",
  description: null,
  taskType: getDefaultTaskTypeSummary(),
  priority: "None",
  dueDate: null,
  status: Status.TODO,
  assignee: null,
  tags: [],
  rank: "0|hzzzzz:",
  parentId: null,
  createdAt: Date.now(),
  isArchived: false,
};

function createPasteTestTask(overrides: Partial<Task>): Task {
  return {
    ...baseTaskForPasteTests,
    ...overrides,
    assignee: overrides.assignee ?? baseTaskForPasteTests.assignee,
  };
}

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    onClick,
    asChild,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    asChild?: boolean;
    [key: string]: unknown;
  }) => (
    <button type="button" className={className} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex/react")>();
  return {
    ...actual,
    useQuery: useQueryMock,
  };
});

vi.mock("@/components/blocks/tasks/task-ref-with-type", () => ({
  TaskRef: ({ refId }: { refId: string }) => <span>{refId}</span>,
  TaskTypeSelector: () => <span>type-selector</span>,
  TaskType: () => <span>type</span>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: () => null,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/blocks/tasks/task-table/badges", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  PriorityIcon: ({ priority }: { priority: string }) => <span>{priority}</span>,
}));

vi.mock("@/components/blocks/tasks/task-table/cells/assignee-selector", () => ({
  AssigneeSelector: () => <div>Assignee</div>,
}));

vi.mock("@/components/lingua-time/datetime-picker", () => ({
  DateTimePicker: () => <button type="button">Due date</button>,
}));

vi.mock("@/components/blocks/tasks/task-table", () => ({
  TaskTable: () => <div>Task table</div>,
}));

vi.mock("@/components/blocks/tasks/multi-select-toolbar", () => ({
  MultiSelectToolbar: () => <div>Multi select toolbar</div>,
}));

vi.mock("@/components/blocks/attachment-drop-zone", () => ({
  AttachmentDropZone: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/blocks/tasks/task-description-editor", () => ({
  TaskDescriptionEditor: ({ disabled }: { disabled?: boolean }) => (
    <div data-task-description-editor="true" data-disabled={String(Boolean(disabled))}>
      Description editor
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-artifacts-section", () => ({
  TaskArtifactsSection: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="artifacts-section" data-disabled={String(Boolean(disabled))}>Artifacts</div>
  ),
}));

vi.mock("@/components/blocks/checks", () => ({
  TaskChecksSection: ({ readOnlyReason }: { readOnlyReason: string | null }) => (
    <div data-testid="checks-section" data-read-only={String(readOnlyReason !== null)} />
  ),
}));

vi.mock("@/components/blocks/tasks/task-artifact-panel", () => ({
  TaskArtifactPanel: (props: unknown) => {
    taskArtifactPanelMock(props);
    return <div>Artifact panel</div>;
  },
}));

// The timeline owns the stream and the in-stream composer now; the sidebar's
// job is to mount it and route the metadata row's "+" into its thread side.
vi.mock("@/components/blocks/tasks/task-timeline", () => ({
  TaskTimeline: ({
    composerMode,
    threadFocusRequestKey,
    canComment,
    threadContext,
  }: {
    composerMode: string;
    threadFocusRequestKey: number;
    canComment?: boolean;
    threadContext?: unknown;
  }) => (
    <div data-testid="mock-timeline" data-can-comment={String(canComment ?? true)} data-has-threads={String(Boolean(threadContext))}>
      <span>Timeline content</span>
      {/*
        The in-stream comment composer lives here now, but the sidebar still
        owns the paste fallback that must skip it — so the mock keeps the
        `data-task-comment-input` marker that guard looks for.
      */}
      <textarea data-task-comment-input="true" aria-label="Mock comment input" />
      <textarea aria-label="Mock thread composer input" />
      <span data-testid="mock-composer-mode">{composerMode}</span>
      <span data-testid="mock-thread-focus-request">{String(threadFocusRequestKey)}</span>
    </div>
  ),
}));

vi.mock("@/components/blocks/tasks/task-table/hooks/use-task-table-controller", () => ({
  useTaskTableController: () => ({}),
}));

vi.mock("@/lib/tasks/hooks/use-task-attachments", () => ({
  useTaskAttachments: () => ({
    attachments: [],
    uploadFiles: uploadFilesMock,
    deleteAttachment: vi.fn(),
    uploading: [],
  }),
}));

vi.mock("@/lib/tasks/hooks/use-task-artifacts", () => ({
  useTaskArtifacts: () => ({
    artifacts: [],
    createArtifact: createArtifactMock,
    updateArtifact: vi.fn(),
    deleteArtifact: vi.fn(),
  }),
}));

describe("TaskDetailSidebar", () => {
  beforeEach(() => {
    useQueryMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    uploadFilesMock.mockReset();
    createArtifactMock.mockReset();
    taskArtifactPanelMock.mockReset();
    useQueryMock.mockReset();
    cleanup();
  });

  test("applies cursor-pointer class to status and priority selector triggers", () => {
    const task: Task = {
      delegatedToAgent: null,
      _id: "task_1" as Task["_id"],
      clientId: "task_1",
      refNumber: 1,
      refId: "ABC-1",
      name: "Task name",
      description: null,
      taskType: getDefaultTaskTypeSummary(),
      priority: "Medium",
      dueDate: null,
      status: Status.TODO,
      assignee: null,
      tags: [],
      rank: "0|hzzzzz:",
      parentId: null,
      createdAt: Date.now(),
      isArchived: false,
    };

    render(<TaskDetailSidebar task={task} onClose={vi.fn()} onUpdate={vi.fn()} />);

    const statusTrigger = screen.getByRole("button", { name: task.status });
    expect(statusTrigger.className).toContain("cursor-pointer");

    const priorityTrigger = screen.getByRole("button", { name: /Medium/ });
    expect(priorityTrigger.className).toContain("cursor-pointer");
    expect(screen.getByText(/by Unknown/)).toBeDefined();
  });

  test("renders created metadata with creator, relative time, and full datetime hover", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T12:00:00.000Z"));

    const createdAt = new Date("2026-02-16T12:00:00.000Z").getTime();
    const createdRelativeTime = formatDistanceToNow(new Date(createdAt), {
      addSuffix: true,
    });
    const createdFullDateTime = format(new Date(createdAt), "PPpp");

    const task: Task = {
      delegatedToAgent: null,
      _id: "task_2" as Task["_id"],
      clientId: "task_2",
      refNumber: 2,
      refId: "ABC-2",
      name: "Task name",
      description: null,
      taskType: getDefaultTaskTypeSummary(),
      priority: "Medium",
      dueDate: null,
      status: Status.TODO,
      assignee: null,
      tags: [],
      rank: "0|hzzzzz:",
      parentId: null,
      createdByName: "Jane Doe",
      createdAt,
      isArchived: false,
    };

    render(<TaskDetailSidebar task={task} onClose={vi.fn()} onUpdate={vi.fn()} />);

    const createdValue = screen.getByText(`by ${task.createdByName} ${createdRelativeTime}`);
    expect(createdValue.getAttribute("title")).toBe(createdFullDateTime);
  });

  test("renders one merged timeline where the tabs used to be", async () => {
    useQueryMock.mockImplementation(withProjectRole("member"));
    const task = createPasteTestTask({
      _id: "task_timeline_1" as Task["_id"],
      clientId: "task_timeline_1",
      refNumber: 10,
      refId: "ABC-10",
    });

    render(
      <TaskDetailSidebar
        task={task}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        projectId={"project_1" as Id<"projects">}
        organizationSlug="contoso"
        projectAlias="OS"
      />
    );

    expect(await screen.findByText("Timeline content")).toBeTruthy();

    // The tabs and their labels are gone — there is nothing to switch between.
    for (const label of ["Comments", "All activity"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
    // "Threads" survives only as the metadata row's label, never as a tab.
    expect(screen.queryByRole("button", { name: "Threads" })).toBeNull();

    // The thread side is open by default (docs/specs/task-timeline.md).
    expect(screen.getByTestId("mock-composer-mode").textContent).toBe("thread");
  });

  test("metadata-row plus action bumps the timeline composer focus request", async () => {
    useQueryMock.mockImplementation(withProjectRole("member", () => []));

    const task = createPasteTestTask({
      _id: "task_timeline_2" as Task["_id"],
      clientId: "task_timeline_2",
      refNumber: 12,
      refId: "ABC-12",
    });

    render(
      <TaskDetailSidebar
        task={task}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        projectId={"project_1" as Id<"projects">}
        organizationSlug="contoso"
        projectAlias="OS"
      />
    );

    await screen.findByText("Timeline content");

    fireEvent.click(screen.getByRole("button", { name: "Open threads composer" }));

    await waitFor(() => {
      expect(screen.getByTestId("mock-thread-focus-request").textContent).toBe("1");
    });
    expect(screen.getByTestId("mock-composer-mode").textContent).toBe("thread");

    // Each press is a fresh focus request: the composer only takes focus when
    // the key changes, so a repeat press must still refocus it.
    fireEvent.click(screen.getByRole("button", { name: "Open threads composer" }));

    await waitFor(() => {
      expect(screen.getByTestId("mock-thread-focus-request").textContent).toBe("2");
    });
  });

  // The composer sits at whichever end of the timeline the newest row is at
  // (OS-1591), so the `+` has to scroll to that end rather than always to the
  // bottom.
  test.each([
    { stored: null, direction: "oldest-first", block: "end" },
    { stored: "desc", direction: "newest-first", block: "start" },
  ])(
    "metadata-row plus action scrolls to the composer's own end ($direction)",
    async ({ stored, block }) => {
      if (stored) {
        window.localStorage.setItem("convoy.task-timeline-sort-direction", stored);
      }
      useQueryMock.mockImplementation(withProjectRole("member", () => []));

      const scrollIntoView = vi.fn();
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scrollIntoView;

      try {
        render(
          <TaskDetailSidebar
            task={createPasteTestTask({
              _id: "task_timeline_scroll" as Task["_id"],
              clientId: "task_timeline_scroll",
              refNumber: 14,
              refId: "ABC-14",
            })}
            onClose={vi.fn()}
            onUpdate={vi.fn()}
            projectId={"project_1" as Id<"projects">}
            organizationSlug="contoso"
            projectAlias="OS"
          />
        );

        await screen.findByText("Timeline content");
        fireEvent.click(screen.getByRole("button", { name: "Open threads composer" }));

        await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
        expect(scrollIntoView).toHaveBeenCalledWith(
          expect.objectContaining({ block, behavior: "smooth" })
        );
      } finally {
        Element.prototype.scrollIntoView = originalScrollIntoView;
        window.localStorage.clear();
      }
    }
  );

  test("renders the timeline without project thread context", async () => {
    const task = createPasteTestTask({
      _id: "task_timeline_3" as Task["_id"],
      clientId: "task_timeline_3",
      refNumber: 11,
      refId: "ABC-11",
    });

    // Outside a project route the stream is comments + activity: the timeline
    // still mounts, and decides for itself that the thread source is off.
    render(<TaskDetailSidebar task={task} onClose={vi.fn()} onUpdate={vi.fn()} />);

    expect(await screen.findByText("Timeline content")).toBeTruthy();
  });

  test("pastes image in sidebar fallback area and uploads task attachment", async () => {
    const task = createPasteTestTask({
      _id: "task_paste_1" as Task["_id"],
      clientId: "task_paste_1",
      refNumber: 3,
      refId: "ABC-3",
    });

    const image = new File(["image-data"], "paste.png", { type: "image/png" });

    render(<TaskDetailSidebar task={task} onClose={vi.fn()} onUpdate={vi.fn()} />);

    const artifactsSection = await screen.findByText("Artifacts");

    fireEvent.paste(artifactsSection, {
      clipboardData: {
        items: [
          {
            kind: "file",
            getAsFile: () => image,
          },
        ],
        files: [],
      },
    });

    expect(uploadFilesMock).toHaveBeenCalledTimes(1);
    expect(uploadFilesMock).toHaveBeenCalledWith([image]);
  });

  test("uploads a markdown file as an editable task artifact", async () => {
    const task = createPasteTestTask({
      _id: "task_markdown_upload_1" as Task["_id"],
      clientId: "task_markdown_upload_1",
      refNumber: 13,
      refId: "ABC-13",
    });
    const artifactId = "artifact_markdown_1" as Id<"taskArtifacts">;
    const onSelectArtifact = vi.fn();
    const markdown = new File(["# Notes"], "notes.md", {
      type: "text/markdown",
    });
    Object.defineProperty(markdown, "text", {
      value: vi.fn().mockResolvedValue("# Notes"),
    });
    createArtifactMock.mockResolvedValue(artifactId);

    const view = render(
      <TaskDetailSidebar
        task={task}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onSelectArtifact={onSelectArtifact}
      />
    );

    await screen.findByText("Artifacts");
    const fileInput = view.container.querySelector<HTMLInputElement>(
      'input[type="file"]'
    );
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, { target: { files: [markdown] } });

    await waitFor(() => {
      expect(createArtifactMock).toHaveBeenCalledWith({
        name: "notes",
        content: "# Notes",
        contentType: "markdown",
      });
    });
    expect(uploadFilesMock).not.toHaveBeenCalled();
    expect(onSelectArtifact).toHaveBeenCalledWith(artifactId);
  });

  test("separates uploaded document artifacts from binary attachments", async () => {
    const task = createPasteTestTask({
      _id: "task_document_upload_1" as Task["_id"],
      clientId: "task_document_upload_1",
      refNumber: 14,
      refId: "ABC-14",
    });
    const markdownId = "artifact_markdown_2" as Id<"taskArtifacts">;
    const htmlId = "artifact_html_1" as Id<"taskArtifacts">;
    const onSelectArtifact = vi.fn();
    const markdown = new File(["# Uppercase"], "UPPER.MD");
    const html = new File(["<h1>Report</h1>"], "report.HTM", {
      type: "text/html",
    });
    const pdf = new File(["pdf-data"], "report.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(markdown, "text", {
      value: vi.fn().mockResolvedValue("# Uppercase"),
    });
    Object.defineProperty(html, "text", {
      value: vi.fn().mockResolvedValue("<h1>Report</h1>"),
    });
    createArtifactMock
      .mockResolvedValueOnce(markdownId)
      .mockResolvedValueOnce(htmlId);

    const view = render(
      <TaskDetailSidebar
        task={task}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onSelectArtifact={onSelectArtifact}
      />
    );

    await screen.findByText("Artifacts");
    const fileInput = view.container.querySelector<HTMLInputElement>(
      'input[type="file"]'
    );
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput!, {
      target: { files: [markdown, html, pdf] },
    });

    await waitFor(() => {
      expect(createArtifactMock).toHaveBeenCalledTimes(2);
    });
    expect(createArtifactMock).toHaveBeenNthCalledWith(1, {
      name: "UPPER",
      content: "# Uppercase",
      contentType: "markdown",
    });
    expect(createArtifactMock).toHaveBeenNthCalledWith(2, {
      name: "report",
      content: "<h1>Report</h1>",
      contentType: "html",
    });
    expect(uploadFilesMock).toHaveBeenCalledWith([pdf]);
    expect(onSelectArtifact).toHaveBeenCalledWith(htmlId);
  });

  test("does not run sidebar fallback when pasting in description editor area", async () => {
    const task = createPasteTestTask({
      _id: "task_paste_2" as Task["_id"],
      clientId: "task_paste_2",
      refNumber: 4,
      refId: "ABC-4",
    });

    const image = new File(["image-data"], "paste.png", { type: "image/png" });

    render(<TaskDetailSidebar task={task} onClose={vi.fn()} onUpdate={vi.fn()} />);

    const descriptionEditor = await screen.findByText("Description editor");

    fireEvent.paste(descriptionEditor, {
      clipboardData: {
        items: [
          {
            kind: "file",
            getAsFile: () => image,
          },
        ],
        files: [],
      },
    });

    expect(uploadFilesMock).not.toHaveBeenCalled();
  });

  test("does not run sidebar fallback when pasting in comment input", async () => {
    const task = createPasteTestTask({
      _id: "task_paste_3" as Task["_id"],
      clientId: "task_paste_3",
      refNumber: 5,
      refId: "ABC-5",
    });

    const image = new File(["image-data"], "paste.png", { type: "image/png" });

    render(<TaskDetailSidebar task={task} onClose={vi.fn()} onUpdate={vi.fn()} />);

    const commentInput = await screen.findByLabelText("Mock comment input");

    fireEvent.paste(commentInput, {
      clipboardData: {
        items: [
          {
            kind: "file",
            getAsFile: () => image,
          },
        ],
        files: [],
      },
    });

    expect(uploadFilesMock).not.toHaveBeenCalled();
  });

  test("forwards artifact panel CSS width token to TaskArtifactPanel when selected", () => {
    const task = createPasteTestTask({
      _id: "task_artifact_1" as Task["_id"],
      clientId: "task_artifact_1",
      refNumber: 6,
      refId: "ABC-6",
    });

    render(
      <TaskDetailSidebar
        task={task}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        selectedArtifactId={"artifact_1"}
        artifactPanelWidthCss={"var(--task-artifact-width)"}
      />
    );

    expect(taskArtifactPanelMock).toHaveBeenCalled();
    const firstCallProps = taskArtifactPanelMock.mock.calls[0]?.[0] as {
      widthCss?: string;
    };
    expect(firstCallProps.widthCss).toBe("var(--task-artifact-width)");
  });

  // OS-1716: in the thread workspace the host owns thread switching (it keeps
  // the query so the artifact stays open, and selects a group sibling's tab),
  // so the artifact panel's send action must reach it.
  test("forwards onNavigateToThread to TaskArtifactPanel", () => {
    const onNavigateToThread = vi.fn();
    const task = createPasteTestTask({
      _id: "task_artifact_nav_1" as Task["_id"],
      clientId: "task_artifact_nav_1",
      refNumber: 7,
      refId: "ABC-7",
    });

    render(
      <TaskDetailSidebar
        task={task}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        selectedArtifactId={"artifact_1"}
        onNavigateToThread={onNavigateToThread}
      />
    );

    const props = taskArtifactPanelMock.mock.calls[0]?.[0] as {
      onNavigateToThread?: unknown;
    };
    expect(props.onNavigateToThread).toBe(onNavigateToThread);
  });

  test("compact mode hides the task details while an artifact is open", () => {
    const task = createPasteTestTask({
      _id: "task_artifact_compact_1" as Task["_id"],
      clientId: "task_artifact_compact_1",
      refNumber: 9,
      refId: "ABC-9",
    });

    render(
      <TaskDetailSidebar
        task={task}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        selectedArtifactId={"artifact_1"}
        artifactPanelCompact
      />
    );

    const panelProps = taskArtifactPanelMock.mock.calls[0]?.[0] as {
      compact?: boolean;
    };
    expect(panelProps.compact).toBe(true);
    const taskColumn = screen
      .getByRole("region", { name: "Task details sidebar" })
      .querySelector(":scope > div:last-child") as HTMLDivElement;
    expect(taskColumn.className).toContain("hidden");
  });

  test("shows loading state first and then renders heavy sections", async () => {
    const task = createPasteTestTask({
      _id: "task_async_1" as Task["_id"],
      clientId: "task_async_1",
      refNumber: 7,
      refId: "ABC-7",
    });

    render(<TaskDetailSidebar task={task} onClose={vi.fn()} onUpdate={vi.fn()} />);

    expect(screen.getByLabelText("Loading task details").querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText(/Loading/)).toBeNull();
    expect(await screen.findByText("Artifacts")).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByLabelText("Loading task details")).toBeNull();
    });
  });

  test("supports the thread workspace header variant", () => {
    const task = createPasteTestTask({
      _id: "task_header_variant_1" as Task["_id"],
      clientId: "task_header_variant_1",
      refNumber: 8,
      refId: "ABC-8",
    });

    render(
      <TaskDetailSidebar
        task={task}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        headerVariant="thread-workspace"
      />
    );

    const header = screen.getByTestId("task-detail-header");
    expect(header.className).toContain("min-h-[41px]");
    expect(header.className).toContain("bg-card");
    // Same 16px inset as the workspace tab bar and the task body.
    expect(header.className).toContain("px-4");
    expect(
      screen.getByRole("button", { name: "Close task details" })
    ).toBeDefined();
  });

  describe("read-only viewer (docs/specs/read-only-viewer-ux.md)", () => {
    const viewerProps = {
      onClose: vi.fn(),
      onUpdate: vi.fn(),
      projectId: "project_1" as Id<"projects">,
      organizationSlug: "contoso",
      projectAlias: "OS",
    };

    test.each([
      { role: "viewer" as const, label: "a viewer" },
      { role: undefined, label: "the role is still loading" },
    ])("every write surface is read-only for $label", async ({ role }) => {
      useQueryMock.mockImplementation(withProjectRole(role, () => []));

      render(
        <TaskDetailSidebar
          task={createPasteTestTask({})}
          selectedArtifactId="artifact_1"
          {...viewerProps}
        />
      );

      const description = await screen.findByText("Description editor");
      await waitFor(() => {
        expect(description.dataset.disabled).toBe("true");
      });
      expect(screen.getByTestId("artifacts-section").dataset.disabled).toBe("true");
      expect(screen.getByTestId("checks-section").dataset.readOnly).toBe("true");
      expect(taskArtifactPanelMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ disabled: true })
      );
      expect((screen.getByLabelText("Task name") as HTMLTextAreaElement).readOnly).toBe(true);
    });

    test("a viewer's timeline has no comment or thread composer", async () => {
      useQueryMock.mockImplementation(withProjectRole("viewer", () => []));
      render(<TaskDetailSidebar task={createPasteTestTask({})} {...viewerProps} />);

      const timeline = await screen.findByTestId("mock-timeline");
      expect(timeline.dataset.canComment).toBe("false");
      expect(timeline.dataset.hasThreads).toBe("false");
    });

    test("the timeline waits for the role, so no composer shape flashes", async () => {
      useQueryMock.mockImplementation(withProjectRole(undefined, () => []));
      render(<TaskDetailSidebar task={createPasteTestTask({})} {...viewerProps} />);

      await screen.findByText("Description editor");
      expect(screen.queryByTestId("mock-timeline")).toBeNull();
    });

    test("ignores pasted images", async () => {
      useQueryMock.mockImplementation(withProjectRole("viewer"));
      render(<TaskDetailSidebar task={createPasteTestTask({})} {...viewerProps} />);

      const image = new File(["image-data"], "paste.png", { type: "image/png" });
      fireEvent.paste(await screen.findByText("Artifacts"), {
        clipboardData: {
          items: [{ kind: "file", getAsFile: () => image }],
          files: [],
        },
      });

      expect(uploadFilesMock).not.toHaveBeenCalled();
    });

    test("a member keeps every editor", async () => {
      useQueryMock.mockImplementation(withProjectRole("member", () => []));
      render(<TaskDetailSidebar task={createPasteTestTask({})} {...viewerProps} />);

      const description = await screen.findByText("Description editor");
      expect(description.dataset.disabled).toBe("false");
      expect(screen.getByTestId("checks-section").dataset.readOnly).toBe("false");
      expect(screen.getByTestId("mock-timeline").dataset.canComment).toBe("true");
      expect((screen.getByLabelText("Task name") as HTMLTextAreaElement).readOnly).toBe(false);
    });
  });
});
