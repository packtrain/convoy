/**
 * @vitest-environment jsdom
 */
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { href } from "@/lib/navigation";
import ArtifactFullPage from "./page";

const useTaskArtifactMock = vi.fn();
const useUpdateTaskArtifactMock = vi.fn();
const useArtifactOwningTaskMock = vi.fn();
const taskArtifactPanelMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/blocks/tasks/task-artifact-panel", () => ({
  TaskArtifactPanel: (props: Record<string, unknown>) => {
    taskArtifactPanelMock(props);
    return <div data-testid="task-artifact-panel" />;
  },
}));

vi.mock("@/lib/tasks/hooks/use-task-artifacts", () => ({
  useTaskArtifact: (...args: unknown[]) => useTaskArtifactMock(...args),
  useUpdateTaskArtifact: (...args: unknown[]) => useUpdateTaskArtifactMock(...args),
  useArtifactOwningTask: (...args: unknown[]) => useArtifactOwningTaskMock(...args),
}));

vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useRouteParams: () => ({
    organizationSlug: "acme",
    projectAlias: "ABC",
    artifactId: "artifact_1",
  }),
}));

const markdownArtifact = {
  _id: "artifact_1",
  taskId: "task_1",
  name: "Implementation Plan",
  fileName: "implementation-plan.md",
  content: "# Plan",
  contentType: "markdown" as const,
};

const owningTask = {
  _id: "task_1",
  projectId: "project_1",
  refId: "ABC-42",
  isArchived: false,
};

describe("ArtifactFullPage", () => {
  beforeEach(() => {
    useTaskArtifactMock.mockReset();
    useUpdateTaskArtifactMock.mockReset();
    useArtifactOwningTaskMock.mockReset();
    taskArtifactPanelMock.mockReset();
    useUpdateTaskArtifactMock.mockReturnValue(vi.fn().mockResolvedValue(undefined));
    useArtifactOwningTaskMock.mockReturnValue({ task: owningTask, isReadOnly: false });
  });
  afterEach(() => {
    cleanup();
  });

  test("renders the artifact panel in full-page mode with editing enabled", () => {
    useTaskArtifactMock.mockReturnValue(markdownArtifact);

    render(<ArtifactFullPage />);

    expect(screen.getByTestId("task-artifact-panel")).toBeDefined();
    expect(taskArtifactPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedArtifactId: "artifact_1",
        fullPage: true,
        disabled: false,
        projectId: "project_1",
        taskId: "task_1",
        taskRefId: "ABC-42",
      })
    );
  });

  test("targets the artifact over the task sidebar on the project view as back link", () => {
    useTaskArtifactMock.mockReturnValue(markdownArtifact);

    render(<ArtifactFullPage />);

    const { backTarget } = taskArtifactPanelMock.mock.calls[0][0];
    expect(href(backTarget)).toBe("/o/acme/ABC?task=ABC-42&artifact=artifact_1");
  });

  test("keeps the archived flag in the back link for archived tasks", () => {
    useTaskArtifactMock.mockReturnValue(markdownArtifact);
    useArtifactOwningTaskMock.mockReturnValue({
      task: { ...owningTask, isArchived: true },
      isReadOnly: true,
    });

    render(<ArtifactFullPage />);

    const { backTarget, disabled } = taskArtifactPanelMock.mock.calls[0][0];
    expect(href(backTarget)).toBe(
      "/o/acme/ABC?task=ABC-42&artifact=artifact_1&archived=true"
    );
    expect(disabled).toBe(true);
  });

  test("stays read-only and omits the back link while the owning task is loading", () => {
    useTaskArtifactMock.mockReturnValue(markdownArtifact);
    useArtifactOwningTaskMock.mockReturnValue({ task: undefined, isReadOnly: undefined });

    render(<ArtifactFullPage />);

    expect(taskArtifactPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: true, backTarget: undefined })
    );
  });

  test("shows a not-found state for invalid or inaccessible ids", () => {
    useTaskArtifactMock.mockReturnValue(null);

    render(<ArtifactFullPage />);

    const heading = screen.getByRole("heading", { level: 1, name: "Artifact not found" });
    expect(heading.closest('[data-slot="empty"]')).not.toBeNull();
    expect(taskArtifactPanelMock).not.toHaveBeenCalled();
  });

  test("shows a loading state while the artifact resolves", () => {
    useTaskArtifactMock.mockReturnValue(undefined);

    render(<ArtifactFullPage />);

    expect(screen.getByLabelText("Loading artifact").querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText(/Loading/)).toBeNull();
    expect(taskArtifactPanelMock).not.toHaveBeenCalled();
  });
});
