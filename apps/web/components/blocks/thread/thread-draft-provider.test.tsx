/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  ThreadDraftProvider,
  useThreadDraft,
  useThreadDraftProvider,
} from "@/components/blocks/thread/thread-draft-provider";

let seedProbeRender = vi.fn();

/** Drives `seedDraft` next to normal typing on the same key. */
function SeedProbe() {
  const { draft, setDraft } = useThreadDraft("thread:test");
  const { seedDraft } = useThreadDraftProvider();

  useEffect(() => {
    seedProbeRender(draft?.text, draft?.seedCount);
  }, [draft?.text, draft?.seedCount]);

  return (
    <div>
      <button type="button" onClick={() => setDraft({ text: "typed" })}>
        Type
      </button>
      <button
        type="button"
        onClick={() =>
          // Mirrors the handoff: the previous seed block is replaced, not stacked.
          seedDraft("thread:test", (previousText) => {
            const remainder = previousText.replace("SEEDED", "").trim();
            return remainder ? `${remainder}\n\nSEEDED` : "SEEDED";
          })
        }
      >
        Seed
      </button>
    </div>
  );
}

function DraftProbe({
  onRender,
}: {
  onRender: (pending: boolean | undefined) => void;
}) {
  const { draft, setDraft } = useThreadDraft("thread:test");

  useEffect(() => {
    onRender(draft?.attachments?.pending);
  }, [draft?.attachments?.pending, onRender]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setDraft({ attachments: { pending: false } })}
      >
        Set pending false
      </button>
      <button
        type="button"
        onClick={() => setDraft({ attachments: { pending: true } })}
      >
        Set pending true
      </button>
    </div>
  );
}

describe("ThreadDraftProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedProbeRender = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  test("does not notify subscribers for no-op draft patches", async () => {
    const onRender = vi.fn();

    render(
      <ThreadDraftProvider storageKey="convoy.thread-drafts.test">
        <DraftProbe onRender={onRender} />
      </ThreadDraftProvider>
    );

    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenLastCalledWith(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Set pending false" }));
    await waitFor(() => {
      expect(onRender).toHaveBeenCalledTimes(2);
    });
    expect(onRender).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Set pending false" }));
    expect(onRender).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Set pending true" }));
    await waitFor(() => {
      expect(onRender).toHaveBeenCalledTimes(3);
    });
    expect(onRender).toHaveBeenLastCalledWith(true);
  });

  // OS-1138: an agent without automation config patches only projectAgentId —
  // the store must still treat that as a change (select and deselect).
  test("notifies subscribers for projectAgentId-only draft patches", async () => {
    const onRender = vi.fn();

    function AgentDraftProbe() {
      const { draft, setDraft } = useThreadDraft("thread:test");

      useEffect(() => {
        onRender(draft?.projectAgentId);
      }, [draft?.projectAgentId]);

      return (
        <div>
          <button type="button" onClick={() => setDraft({ projectAgentId: "agent_1" })}>
            Select agent
          </button>
          <button type="button" onClick={() => setDraft({ projectAgentId: undefined })}>
            Deselect agent
          </button>
        </div>
      );
    }

    render(
      <ThreadDraftProvider storageKey="convoy.thread-drafts.test">
        <AgentDraftProbe />
      </ThreadDraftProvider>
    );

    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenLastCalledWith(undefined);

    fireEvent.click(screen.getByRole("button", { name: "Select agent" }));
    await waitFor(() => {
      expect(onRender).toHaveBeenCalledTimes(2);
    });
    expect(onRender).toHaveBeenLastCalledWith("agent_1");

    // Same value again is still a no-op.
    fireEvent.click(screen.getByRole("button", { name: "Select agent" }));
    expect(onRender).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Deselect agent" }));
    await waitFor(() => {
      expect(onRender).toHaveBeenCalledTimes(3);
    });
    expect(onRender).toHaveBeenLastCalledWith(undefined);
  });

  // OS-2141: a finished upload changes only `attachments.uploaded`; the store
  // must persist it, or the file is gone after a remount.
  test("persists uploaded-attachment-only draft patches", async () => {
    const storageKey = "convoy.thread-drafts.test";
    const uploaded = [{ filePartId: "part-1", storageId: "storage-1", fileName: "a.png", fileSize: 3, contentType: "image/png" }];

    function UploadDraftProbe() {
      const { setDraft } = useThreadDraft("thread:test");
      return (
        <div>
          <button type="button" onClick={() => setDraft({ attachments: { pending: true } })}>
            Pending
          </button>
          <button type="button" onClick={() => setDraft({ attachments: { pending: true, uploaded } })}>
            Uploaded
          </button>
        </div>
      );
    }

    const { unmount } = render(
      <ThreadDraftProvider storageKey={storageKey}>
        <UploadDraftProbe />
      </ThreadDraftProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Pending" }));
    fireEvent.click(screen.getByRole("button", { name: "Uploaded" }));
    unmount();

    const { loadProjectDrafts } = await import("@/lib/threads/draft-storage");
    expect(loadProjectDrafts(storageKey)["thread:test"]?.attachments?.uploaded).toEqual(uploaded);
  });

  // The artifact-comments send-to-thread handoff writes drafts straight to
  // localStorage while a provider on the source page is still mounted. The
  // provider's flush must merge its dirty keys over storage, not overwrite
  // the whole map from its stale in-memory snapshot.
  test("unmount flush preserves drafts written outside the provider", async () => {
    const storageKey = "convoy.thread-drafts.test";
    const onRender = vi.fn();

    const { unmount } = render(
      <ThreadDraftProvider storageKey={storageKey}>
        <DraftProbe onRender={onRender} />
      </ThreadDraftProvider>
    );

    // Dirty one key through the provider...
    fireEvent.click(screen.getByRole("button", { name: "Set pending true" }));

    // ...then write another key out-of-band, as the handoff does before
    // navigating away.
    const { loadProjectDrafts, mergeThreadDraft, saveProjectDrafts } =
      await import("@/lib/threads/draft-storage");
    saveProjectDrafts(storageKey, {
      ...loadProjectDrafts(storageKey),
      new: mergeThreadDraft(undefined, { text: "Seeded from comments" }),
    });

    unmount();

    const drafts = loadProjectDrafts(storageKey);
    expect(drafts["new"]?.text).toBe("Seeded from comments");
    expect(drafts["thread:test"]?.attachments?.pending).toBe(true);
  });

  // OS-1716: the handoff can seed a thread the user is already looking at (an
  // artifact opened in the thread workspace sidebar), so no remount re-reads
  // storage. Mounted consumers must still see the seeded text.
  test("a mounted consumer sees a seeded draft", async () => {
    render(
      <ThreadDraftProvider storageKey="convoy.thread-drafts.test">
        <SeedProbe />
      </ThreadDraftProvider>
    );

    expect(seedProbeRender).toHaveBeenLastCalledWith(undefined, undefined);

    fireEvent.click(screen.getByRole("button", { name: "Seed" }));

    await waitFor(() => {
      expect(seedProbeRender).toHaveBeenLastCalledWith("SEEDED", 1);
    });
  });

  // The seed merges over the *live* row: text typed a moment earlier is still
  // only in memory (200ms debounce), so seeding off storage would drop it.
  test("seeding keeps text typed inside the persist debounce window", async () => {
    const storageKey = "convoy.thread-drafts.test";

    render(
      <ThreadDraftProvider storageKey={storageKey}>
        <SeedProbe />
      </ThreadDraftProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.click(screen.getByRole("button", { name: "Seed" }));

    await waitFor(() => {
      expect(seedProbeRender).toHaveBeenLastCalledWith("typed\n\nSEEDED", 1);
    });

    const { loadProjectDrafts } = await import("@/lib/threads/draft-storage");
    await waitFor(() => {
      expect(loadProjectDrafts(storageKey)["thread:test"]?.text).toBe(
        "typed\n\nSEEDED"
      );
    });
  });

  // Re-sending identical text must still count as a seed, so the composer
  // pushes it into the live editor again.
  test("re-seeding identical text still bumps the seed count", async () => {
    render(
      <ThreadDraftProvider storageKey="convoy.thread-drafts.test">
        <SeedProbe />
      </ThreadDraftProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Seed" }));
    await waitFor(() => {
      expect(seedProbeRender).toHaveBeenLastCalledWith("SEEDED", 1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Seed" }));
    await waitFor(() => {
      expect(seedProbeRender).toHaveBeenLastCalledWith("SEEDED", 2);
    });
  });

  // The editor patches `text` and `composerContent` in two separate calls per
  // update, so a composerContent-only patch must not be dropped as a no-op —
  // otherwise slash-command and Skill pills come back as raw link text after a
  // reload (OS-1784).
  test("persists a composerContent-only draft patch", async () => {
    const storageKey = "convoy.thread-drafts.test";
    const composerContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "slashCommand", attrs: { key: "pdf-tools" } }] }],
    };

    function ComposerContentProbe() {
      const { setDraft } = useThreadDraft("thread:test");

      return (
        <button
          type="button"
          onClick={() => {
            setDraft({ text: "[/pdf-tools](convoy://skill/pdf-tools)" });
            setDraft({ composerContent });
          }}
        >
          Update editor
        </button>
      );
    }

    render(
      <ThreadDraftProvider storageKey={storageKey}>
        <ComposerContentProbe />
      </ThreadDraftProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Update editor" }));

    const { loadProjectDrafts } = await import("@/lib/threads/draft-storage");
    await waitFor(() => {
      expect(loadProjectDrafts(storageKey)["thread:test"]?.composerContent).toEqual(composerContent);
    });
  });

  // A local edit after a seed keeps the seeded text — `setDraft` merges fields
  // over the same in-memory row the seed wrote.
  test("a draft edit after a seed keeps the seeded text", async () => {
    const storageKey = "convoy.thread-drafts.test";

    render(
      <ThreadDraftProvider storageKey={storageKey}>
        <SeedProbe />
        <DraftProbe onRender={vi.fn()} />
      </ThreadDraftProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Seed" }));
    fireEvent.click(screen.getByRole("button", { name: "Set pending true" }));

    const { loadProjectDrafts } = await import("@/lib/threads/draft-storage");
    await waitFor(() => {
      const draft = loadProjectDrafts(storageKey)["thread:test"];
      expect(draft?.attachments?.pending).toBe(true);
      expect(draft?.text).toBe("SEEDED");
    });
  });
});
