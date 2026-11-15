"use client";

import { useEffect, useState } from "react";
import { useAppAuth, useAppConvexAuth } from "./hooks";

// Covers a stalled Clerk token fetch plus the Convex re-auth retries; see spec.
export const APP_AUTH_READINESS_TIMEOUT_MS = 30_000;

export type AppAuthReadinessStatus = "loading" | "signed-out" | "authenticated" | "timed-out";
export type AppAuthReadinessReason = "clerk" | "convex" | null;

export type AppAuthReadiness = {
  status: AppAuthReadinessStatus;
  reason: AppAuthReadinessReason;
  userId: string | null;
};

type PendingWindowState = {
  isPending: boolean;
  hasTimedOut: boolean;
};

export function useAppAuthReadiness(): AppAuthReadiness {
  const { isLoaded, isSignedIn, userId } = useAppAuth();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useAppConvexAuth();
  const pendingReason: Exclude<AppAuthReadinessReason, null> | null = !isLoaded
    ? "clerk"
    : isSignedIn && (isConvexAuthLoading || !isAuthenticated)
      ? "convex"
      : null;
  const isAuthPending = pendingReason !== null;
  const [pendingWindow, setPendingWindow] = useState<PendingWindowState>(() => ({
    isPending: isAuthPending,
    hasTimedOut: false,
  }));

  if (pendingWindow.isPending !== isAuthPending) {
    setPendingWindow({
      isPending: isAuthPending,
      hasTimedOut: false,
    });
  }

  useEffect(() => {
    if (!isAuthPending) return;

    const timeoutId = window.setTimeout(() => {
      setPendingWindow((current) => (current.isPending ? { ...current, hasTimedOut: true } : current));
    }, APP_AUTH_READINESS_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isAuthPending]);

  if (isAuthPending) {
    return {
      status: pendingWindow.hasTimedOut ? "timed-out" : "loading",
      reason: pendingReason,
      userId,
    };
  }

  if (!isSignedIn) {
    return { status: "signed-out", reason: null, userId: null };
  }

  return { status: "authenticated", reason: null, userId };
}
