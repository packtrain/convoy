"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";

export const AUTO_SAVE_DELAY_MS = 800;
export const UNTITLED_ARTIFACT_NAME = "Untitled";

export type ArtifactSaveState = "idle" | "saving" | "saved" | "error";
type ArtifactAutosaveDraft = { name: string; content: string };

export interface UseArtifactAutosaveArgs {
  artifact: { _id: Id<"taskArtifacts">; name: string; content: string };
  onUpdateArtifact: (args: {
    artifactId: Id<"taskArtifacts">;
    name?: string;
    content?: string;
  }) => Promise<void>;
  disabled: boolean;
}

/**
 * Shared debounced-autosave state for artifact editing surfaces (sidebar
 * panel and full-page route). Consumers must remount (e.g. `key={artifact._id}`)
 * when the artifact changes: initial name/content are captured on mount.
 */
export function useArtifactAutosave({
  artifact,
  onUpdateArtifact,
  disabled,
}: UseArtifactAutosaveArgs) {
  const [nameInputValue, setNameInputValue] = useState(
    artifact.name === UNTITLED_ARTIFACT_NAME ? "" : artifact.name
  );
  const [content, setContent] = useState(artifact.content);
  const [saveState, setSaveState] = useState<ArtifactSaveState>("idle");
  const normalizedName = nameInputValue.trim() || UNTITLED_ARTIFACT_NAME;
  const isMountedRef = useRef(true);
  const lastSavedRef = useRef<ArtifactAutosaveDraft>({
    name: artifact.name,
    content: artifact.content,
  });
  const latestDraftRef = useRef<ArtifactAutosaveDraft>({
    name: normalizedName,
    content,
  });
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const onUpdateArtifactRef = useRef(onUpdateArtifact);
  const disabledRef = useRef(disabled);

  onUpdateArtifactRef.current = onUpdateArtifact;
  disabledRef.current = disabled;

  useEffect(() => {
    latestDraftRef.current = { name: normalizedName, content };
  }, [normalizedName, content]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Clears a pending "saving" indicator when a scheduled save turns out to be a
  // no-op (e.g. the draft was reverted to the last saved value); leaves
  // "saved"/"error"/"idle" untouched. Functional update keeps saveState out of
  // the effect/callback deps so it can't re-trigger the autosave effect.
  const resolveStaleSaving = useCallback(() => {
    if (isMountedRef.current) {
      setSaveState((current) => (current === "saving" ? "idle" : current));
    }
  }, []);

  const saveDraft = useCallback(
    async (updateSaveState: boolean) => {
      const latestDraft = latestDraftRef.current;
      const lastSaved = lastSavedRef.current;
      if (latestDraft.name === lastSaved.name && latestDraft.content === lastSaved.content) {
        if (updateSaveState) {
          resolveStaleSaving();
        }
        return;
      }

      if (inFlightSaveRef.current) {
        await inFlightSaveRef.current;
        const draftAfterInFlight = latestDraftRef.current;
        const lastSavedAfterInFlight = lastSavedRef.current;
        if (
          draftAfterInFlight.name === lastSavedAfterInFlight.name &&
          draftAfterInFlight.content === lastSavedAfterInFlight.content
        ) {
          if (updateSaveState) {
            resolveStaleSaving();
          }
          return;
        }
      }

      let didSaveComplete = false;
      const savePromise = (async () => {
        if (updateSaveState && isMountedRef.current) {
          setSaveState("saving");
        }
        try {
          const draftToSave = latestDraftRef.current;
          await onUpdateArtifactRef.current({
            artifactId: artifact._id,
            name: draftToSave.name,
            content: draftToSave.content,
          });
          lastSavedRef.current = draftToSave;
          didSaveComplete = true;
          if (updateSaveState && isMountedRef.current) {
            const latestDraftAfterSave = latestDraftRef.current;
            const savedDraftStillCurrent =
              latestDraftAfterSave.name === draftToSave.name &&
              latestDraftAfterSave.content === draftToSave.content;
            setSaveState(savedDraftStillCurrent ? "saved" : "saving");
          }
        } catch {
          if (updateSaveState && isMountedRef.current) {
            setSaveState("error");
          }
        }
      })();

      inFlightSaveRef.current = savePromise;
      try {
        await savePromise;
      } finally {
        if (inFlightSaveRef.current === savePromise) {
          inFlightSaveRef.current = null;
        }
      }

      const latestDraftAfterSave = latestDraftRef.current;
      const lastSavedAfterSave = lastSavedRef.current;
      if (
        didSaveComplete &&
        (latestDraftAfterSave.name !== lastSavedAfterSave.name ||
          latestDraftAfterSave.content !== lastSavedAfterSave.content)
      ) {
        await saveDraft(updateSaveState);
      }
    },
    [artifact._id, resolveStaleSaving]
  );

  useEffect(() => {
    if (disabled) {
      return;
    }

    const lastSaved = lastSavedRef.current;
    if (lastSaved.name === normalizedName && lastSaved.content === content) {
      // The draft matches what's persisted (e.g. reverted edit): clear any
      // pending "saving" indicator instead of leaving it stuck.
      resolveStaleSaving();
      return;
    }

    setSaveState((current) => (current === "saving" ? current : "idle"));

    const timer = setTimeout(() => {
      void saveDraft(true);
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [normalizedName, content, disabled, saveDraft, resolveStaleSaving]);

  useEffect(() => {
    return () => {
      if (!disabledRef.current) {
        void saveDraft(false);
      }
    };
  }, [saveDraft]);

  useEffect(() => {
    if (saveState !== "saved") {
      return;
    }

    const timer = setTimeout(() => {
      setSaveState("idle");
    }, 1200);

    return () => clearTimeout(timer);
  }, [saveState]);

  const saveStatusText =
    saveState === "saving"
      ? "Saving..."
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Autosave failed"
          : " ";

  return {
    nameInputValue,
    setNameInputValue,
    content,
    setContent,
    saveState,
    saveStatusText,
  };
}
