/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { appRoute } from "@/lib/navigation/routes";
import { QuickThreadDialog } from "./index";

const { createThreadMock, pushMock, toastSuccessMock, permissionsMock } = vi.hoisted(() => ({
  createThreadMock: vi.fn(),
  pushMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  permissionsMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => createThreadMock,
  useQuery: (_ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    if (args && typeof args === "object" && "alias" in args) return { _id: "project_1", alias: "OS" };
    return [];
  },
}));

vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ push: pushMock }),
}));

vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: vi.fn() } }));

vi.mock("@/lib/authz/use-project-permissions", () => ({
  useProjectPermissions: () => permissionsMock(),
}));

vi.mock("@/components/blocks/thread/thread-draft-provider", () => ({
  ThreadDraftProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useThreadDraft: () => ({ draft: undefined, setDraft: vi.fn() }),
}));

// Enter in the real composer submits through its form; the key event reaches the host first.
// Focus needs the real editor and is covered in quick-thread-focus.test.tsx.
vi.mock("@/components/blocks/thread/thread-composer", () => ({
  ThreadComposer: ({ onSubmit }: { onSubmit: (message: { text: string; files: [] }) => Promise<void> }) => (
    <textarea
      aria-label="Quick thread message"
      onKeyDown={(event) => {
        if (event.key === "Enter") void onSubmit({ text: "Fix the build", files: [] }).catch(() => {});
      }}
    />
  ),
}));

vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: () => ({
    profiles: [{ _id: "profile_1", paths: [{ id: "path_1", path: "/tmp/project", label: "project" }] }],
    hasProfiles: true,
    isLoading: false,
  }),
}));

vi.mock("@/lib/threads/hooks/use-new-thread-composer", () => ({
  useNewThreadComposer: () => ({
    resolvedDraftState: { text: "", cliType: "claude-code", cliModel: "opus", mode: "agent", profileId: "profile_1", pathId: "path_1" },
    composerSeedKey: "seed",
  }),
}));

vi.mock("@/lib/threads/hooks/use-thread-message-attachment-upload", () => ({
  useThreadMessageAttachmentUpload: () => ({
    pendingAttachments: [],
    syncFileParts: vi.fn(),
    prepareAttachmentsForSubmit: async () => [],
    clearAfterSubmit: vi.fn(),
    draftFileParts: [],
  }),
  isThreadAttachmentSubmitError: () => false,
}));

vi.mock("@/lib/threads/hooks/use-remembered-new-thread-cli-models", () => ({
  useRememberedNewThreadCliModels: () => ({ rememberedCliModels: {}, rememberCliModel: vi.fn() }),
}));

function renderDialog() {
  return render(
    <QuickThreadDialog organizationId={"org_1" as Id<"organizations">} organizationSlug="contoso" projectAlias="OS" />
  );
}

function openWithShiftN() {
  fireEvent.keyDown(document.body, { key: "N", shiftKey: true });
}

describe("QuickThreadDialog", () => {
  beforeEach(() => {
    permissionsMock.mockReturnValue({ canUseThreads: true, isLoading: false });
    createThreadMock.mockResolvedValue("thread_new");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("Shift+N opens the composer; plain N does not", () => {
    renderDialog();

    fireEvent.keyDown(document.body, { key: "n" });
    expect(screen.queryByLabelText("Quick thread message")).toBeNull();

    openWithShiftN();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  test("Shift+N does nothing without threads access", () => {
    permissionsMock.mockReturnValue({ canUseThreads: false, isLoading: false });
    renderDialog();

    openWithShiftN();
    expect(screen.queryByLabelText("Quick thread message")).toBeNull();
  });

  test("Enter starts the thread in the background and offers Open", async () => {
    renderDialog();
    openWithShiftN();

    fireEvent.keyDown(await screen.findByLabelText("Quick thread message"), { key: "Enter" });

    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText("Quick thread message")).toBeNull());
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith("Thread started", expect.objectContaining({ action: expect.objectContaining({ label: "Open" }) }));
  });

  test("Cmd/Ctrl+Enter starts the thread and opens it", async () => {
    renderDialog();
    openWithShiftN();

    fireEvent.keyDown(await screen.findByLabelText("Quick thread message"), { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(appRoute.projectThreadDetail("contoso", "OS", "thread_new")));
    expect(toastSuccessMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText("Quick thread message")).toBeNull());
  });
});
