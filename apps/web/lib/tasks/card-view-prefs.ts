/**
 * Per-viewer display settings for Board and mobile task cards, kept in this
 * browser like the timeline view prefs. Spec: docs/specs/task-kanban-status-columns.md.
 */

import { useCallback, useSyncExternalStore } from "react";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";

const SHOW_DESCRIPTION_KEY = "convoy.task-card-show-description";
const CHANGE_EVENT = "convoy:task-card-view-change";

/** Off unless explicitly turned on. */
export function readShowCardDescription(): boolean {
  return readLocalString(SHOW_DESCRIPTION_KEY) === "1";
}

export function writeShowCardDescription(show: boolean): void {
  if (writeLocalString(SHOW_DESCRIPTION_KEY, show ? "1" : "0")) {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === SHOW_DESCRIPTION_KEY) onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useShowCardDescription(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(subscribe, readShowCardDescription, () => false);
  const setShow = useCallback((next: boolean) => writeShowCardDescription(next), []);
  return [show, setShow];
}
