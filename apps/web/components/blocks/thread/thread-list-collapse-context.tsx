"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { readLocalString, writeLocalString } from "@/lib/browser/local-storage";
import { isEditableHotkeyTarget } from "@/lib/browser/hotkeys";

const STORAGE_KEY = "thread-list-collapsed";

export type ThreadListCollapseValue = {
  collapsed: boolean;
  toggle: () => void;
  /** Some active or pinned thread is unread or needs attention; badges the reopen button. */
  hasAttention: boolean;
  setHasAttention: (hasAttention: boolean) => void;
};

const ThreadListCollapseContext = createContext<ThreadListCollapseValue | null>(null);

/** Collapsed state of the threads page's list (docs/specs/cli-thread-sidebar-resizing.md#collapsing). */
export function useThreadListCollapseState(): ThreadListCollapseValue {
  const [collapsed, setCollapsed] = useState(() => readLocalString(STORAGE_KEY) === "true");
  const [hasAttention, setHasAttention] = useState(false);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      writeLocalString(STORAGE_KEY, String(!current));
      return !current;
    });
  }, []);

  // Matched by physical key: TanStack only falls back to `code` for letters and
  // digits, so `[` would miss on layouts where this key types "х" or "ü".
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "BracketLeft" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.defaultPrevented || isEditableHotkeyTarget(document.activeElement)) return;
      event.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return useMemo(
    () => ({ collapsed, toggle, hasAttention, setHasAttention }),
    [collapsed, toggle, hasAttention]
  );
}

export function ThreadListCollapseProvider({
  value,
  children,
}: {
  value: ThreadListCollapseValue;
  children: ReactNode;
}) {
  return (
    <ThreadListCollapseContext.Provider value={value}>
      {children}
    </ThreadListCollapseContext.Provider>
  );
}

/** Null outside the threads layout, where there is no list to collapse. */
export function useThreadListCollapse() {
  return useContext(ThreadListCollapseContext);
}
