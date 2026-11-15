"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import {
  loadProjectDrafts,
  mergeThreadDraft,
  saveProjectDrafts,
  type ThreadComposerDraft,
  type ThreadDraftMap,
  type ThreadDraftPatch,
} from "@/lib/threads/draft-storage";
import type { BaseRefSelection } from "@/lib/threads/base-ref-selection";

const NEW_THREAD_DRAFT_KEY = "new";
const PERSIST_DEBOUNCE_MS = 200;

type DraftStoreListener = () => void;

interface ThreadDraftProviderValue {
  subscribe: (listener: DraftStoreListener) => () => void;
  getDraftSnapshot: (threadKey: string) => ThreadComposerDraft | undefined;
  setDraft: (threadKey: string, patch: ThreadDraftPatch) => void;
  clearDraft: (threadKey: string) => void;
  seedDraft: (threadKey: string, buildText: SeedTextBuilder, patch?: ThreadDraftPatch) => void;
}

/** Rewrites a draft's text from its current value; see `seedDraft`. */
export type SeedTextBuilder = (previousText: string) => string;

const ThreadDraftContext = createContext<ThreadDraftProviderValue | null>(null);

interface ThreadDraftProviderProps extends PropsWithChildren {
  storageKey: string;
}

function isSameBaseRef(
  previous: BaseRefSelection | undefined,
  next: BaseRefSelection | undefined
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next || previous.type !== next.type) {
    return false;
  }
  if (previous.type === "worktree" && next.type === "worktree") {
    return previous.pathId === next.pathId;
  }
  if (previous.type === "branch" && next.type === "branch") {
    return (
      previous.baseRef === next.baseRef &&
      previous.startFromOrigin === next.startFromOrigin &&
      previous.branch === next.branch
    );
  }
  return true; // both "current"
}

function uploadedSignature(attachments: ThreadComposerDraft["attachments"]): string {
  return (attachments?.uploaded ?? []).map((item) => `${item.filePartId}:${item.storageId}:${item.url ?? ""}`).join("|");
}

function isSameDraftValue(
  previous: ThreadComposerDraft | undefined,
  next: ThreadComposerDraft
): boolean {
  if (!previous) {
    return false;
  }

  return (
    previous.text === next.text &&
    // Identity, not deep equality: a patch that omits composerContent carries
    // the previous reference through, and the editor hands over a fresh
    // document object whenever it really changed (OS-1784).
    previous.composerContent === next.composerContent &&
    previous.mode === next.mode &&
    previous.cliType === next.cliType &&
    previous.cliModel === next.cliModel &&
    previous.cliEffort === next.cliEffort &&
    previous.profileId === next.profileId &&
    previous.pathId === next.pathId &&
    previous.projectAgentId === next.projectAgentId &&
    isSameBaseRef(previous.baseRef, next.baseRef) &&
    previous.attachments?.pending === next.attachments?.pending &&
    uploadedSignature(previous.attachments) === uploadedSignature(next.attachments)
  );
}

export function ThreadDraftProvider({
  storageKey,
  children,
}: ThreadDraftProviderProps) {
  const draftsRef = useRef<ThreadDraftMap>(loadProjectDrafts(storageKey));
  const listenersRef = useRef<Set<DraftStoreListener>>(new Set());
  // Keys this provider instance changed. Persisting merges only these over
  // current storage so drafts written outside the provider while it is
  // mounted (e.g. the artifact-comments send-to-thread handoff) survive the
  // debounced/unmount flush instead of being clobbered by a stale snapshot.
  const dirtyKeysRef = useRef<Set<string>>(new Set());
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPersist = useCallback(() => {
    if (dirtyKeysRef.current.size === 0) {
      return;
    }
    const merged = { ...loadProjectDrafts(storageKey) };
    for (const key of dirtyKeysRef.current) {
      const draft = draftsRef.current[key];
      if (draft) {
        merged[key] = draft;
      } else {
        delete merged[key];
      }
    }
    saveProjectDrafts(storageKey, merged);
  }, [storageKey]);

  const schedulePersist = useCallback(() => {
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }

    persistTimeoutRef.current = setTimeout(() => {
      flushPersist();
      persistTimeoutRef.current = null;
    }, PERSIST_DEBOUNCE_MS);
  }, [flushPersist]);

  useEffect(
    () => () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
      flushPersist();
    },
    [flushPersist]
  );

  const notifyListeners = useCallback(() => {
    for (const listener of listenersRef.current) {
      listener();
    }
  }, []);

  const subscribe = useCallback((listener: DraftStoreListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getDraftSnapshot = useCallback(
    (threadKey: string) => draftsRef.current[threadKey],
    []
  );

  const setDraft = useCallback(
    (threadKey: string, patch: ThreadDraftPatch) => {
      const current = draftsRef.current;
      const previousDraft = current[threadKey];
      const nextDraft = mergeThreadDraft(previousDraft, patch);

      if (isSameDraftValue(previousDraft, nextDraft)) {
        return;
      }

      draftsRef.current = {
        ...current,
        [threadKey]: nextDraft,
      };
      dirtyKeysRef.current.add(threadKey);
      schedulePersist();
      notifyListeners();
    },
    [notifyListeners, schedulePersist]
  );

  // Seeds text from outside the composer (the artifact-comments handoff) over
  // the live in-memory row, so text still inside the persist debounce is kept
  // (OS-1716, docs/specs/artifact-comments.md). `patch` carries a handoff's
  // pills and files (docs/specs/cli-thread-handoff.md).
  const seedDraft = useCallback(
    (threadKey: string, buildText: SeedTextBuilder, patch?: ThreadDraftPatch) => {
      const current = draftsRef.current;
      const previousDraft = current[threadKey];

      draftsRef.current = {
        ...current,
        [threadKey]: mergeThreadDraft(previousDraft, {
          ...patch,
          text: buildText(previousDraft?.text ?? ""),
          // Stale composerContent would win over text in the composer.
          composerContent: undefined,
          // A count, not a timestamp, so re-seeding identical text still counts.
          seedCount: (previousDraft?.seedCount ?? 0) + 1,
        }),
      };
      dirtyKeysRef.current.add(threadKey);
      schedulePersist();
      notifyListeners();
    },
    [notifyListeners, schedulePersist]
  );

  const clearDraft = useCallback(
    (threadKey: string) => {
      const current = draftsRef.current;
      if (!(threadKey in current)) {
        return;
      }

      const next = { ...current };
      delete next[threadKey];
      draftsRef.current = next;

      dirtyKeysRef.current.add(threadKey);
      schedulePersist();
      notifyListeners();
    },
    [notifyListeners, schedulePersist]
  );

  const value = useMemo<ThreadDraftProviderValue>(
    () => ({
      subscribe,
      getDraftSnapshot,
      setDraft,
      clearDraft,
      seedDraft,
    }),
    [subscribe, getDraftSnapshot, setDraft, clearDraft, seedDraft]
  );

  return (
    <ThreadDraftContext.Provider value={value}>{children}</ThreadDraftContext.Provider>
  );
}

export function useThreadDraftProvider() {
  const context = useContext(ThreadDraftContext);
  if (!context) {
    throw new Error("useThreadDraftProvider must be used within ThreadDraftProvider");
  }

  return context;
}

/** Null outside a provider — for hosts that can render on either side of one. */
export function useOptionalThreadDraftProvider() {
  return useContext(ThreadDraftContext);
}

export function useThreadDraft(threadKey: string) {
  const { subscribe, getDraftSnapshot, setDraft, clearDraft } =
    useThreadDraftProvider();

  const draft = useSyncExternalStore(
    subscribe,
    () => getDraftSnapshot(threadKey),
    () => undefined
  );

  return {
    draft,
    setDraft: (patch: ThreadDraftPatch) => setDraft(threadKey, patch),
    clearDraft: () => clearDraft(threadKey),
  };
}

export function buildThreadDraftKey(threadId: string): string {
  return `thread:${threadId}`;
}

export function getNewThreadDraftKey(): string {
  return NEW_THREAD_DRAFT_KEY;
}
