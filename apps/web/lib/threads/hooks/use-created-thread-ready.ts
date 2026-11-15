"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export interface CreatedThreadTarget {
  threadId: Id<"cliThreads">;
  /** The new thread's group, omitted for a root thread. */
  containerId?: Id<"cliThreads">;
}

/**
 * Whether a just-created thread can be shown without placeholders (OS-1665,
 * docs/specs/thread-groups.md → Creating a thread): every subscription the
 * workspace is about to read is warm, so it mounts on real data. These are
 * exactly those subscriptions, so warming them here costs no extra round trip.
 */
export function useCreatedThreadReady(created: CreatedThreadTarget | undefined): boolean {
  const thread = useQuery(api.cli.threads.core.get, created ? { threadId: created.threadId } : "skip");
  // The transcript's own source: the doc alone would mount ThreadView with an
  // empty message list for a beat — the user's message briefly missing.
  const envelopes = useQuery(
    api.cli.messages.listEnvelopesByThread,
    created ? { threadId: created.threadId } : "skip"
  );
  // The first group addition creates the container in that mutation, so `getGroup`
  // subscribes from scratch and the strip would fall back to placeholders.
  const group = useQuery(
    api.cli.threads.groups.getGroup,
    created?.containerId ? { containerId: created.containerId } : "skip"
  );

  return (
    created !== undefined &&
    thread !== undefined &&
    envelopes !== undefined &&
    (created.containerId === undefined || group !== undefined)
  );
}
