"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { href, type RouteTarget } from "./target";

export type NavigationHistoryMode = "push" | "replace";

export interface NavigationLocation {
  pathname: string;
  search: string;
  hash: string;
}

export const NAVIGATION_LOCATION_EVENT = "convoy:navigation-location-change";

export function emitNavigationLocationChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(NAVIGATION_LOCATION_EVENT));
}

function subscribeToNavigationLocation(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("popstate", callback);
  window.addEventListener(NAVIGATION_LOCATION_EVENT, callback as EventListener);

  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(NAVIGATION_LOCATION_EVENT, callback as EventListener);
  };
}

function browserLocationSnapshot() {
  if (typeof window === "undefined") {
    return "";
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function useNavigationLocation(): NavigationLocation {
  const pathname = usePathname();
  const serverSnapshot = pathname;
  const snapshot = useSyncExternalStore(
    subscribeToNavigationLocation,
    browserLocationSnapshot,
    () => serverSnapshot
  );

  return useMemo(() => {
    const parsed = new URL(snapshot || serverSnapshot || "/", "https://convoy.local");
    return {
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    };
  }, [serverSnapshot, snapshot]);
}

export function useNavigation() {
  const router = useRouter();
  const location = useNavigationLocation();

  const navigate = useCallback(
    (target: RouteTarget, mode: NavigationHistoryMode = "push") => {
      const nextHref = href(target);
      const currentHref =
        typeof window === "undefined"
          ? `${location.pathname}${location.search}${location.hash}`
          : `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (nextHref === currentHref) {
        return;
      }

      const nextUrl = new URL(nextHref, "https://convoy.local");
      const currentUrl = new URL(currentHref, "https://convoy.local");
      const samePathname = nextUrl.pathname === currentUrl.pathname;

      if (typeof window !== "undefined" && samePathname) {
        if (mode === "replace") {
          window.history.replaceState(window.history.state, "", nextHref);
        } else {
          window.history.pushState(window.history.state, "", nextHref);
        }
        emitNavigationLocationChange();
        return;
      }

      if (mode === "replace") {
        router.replace(nextHref, { scroll: target.scroll ?? false });
        return;
      }

      router.push(nextHref, { scroll: target.scroll ?? false });
    },
    [location.hash, location.pathname, location.search, router]
  );

  return useMemo(
    () => ({
      location,
      push: (target: RouteTarget) => navigate(target, "push"),
      replace: (target: RouteTarget) => navigate(target, "replace"),
    }),
    [location, navigate]
  );
}
