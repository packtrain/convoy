/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildProjectDraftStorageKey,
  loadProjectDrafts,
  mergeThreadDraft,
  saveProjectDrafts,
  type PersistedThreadComposerDraftsV1,
} from "./draft-storage";

describe("draft-storage", () => {
  const storageKey = buildProjectDraftStorageKey("org", "ABC");

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns empty map for missing or malformed payload", () => {
    expect(loadProjectDrafts(storageKey)).toEqual({});

    window.localStorage.setItem(storageKey, "{oops");
    expect(loadProjectDrafts(storageKey)).toEqual({});

    window.localStorage.setItem(storageKey, JSON.stringify([]));
    expect(loadProjectDrafts(storageKey)).toEqual({});

    window.localStorage.setItem(storageKey, JSON.stringify({ version: 999 }));
    expect(loadProjectDrafts(storageKey)).toEqual({});
  });

  test("saves, merges, and clears thread drafts", () => {
    const created = mergeThreadDraft(undefined, {
      text: "hello",
      cliType: "codex",
      mode: "plan",
      cliModel: "default",
      cliEffort: "high",
      profileId: "profile-1",
      pathId: "path-1",
    });

    saveProjectDrafts(storageKey, { new: created });
    expect(loadProjectDrafts(storageKey).new?.text).toBe("hello");

    const current = loadProjectDrafts(storageKey);
    const updatedDraft = mergeThreadDraft(current.new, {
      text: "updated",
      mode: "agent",
    });
    saveProjectDrafts(storageKey, { ...current, new: updatedDraft });

    const updated = loadProjectDrafts(storageKey).new;
    expect(updated?.text).toBe("updated");
    expect(updated?.mode).toBe("agent");
    // Patches without cliEffort must not drop the previously drafted effort.
    expect(updated?.cliEffort).toBe("high");

    const effortPatched = mergeThreadDraft(updated, { cliEffort: "xhigh" });
    expect(effortPatched.cliEffort).toBe("xhigh");

    const remaining = { ...loadProjectDrafts(storageKey) };
    delete remaining.new;
    saveProjectDrafts(storageKey, remaining);
    expect(loadProjectDrafts(storageKey)).toEqual({});
  });

  test("persists and clears the project agent selection like the other pills", () => {
    const created = mergeThreadDraft(undefined, {
      text: "hello",
      cliType: "codex",
      projectAgentId: "agent-1",
    });

    saveProjectDrafts(storageKey, { new: created });
    expect(loadProjectDrafts(storageKey).new?.projectAgentId).toBe("agent-1");

    // Patches without projectAgentId must not drop the selection.
    const current = loadProjectDrafts(storageKey);
    const textPatched = mergeThreadDraft(current.new, { text: "updated" });
    expect(textPatched.projectAgentId).toBe("agent-1");

    // Explicit undefined (selecting "No agent") clears it.
    const cleared = mergeThreadDraft(textPatched, { projectAgentId: undefined });
    expect(cleared.projectAgentId).toBeUndefined();
  });

  test("drops non-string project agent ids from persisted drafts", () => {
    const payload: PersistedThreadComposerDraftsV1 = {
      version: 1,
      drafts: {
        new: {
          text: "hello",
          projectAgentId: 42 as unknown as string,
          updatedAt: Date.now(),
        },
      },
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));

    expect(loadProjectDrafts(storageKey).new?.projectAgentId).toBeUndefined();
  });

  test("round-trips uploaded draft attachments and drops malformed ones (OS-2141)", () => {
    const uploaded = { filePartId: "part-1", storageId: "storage-1", fileName: "a.png", fileSize: 3, contentType: "image/png", url: "https://files.test/a", dimensions: { width: 8, height: 4 } };
    const payload = {
      version: 1,
      drafts: {
        new: {
          text: "hello",
          attachments: { pending: true, uploaded: [uploaded, { filePartId: "part-2", fileName: "b.png" }, "junk"] },
          updatedAt: Date.now(),
        },
      },
    };
    window.localStorage.setItem(storageKey, JSON.stringify(payload));

    expect(loadProjectDrafts(storageKey).new?.attachments).toEqual({ pending: true, uploaded: [uploaded] });
  });

  test("fails soft when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(loadProjectDrafts(storageKey)).toEqual({});

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => saveProjectDrafts(storageKey, {})).not.toThrow();
  });

  test("prunes stale drafts and caps project draft count", () => {
    const now = Date.now();
    const staleAgeMs = 31 * 24 * 60 * 60 * 1000;
    const drafts: PersistedThreadComposerDraftsV1["drafts"] = {};

    drafts.stale = {
      text: "stale",
      updatedAt: now - staleAgeMs,
    };

    for (let index = 0; index < 120; index += 1) {
      drafts[`thread:${index}`] = {
        text: `draft-${index}`,
        updatedAt: now - index,
      };
    }

    const payload: PersistedThreadComposerDraftsV1 = {
      version: 1,
      drafts,
    };

    window.localStorage.setItem(storageKey, JSON.stringify(payload));

    const loaded = loadProjectDrafts(storageKey);
    expect(loaded.stale).toBeUndefined();
    expect(Object.keys(loaded)).toHaveLength(100);
    expect(loaded["thread:0"]?.text).toBe("draft-0");
    expect(loaded["thread:119"]).toBeUndefined();
  });

  test("sanitizes model values per cli type and drops them for model-less types", () => {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        drafts: {
          valid: {
            text: "hello",
            cliType: "claude-code",
            cliModel: "sonnet-1m",
            updatedAt: Date.now(),
          },
          invalid: {
            text: "hello",
            cliType: "claude-code",
            cliModel: "not-real",
            updatedAt: Date.now(),
          },
          codexInvalid: {
            text: "hello",
            cliType: "codex",
            cliModel: "opus",
            updatedAt: Date.now(),
          },
          codexValid: {
            text: "hello",
            cliType: "codex",
            cliModel: "gpt-5.5",
            cliEffort: "low",
            updatedAt: Date.now(),
          },
          effortInvalid: {
            text: "hello",
            cliType: "claude-code",
            cliEffort: "not-real",
            updatedAt: Date.now(),
          },
          modelless: {
            text: "hello",
            cliType: "droid",
            cliModel: "opus",
            updatedAt: Date.now(),
          },
        },
      })
    );

    const drafts = loadProjectDrafts(storageKey);
    expect(drafts.valid?.cliModel).toBe("sonnet-1m");
    expect(drafts.invalid?.cliModel).toBe("default");
    expect(drafts.codexInvalid?.cliModel).toBe("default");
    expect(drafts.codexValid?.cliModel).toBe("gpt-5.5");
    expect(drafts.codexValid?.cliEffort).toBe("low");
    expect(drafts.effortInvalid?.cliEffort).toBe("default");
    expect(drafts.modelless?.cliModel).toBeUndefined();
    expect(drafts.modelless?.cliEffort).toBeUndefined();
  });
});
