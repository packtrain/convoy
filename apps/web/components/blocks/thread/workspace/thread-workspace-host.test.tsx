/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ThreadWorkspaceHost } from "./thread-workspace-host";

const route = vi.hoisted(() => ({ threadId: undefined as string | undefined }));
const workspaceProps = vi.hoisted(() => vi.fn());
const created = vi.hoisted(() => ({ onCreated: null as null | ((id: string) => Promise<void>) }));

vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useRouteParams: () => ({ organizationSlug: "contoso", projectAlias: "OS", threadId: route.threadId }),
  useNavigation: () => ({ location: { search: "" }, push: vi.fn() }),
}));
vi.mock("@/lib/threads/hooks/use-created-thread-hold", () => ({
  useCreatedThreadHold: () => ({ awaitCreatedThread: () => Promise.resolve() }),
}));
vi.mock("@/lib/threads/hooks/use-thread-workspace-task-sidebar", () => ({
  useThreadWorkspaceTaskSidebar: () => ({ setTask: vi.fn(), detailsTask: null }),
}));
vi.mock("@/lib/threads/hooks/use-open-thread-workspace-task", () => ({
  useOpenThreadWorkspaceTask: () => vi.fn(),
}));
vi.mock("@/components/blocks/thread/thread-tasks-panel", () => ({ DEFAULT_THREAD_TASKS_PANEL_FILTERS: {} }));
vi.mock("@/components/blocks/worktrees", () => ({ WorktreeChangesView: () => null }));
vi.mock("./thread-task-pane", () => ({ ThreadTaskPane: () => null }));
vi.mock("./use-thread-shell-state", () => ({ useThreadShellState: () => ({ revealTaskTab: vi.fn() }) }));
vi.mock("./new-thread-composer-view", () => ({
  NewThreadComposerView: (props: { onCreated: (id: string) => Promise<void> }) => {
    created.onCreated = props.onCreated;
    return null;
  },
}));
vi.mock("./thread-workspace", () => ({
  ThreadWorkspace: (props: { threadId: string; autoFocusComposer?: boolean }) => {
    workspaceProps(props);
    return null;
  },
}));

const project = { _id: "project_1" } as Doc<"projects">;
const host = () => (
  <ThreadWorkspaceHost project={project} organizationId={"org_1" as Id<"organizations">} onSidebarHighlightChange={vi.fn()} />
);

afterEach(() => {
  cleanup();
  route.threadId = undefined;
  workspaceProps.mockClear();
});

// Spec: docs/specs/cli-thread-drafts.md → Existing Thread Submit Feedback.
test.each([
  ["nothing else has focus", false, true],
  ["the user focused something else during the wait", true, false],
])("a created thread's composer takes focus when %s", async (_label, focusElsewhere, autoFocus) => {
  const { rerender } = render(<>{host()}<button type="button">Elsewhere</button></>);
  if (focusElsewhere) document.querySelector("button")?.focus();

  await act(() => created.onCreated!("thread_new"));
  route.threadId = "thread_new";
  rerender(<>{host()}<button type="button">Elsewhere</button></>);
  expect(workspaceProps).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "thread_new", autoFocusComposer: autoFocus }));

  // Opening another thread from the list does not take focus.
  route.threadId = "thread_other";
  rerender(<>{host()}<button type="button">Elsewhere</button></>);
  expect(workspaceProps).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "thread_other", autoFocusComposer: false }));
});
