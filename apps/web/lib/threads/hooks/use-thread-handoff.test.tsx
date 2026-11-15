/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Id } from "@/convex/_generated/dataModel";
import { useThreadHandoff } from "@/lib/threads/hooks/use-thread-handoff";
import type { ThreadMarkdownExportMessages } from "@/lib/threads/hooks/use-thread-markdown-export";
import type { ThreadComposerDraft } from "@/lib/threads/draft-storage";
import type { CliThreadDetailItem } from "@/lib/threads/thread-query-patches";

const toast = vi.hoisted(() => ({ loading: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
const draftProvider = vi.hoisted(() => ({
  getDraftSnapshot: vi.fn<(key: string) => ThreadComposerDraft | undefined>(),
  seedDraft: vi.fn(),
}));
const push = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({ toast }));
const mutations = vi.hoisted(() => ({
  generateMessageAttachmentUploadUrl: vi.fn(async () => "https://upload"),
  registerPendingUploadedAttachment: vi.fn(async (args: { storageId: string }): Promise<string | null> => `https://files/${args.storageId}`),
  deletePendingUploadedAttachment: vi.fn(async () => null),
}));
const readWholeForkPrefix = vi.hoisted(() => vi.fn());
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useConvex: () => ({}),
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
      mutations[getFunctionName(ref).split(":").pop() as keyof typeof mutations],
  };
});
vi.mock("@/lib/threads/hooks/use-fork-prefix", () => ({ readWholeForkPrefix }));
vi.mock("@/components/blocks/thread/thread-draft-provider", () => ({
  getNewThreadDraftKey: () => "new",
  useThreadDraftProvider: () => draftProvider,
}));
vi.mock("@/lib/threads/hooks/use-cli-profiles", () => ({
  useCliProfiles: () => ({ profiles: [{ _id: "p1", isOnline: true, paths: [{ id: "path1" }] }] }),
}));
vi.mock("@/lib/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/navigation")>()),
  useNavigation: () => ({ push }),
}));

const uploadedBodies: Blob[] = [];
const uploadOk = (_url: string, init: { body: Blob }) => {
  uploadedBodies.push(init.body);
  return Promise.resolve({ ok: true, json: async () => ({ storageId: `s${uploadedBodies.length}` }) });
};
const fetchMock = vi.fn<(url: string, init: { body: Blob }) => Promise<unknown>>(uploadOk);
vi.stubGlobal("fetch", fetchMock);

const AT = Date.UTC(2026, 7, 14, 15, 20);
const chat = {
  _id: "t1",
  projectId: "proj1",
  title: "Fix login",
  cliType: "codex",
  profileId: "p1",
  pathId: "path1",
  associatedTask: { refId: "OS-7" },
} as unknown as CliThreadDetailItem;

function messages(replyText = new Map<string, string>()): ThreadMarkdownExportMessages {
  const rows = [
    { _id: "u1", role: "user", runId: "r1", createdAt: AT },
    { _id: "a1", role: "assistant", runId: "r1", createdAt: AT + 1 },
    { _id: "u2", role: "user", runId: "r2", createdAt: AT + 2 },
    { _id: "a2", role: "assistant", runId: "r2", createdAt: AT + 3 },
    // A steer lands after its run's reply started.
    { _id: "s2", role: "user", runId: "r2", createdAt: AT + 4 },
    { _id: "u3", role: "user", runId: "r3", createdAt: AT + 5 },
  ];
  return {
    envelopes: rows as unknown as ThreadMarkdownExportMessages["envelopes"],
    renderStateByMessageId: new Map(
      [...replyText].map(([id, text]) => [id, { parts: [{ type: "text", text }] }])
    ) as ThreadMarkdownExportMessages["renderStateByMessageId"],
    userTextById: new Map([["u1", "first ask"], ["u2", "second ask"], ["s2", "steer"], ["u3", "later ask"]]),
    visibleMessageIds: rows.map((row) => row._id) as ThreadMarkdownExportMessages["visibleMessageIds"],
    isLoading: false,
    hasOlderChunks: false,
    hasOlderEnvelopes: false,
    isLoadingOlderChunks: false,
    loadOlderChunks: vi.fn(),
    loadedChunkCount: 1,
  };
}

// jsdom's Blob has no `text()`.
function readText(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

function render(source = chat, cliMessages = messages(), newTab?: { draftKey: string; open: () => void }) {
  return renderHook(
    ({ tab }) => useThreadHandoff({ chat: source, cliMessages, organizationSlug: "acme", projectAlias: "app", newTab: tab }),
    { initialProps: { tab: newTab } }
  );
}

const EMPTY_DRAFT: ThreadComposerDraft = { text: "", updatedAt: 0, attachments: { pending: false, uploaded: [] } };

afterEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(uploadOk);
  uploadedBodies.length = 0;
});

describe("useThreadHandoff", () => {
  test("seeds the new-thread draft with the transcript through the reply's run and the source's settings", async () => {
    draftProvider.getDraftSnapshot.mockReturnValue({ text: "", updatedAt: 0, attachments: { pending: false, uploaded: [] } });
    const { result } = render();

    act(() => result.current.handoffToNewThread("a2" as Id<"cliMessages">));

    await waitFor(() => expect(draftProvider.seedDraft).toHaveBeenCalledTimes(1));
    expect(uploadedBodies).toHaveLength(1);
    const transcript = await readText(uploadedBodies[0]!);
    expect(transcript).toContain("second ask");
    expect(transcript).toContain("steer");
    expect(transcript).not.toContain("later ask");

    const [key, buildText, patch] = draftProvider.seedDraft.mock.calls[0]!;
    expect(key).toBe("new");
    expect(buildText("kept text")).toMatch(/^kept text\n\nContinue the work from the attached handoff\./);
    expect(patch).toMatchObject({
      profileId: "p1",
      pathId: "path1",
      cliType: "codex",
      attachments: {
        pending: false,
        uploaded: [{ storageId: "s1", fileName: expect.stringMatching(/^handoff-fix-login-\d{4}-\d{2}-\d{2}\.md$/), url: "https://files/s1" }],
      },
    });
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/o/acme/app/threads" }));
  });

  test("fails with a toast before uploading when the draft has no room for the files", async () => {
    const uploaded = Array.from({ length: 10 }, (_, index) => ({
      filePartId: `f${index}`,
      storageId: `old${index}`,
      fileName: `f${index}.png`,
      fileSize: 1,
      contentType: "image/png",
    }));
    draftProvider.getDraftSnapshot.mockReturnValue({ text: "", updatedAt: 0, attachments: { pending: false, uploaded } });
    const { result } = render();

    act(() => result.current.handoffToNewThread("a2" as Id<"cliMessages">));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
    expect(draftProvider.seedDraft).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  test("puts a fork's ancestor history before its own rows", async () => {
    draftProvider.getDraftSnapshot.mockReturnValue(EMPTY_DRAFT);
    readWholeForkPrefix.mockResolvedValue({
      envelopes: [{ _id: "p1", role: "user", createdAt: AT - 10 }],
      partsByMessageId: new Map(),
      userTextById: new Map([["p1", "the original ask"]]),
      complete: true,
    });
    const fork = { ...chat, forkedFrom: { threadId: "parent" } } as unknown as CliThreadDetailItem;
    const { result } = render(fork);

    act(() => result.current.handoffToNewThread("a2" as Id<"cliMessages">));

    await waitFor(() => expect(draftProvider.seedDraft).toHaveBeenCalledTimes(1));
    const transcript = await readText(uploadedBodies[0]!);
    expect(transcript.indexOf("the original ask")).toBeGreaterThan(-1);
    expect(transcript.indexOf("the original ask")).toBeLessThan(transcript.indexOf("first ask"));
  });

  test("fails, without opening a composer, when storage refuses a file", async () => {
    draftProvider.getDraftSnapshot.mockReturnValue(EMPTY_DRAFT);
    mutations.registerPendingUploadedAttachment.mockResolvedValueOnce(null);
    const { result } = render();

    act(() => result.current.handoffToNewThread("a2" as Id<"cliMessages">));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(draftProvider.seedDraft).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  test("uploads the full file too when replies were stubbed, and deletes it when the other upload fails", async () => {
    draftProvider.getDraftSnapshot.mockReturnValue(EMPTY_DRAFT);
    // Three long replies push the transcript past the cap, so the middle one is stubbed.
    const long = "x".repeat(40_000);
    const rows = messages().envelopes.slice(0, 4).concat([
      { _id: "u9", role: "user", runId: "r9", createdAt: AT + 6 },
      { _id: "a9", role: "assistant", runId: "r9", createdAt: AT + 7 },
    ] as unknown as ThreadMarkdownExportMessages["envelopes"]);
    const cliMessages = {
      ...messages(new Map([["a1", long], ["a2", long], ["a9", long]])),
      envelopes: rows,
    };
    const { result } = render(chat, cliMessages);

    act(() => result.current.handoffToNewThread("a9" as Id<"cliMessages">));

    await waitFor(() => expect(draftProvider.seedDraft).toHaveBeenCalledTimes(1));
    const [, buildText, patch] = draftProvider.seedDraft.mock.calls[0]!;
    expect(patch.attachments.uploaded.map((file: { fileName: string }) => file.fileName)).toEqual([
      expect.stringMatching(/^handoff-fix-login-[\d-]+\.md$/),
      expect.stringMatching(/^handoff-fix-login-[\d-]+-full\.md$/),
    ]);
    expect(buildText("")).toMatch(/look them up in handoff-fix-login-[\d-]+-full\.md\.$/);

    // Now the capped file's upload fails after the full one registered.
    vi.clearAllMocks();
    uploadedBodies.length = 0;
    fetchMock.mockImplementation((url, init) =>
      init.body.size < 100_000 ? Promise.resolve({ ok: false, text: async () => "boom", json: async () => ({}) }) : uploadOk(url, init)
    );
    act(() => result.current.handoffToNewThread("a9" as Id<"cliMessages">));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mutations.deletePendingUploadedAttachment).toHaveBeenCalledWith({ projectId: "proj1", storageId: "s1" }));
    expect(draftProvider.seedDraft).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  test("in a new tab, seeds the group's draft with the source's pills and opens it instead of navigating", async () => {
    draftProvider.getDraftSnapshot.mockReturnValue(EMPTY_DRAFT);
    const open = vi.fn(() => expect(draftProvider.seedDraft).toHaveBeenCalledTimes(1));
    const { result } = render(chat, messages(), { draftKey: "sibling:t1", open });

    act(() => result.current.handoffToNewTab?.("a2" as Id<"cliMessages">));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(draftProvider.getDraftSnapshot).toHaveBeenCalledWith("sibling:t1");
    const [key, buildText, patch] = draftProvider.seedDraft.mock.calls[0]!;
    expect(key).toBe("sibling:t1");
    expect(buildText("")).toMatch(/^Continue the work from the attached handoff\./);
    expect(patch).toMatchObject({
      profileId: "p1",
      cliType: "codex",
      seededFrom: "t1",
      attachments: { uploaded: [expect.objectContaining({ storageId: "s1" })] },
    });
    expect(push).not.toHaveBeenCalled();
  });

  test("in a new tab, seeds but does not open the draft when the view left its group mid-pass", async () => {
    draftProvider.getDraftSnapshot.mockReturnValue(EMPTY_DRAFT);
    let releaseUpload!: (url: string) => void;
    mutations.generateMessageAttachmentUploadUrl.mockImplementationOnce(() => new Promise((resolve) => (releaseUpload = resolve)));
    const open = vi.fn();
    const { result, rerender } = render(chat, messages(), { draftKey: "sibling:t1", open });

    act(() => result.current.handoffToNewTab?.("a2" as Id<"cliMessages">));
    await waitFor(() => expect(mutations.generateMessageAttachmentUploadUrl).toHaveBeenCalled());
    rerender({ tab: { draftKey: "sibling:other", open } });
    releaseUpload("https://upload");

    await waitFor(() => expect(draftProvider.seedDraft).toHaveBeenCalledTimes(1));
    expect(draftProvider.seedDraft.mock.calls[0]![0]).toBe("sibling:t1");
    expect(open).not.toHaveBeenCalled();
  });
});
