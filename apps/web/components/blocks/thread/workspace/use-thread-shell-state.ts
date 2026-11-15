"use client";

import { useCallback, useState } from "react";
import type { ThreadWorkspaceTab } from "@/components/blocks/thread/thread-sidebar-tabs";
import {
  readThreadLayoutMode,
  writeThreadLayoutMode,
  type ThreadLayoutMode,
} from "@/lib/threads/changes-view-prefs";
import { isDesktopViewport, useIsMobile } from "@/hooks/browser/use-mobile";

export interface ThreadShellState {
  /** The split pane is revealed (independent of `layoutMode`). */
  sidebarOpen: boolean;
  openSidebar: () => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  /** Reveals the task tab for a user's task open, recording whether the pane was closed. */
  revealTaskTab: () => void;
  /** Whether the pane was closed at the last task open. Starts true: the pane starts closed. */
  paneClosedAtTaskOpen: boolean;
  /**
   * The panel the user explicitly picked, null until they do. Left unresolved
   * because the resting panel depends on data only each view has.
   */
  chosenPanel: ThreadWorkspaceTab | null;
  setChosenPanel: (tab: ThreadWorkspaceTab | null) => void;
  /** Panel to return to when the last URL-backed tab closes; null means the view's default. */
  panelBeforeUrlTab: ThreadWorkspaceTab | null;
  setPanelBeforeUrlTab: (tab: ThreadWorkspaceTab | null) => void;
  layoutMode: ThreadLayoutMode;
  /** Persists the preference as well as setting it. */
  setLayoutMode: (mode: ThreadLayoutMode) => void;
  isMobile: boolean;
  /** Full-width tabs (OS-1396): desktop-only, so mobile always reads false. */
  isFullView: boolean;
}

/**
 * The threads page's shell state, owned above the route's thread segment so a
 * first send keeps it (OS-1660, docs/specs/thread-groups.md → Page structure).
 */
export function useThreadShellState(): ThreadShellState {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paneClosedAtTaskOpen, setPaneClosedAtTaskOpen] = useState(true);
  // Seeded from the synchronous viewport check because useIsMobile resolves a
  // render too late (the full header would flash).
  const [layoutMode, setLayoutMode] = useState<ThreadLayoutMode>(() =>
    isDesktopViewport() ? readThreadLayoutMode() : "split"
  );
  const [chosenPanel, setChosenPanel] = useState<ThreadWorkspaceTab | null>(null);
  const [panelBeforeUrlTab, setPanelBeforeUrlTab] = useState<ThreadWorkspaceTab | null>(null);
  const isMobile = useIsMobile();

  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  // Hides the pane; the active panel (and any `task=<REF>` selection) survives
  // reopening.
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const persistLayoutMode = useCallback((mode: ThreadLayoutMode) => {
    writeThreadLayoutMode(mode);
    setLayoutMode(mode);
  }, []);

  const isFullView = layoutMode === "full" && !isMobile;
  // Every user task open reveals through here. The pane's state *before* the click
  // decides what closing that task does.
  const revealTaskTab = useCallback(() => {
    setPaneClosedAtTaskOpen(!sidebarOpen);
    setChosenPanel("task");
    if (!isFullView) {
      openSidebar();
    }
  }, [isFullView, openSidebar, sidebarOpen]);

  return {
    sidebarOpen,
    openSidebar,
    toggleSidebar,
    closeSidebar,
    revealTaskTab,
    paneClosedAtTaskOpen,
    chosenPanel,
    setChosenPanel,
    panelBeforeUrlTab,
    setPanelBeforeUrlTab,
    layoutMode,
    setLayoutMode: persistLayoutMode,
    isMobile,
    isFullView,
  };
}
