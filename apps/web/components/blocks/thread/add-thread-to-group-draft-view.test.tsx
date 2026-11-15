/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadViewChat } from "./thread-view/thread-view";
import { AddThreadToGroupDraftView } from "./add-thread-to-group-draft-view";

const mocks = vi.hoisted(() => ({ start: vi.fn(), submit: vi.fn(), setDraft: vi.fn(), error: vi.fn(), push: vi.fn(), upload: vi.fn(), draft: undefined as unknown }));
vi.mock("convex/react", () => ({
  useMutation: () => mocks.start,
  useQuery: (query: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    if (getFunctionName(query) === "workflows/core:get") return {
      _id: "workflow-1", name: "Review", draftDefinition: {
        lanes: [{ laneId: "lane", name: "Review", type: "single", defaults: { cliType: "claude-code" } }],
        stages: [{ stageId: "stage", name: "Review", steps: [{ stepId: "step", laneId: "lane", action: { type: "prompt", content: { displayContent: "Review changes" } } }] }],
      },
    };
    return [];
  },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/lib/navigation", () => ({ useNavigation: () => ({ push: mocks.push }), appRoute: { projectThreadDetail: () => "/threads/group" } }));
vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: () => ({ profiles: [{ _id: "profile-1", paths: [{ id: "path-1", path: "/repo", label: "Repo" }] }] }),
}));
vi.mock("@/lib/threads/hooks/use-new-thread-composer", () => ({
  useNewThreadComposer: () => ({ resolvedDraftState: { profileId: "profile-1", pathId: "path-1", cliType: "claude-code", text: "" }, composerSeedKey: "seed" }),
}));
vi.mock("@/lib/threads/hooks/use-create-thread-submit", () => ({ useCreateThreadSubmit: () => ({ isSubmitting: false, handleSubmit: mocks.submit }) }));
vi.mock("@/lib/threads/hooks/use-remembered-new-thread-cli-models", () => ({ useRememberedNewThreadCliModels: () => ({ rememberCliModel: vi.fn() }) }));
vi.mock("@/lib/threads/hooks/use-thread-message-attachment-upload", () => ({
  useThreadMessageAttachmentUpload: (...args: unknown[]) => { mocks.upload(...args); return { pendingAttachments: [], syncFileParts: vi.fn(), draftFileParts: [] }; },
}));
vi.mock("./thread-draft-provider", () => ({ useThreadDraft: () => ({ draft: mocks.draft, setDraft: mocks.setDraft }) }));
vi.mock("@/components/ai-elements/conversation", () => ({ ConversationEmptyState: () => null }));
vi.mock("@/components/blocks/workflows/workflow-selector", () => ({
  WorkflowSelector: ({ onChange, value }: { onChange: (value: unknown) => void; value: unknown }) => <button onClick={() => onChange(value ? null : { _id: "workflow-1", name: "Review" })}>Select workflow</button>,
}));
vi.mock("./thread-composer", () => ({
  ThreadComposer: ({ onSubmit, workflowSelector, submitDisabled, initialAttachedTask }: ComponentProps<typeof import("./thread-composer").ThreadComposer>) => <>
    {workflowSelector}
    <button disabled={submitDisabled} onClick={() => { void Promise.resolve(onSubmit({ text: "Kickoff", files: [], attachedTask: initialAttachedTask })).catch(() => {}); }}>Send</button>
  </>,
}));

const chat = { _id: "source-1", projectId: "project-1", cliType: "claude-code", parentThreadId: "group-1", containerKind: "group" } as ThreadViewChat;
function setup(overrides: Partial<ThreadViewChat> = {}) {
  const onCreated = vi.fn();
  const onWorkflowStarted = vi.fn();
  const view = render(<AddThreadToGroupDraftView chat={{ ...chat, ...overrides }} params={{ organizationSlug: "acme", projectAlias: "OS" }} draftKey="sibling:group-1" onCreated={onCreated} onWorkflowStarted={onWorkflowStarted} />);
  return { ...view, onCreated, onWorkflowStarted };
}

describe("workflow start in a new subthread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.draft = undefined;
    mocks.start.mockResolvedValue({ runId: "run-1", containerThreadId: "group-1" });
  });

  test("selection routes send to workflow start in the existing group", async () => {
    const { onCreated, onWorkflowStarted } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Select workflow" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onWorkflowStarted).toHaveBeenCalledWith("group-1", "run-1"));
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ sourceThreadId: "source-1", expectedContainerId: "group-1", profileId: "profile-1", pathId: "path-1" }));
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  test("plain send still creates a manual subthread", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.start).not.toHaveBeenCalled();
  });

  test.each([
    { workflowRunId: "run-1" as Id<"workflowRuns"> },
    { containerWorkflowRunId: "run-1" as Id<"workflowRuns"> },
  ])("hides workflow selection when the source or its container already belongs to a run", (binding) => {
    setup(binding);
    expect(screen.queryByRole("button", { name: "Select workflow" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeDefined();
  });

  test("a rejected start keeps the draft open and does not create a manual thread", async () => {
    const { onWorkflowStarted } = setup();
    mocks.start.mockRejectedValueOnce(new Error("Already bound"));
    fireEvent.click(screen.getByRole("button", { name: "Select workflow" }));
    mocks.setDraft.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(onWorkflowStarted).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.setDraft).not.toHaveBeenCalled();
  });
});

describe("add-to-group draft attachments", () => {
  test("binds composer attachments to the sibling draft (OS-2141)", () => {
    const attachments = { pending: true, uploaded: [{ filePartId: "part-1", storageId: "storage-1", fileName: "a.png", fileSize: 3, contentType: "image/png" }] };
    mocks.draft = { text: "", attachments, updatedAt: Date.now() };

    setup();

    const binding = mocks.upload.mock.calls.at(-1)?.[1] as
      | { attachments: unknown; save: (value: { pending: boolean }) => void }
      | undefined;
    expect(binding?.attachments).toBe(attachments);
    binding?.save({ pending: false });
    expect(mocks.setDraft).toHaveBeenCalledWith({ attachments: { pending: false } });
  });
});
