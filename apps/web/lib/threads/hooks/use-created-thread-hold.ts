"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useCreatedThreadReady,
  type CreatedThreadTarget,
} from "@/lib/threads/hooks/use-created-thread-ready";

/**
 * Holds a create flow between the mutation and the swap (OS-1665,
 * docs/specs/thread-groups.md → Creating a thread): `awaitCreatedThread`
 * resolves once the created thread renders without placeholders, so the caller
 * keeps its composer — text, pills and all — until then. Awaited inside the
 * submit, so the composer's existing `isSubmitting` covers the wait.
 */
export function useCreatedThreadHold() {
  const [held, setHeld] = useState<CreatedThreadTarget | undefined>(undefined);
  const isReady = useCreatedThreadReady(held);
  const resolveRef = useRef<(() => void) | undefined>(undefined);

  // Stays subscribed after releasing, deliberately: unsubscribing in the same
  // commit as the swap can drop the cache entry the workspace is about to read,
  // putting back the loading beat this exists to remove. The workspace
  // subscribes to the same query with the same args, so Convex dedupes it.
  // Keyed on the target too, so a second create still resolves if its data
  // happens to be warm already.
  useEffect(() => {
    if (!isReady || !resolveRef.current) {
      return;
    }
    const resolve = resolveRef.current;
    resolveRef.current = undefined;
    resolve();
  }, [held, isReady]);

  // Nothing rejects: a failed mutation never reaches here, and the caller's
  // catch already re-enables the composer.
  const awaitCreatedThread = useCallback(
    (target: CreatedThreadTarget) =>
      new Promise<void>((resolve) => {
        resolveRef.current = resolve;
        setHeld(target);
      }),
    []
  );

  return { awaitCreatedThread };
}
