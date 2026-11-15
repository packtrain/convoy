"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  TaskSearchHrefBuilder,
  TaskSearchSelectHandler,
} from "@/lib/tasks/task-selector";

/**
 * Page-provided overrides for the global mobile nav bar, so its fixed slots stay
 * page-aware without the bar being composed per page.
 *
 * IMPORTANT: registered configs must be identity-stable across re-renders. Registration
 * is effect-driven, so a config with a new identity every render re-registers every
 * commit and loops the provider state. Route unstable callbacks through a ref.
 */
export interface MobileNavPageConfig {
  /** View-aware task search navigation (keeps list/board + filters). */
  search?: {
    onSelectTask: TaskSearchSelectHandler;
    getTaskHref: TaskSearchHrefBuilder;
  };
  /** List preselected in the create-task drawer opened from the + slot. */
  createTaskListRef?: string | null;
}

interface MobileNavBarStateValue {
  hiddenCount: number;
  pageConfig: MobileNavPageConfig | null;
}

interface MobileNavBarActionsValue {
  requestHide: () => () => void;
  setPageConfig: (config: MobileNavPageConfig | null) => void;
}

// State (consumed by the bar) and actions (consumed by registering pages) are
// separate contexts so pages don't re-render on every bar-state change.
const MobileNavBarStateContext = createContext<MobileNavBarStateValue | null>(
  null
);
const MobileNavBarActionsContext =
  createContext<MobileNavBarActionsValue | null>(null);

export function MobileNavBarProvider({ children }: { children: ReactNode }) {
  const [hiddenCount, setHiddenCount] = useState(0);
  const [pageConfig, setPageConfig] = useState<MobileNavPageConfig | null>(
    null
  );

  const requestHide = useCallback(() => {
    setHiddenCount((count) => count + 1);
    return () => setHiddenCount((count) => count - 1);
  }, []);

  const state = useMemo(
    () => ({ hiddenCount, pageConfig }),
    [hiddenCount, pageConfig]
  );
  const actions = useMemo(() => ({ requestHide, setPageConfig }), [requestHide]);

  return (
    <MobileNavBarActionsContext.Provider value={actions}>
      <MobileNavBarStateContext.Provider value={state}>
        {children}
      </MobileNavBarStateContext.Provider>
    </MobileNavBarActionsContext.Provider>
  );
}

export function useMobileNavBarState() {
  const context = useContext(MobileNavBarStateContext);

  if (!context) {
    throw new Error(
      "useMobileNavBarState must be used within MobileNavBarProvider"
    );
  }

  return context;
}

/**
 * Hide the global mobile nav bar while `hidden` is true (e.g. under a
 * full-screen task detail drawer). Counter-based so overlapping surfaces
 * compose.
 */
export function useMobileNavBarHidden(hidden: boolean) {
  const context = useContext(MobileNavBarActionsContext);
  const requestHide = context?.requestHide;

  useEffect(() => {
    if (!hidden || !requestHide) {
      return;
    }

    return requestHide();
  }, [hidden, requestHide]);
}

/**
 * Register page-specific overrides for the global mobile nav bar. The config
 * must be identity-stable across re-renders (see MobileNavPageConfig); it is
 * cleared on unmount.
 */
export function useMobileNavBarPageConfig(config: MobileNavPageConfig | null) {
  const context = useContext(MobileNavBarActionsContext);
  const setPageConfig = context?.setPageConfig;

  useEffect(() => {
    if (!setPageConfig || config === null) {
      return;
    }

    setPageConfig(config);
    return () => setPageConfig(null);
  }, [config, setPageConfig]);
}
