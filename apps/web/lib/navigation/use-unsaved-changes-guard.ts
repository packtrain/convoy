"use client";

import { useEffect, useState } from "react";
import { useNavigation } from "./core";
import { targetFromHref } from "./target";

function currentHref() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Blocks leaving a page that holds unsaved edits: the browser's own prompt for
 * reload, close, and off-site navigation, plus `blockedHref` for in-app link
 * clicks, which the host answers with a confirm dialog wired to `stay`/`leave`.
 * Browser Back inside the app is not covered — App Router gives no hook for it.
 */
export function useUnsavedChangesGuard(enabled: boolean) {
  const navigation = useNavigation();
  const [blockedHref, setBlockedHref] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    // Capture phase on the document: the click has to be swallowed before
    // Next's Link (or any host handler) starts navigating.
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const anchor = target instanceof HTMLAnchorElement ? target : null;
      if (
        !anchor ||
        event.button !== 0 ||
        event.defaultPrevented ||
        event.metaKey ||
        event.altKey ||
        event.ctrlKey ||
        event.shiftKey ||
        anchor.hasAttribute("download") ||
        (anchor.target !== "" && anchor.target !== "_self")
      ) {
        return;
      }

      const url = new URL(anchor.href, window.location.href);
      const nextHref = `${url.pathname}${url.search}${url.hash}`;
      // Off-site links unload the page, so `beforeunload` prompts for them.
      if (url.origin !== window.location.origin || nextHref === currentHref()) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setBlockedHref(nextHref);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, [enabled]);

  return {
    /** The in-app href a click asked for while edits were unsaved, or null. */
    blockedHref,
    stay: () => setBlockedHref(null),
    leave: () => {
      setBlockedHref(null);
      if (blockedHref) {
        navigation.push(targetFromHref(blockedHref));
      }
    },
  };
}
