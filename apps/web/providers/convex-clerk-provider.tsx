"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexProviderWithAuth, ConvexReactClient, useConvexAuth } from "convex/react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 16_000;

const RetryNonceContext = createContext(0);

/**
 * Clerk-backed Convex auth that re-authenticates after a failed token fetch.
 * Convex itself gives up for good when Clerk stalls once; see
 * docs/specs/auth-redirect-return-url.md (auth readiness).
 */
export function ConvexClerkProvider({ client, children }: { client: ConvexReactClient; children: ReactNode }) {
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  return (
    <RetryNonceContext.Provider value={nonce}>
      <ConvexProviderWithAuth client={client} useAuth={useConvexAuthFromClerk}>
        <ConvexAuthRetry nonce={nonce} retry={retry} />
        {children}
      </ConvexProviderWithAuth>
    </RetryNonceContext.Provider>
  );
}

function useConvexAuthFromClerk() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const nonce = useContext(RetryNonceContext);
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        return await getToken({ template: "convex", skipCache: forceRefreshToken });
      } catch {
        return null;
      }
    },
    // A new identity makes ConvexProviderWithAuth call setAuth again; getToken is
    // left out on purpose, as in convex/react-clerk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nonce]
  );

  return useMemo(
    () => ({ isLoading: !isLoaded, isAuthenticated: isSignedIn ?? false, fetchAccessToken }),
    [isLoaded, isSignedIn, fetchAccessToken]
  );
}

/** Signed in with Clerk but Convex reported unauthenticated: retry with backoff. */
function ConvexAuthRetry({ nonce, retry }: { nonce: number; retry: () => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const failed = isLoaded && Boolean(isSignedIn) && !isLoading && !isAuthenticated;
  const attemptRef = useRef(0);

  useEffect(() => {
    if (isAuthenticated) attemptRef.current = 0;
    if (!failed) return;

    const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** attemptRef.current, RETRY_MAX_DELAY_MS);
    const timeoutId = window.setTimeout(() => {
      attemptRef.current += 1;
      retry();
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [failed, isAuthenticated, nonce, retry]);

  return null;
}
