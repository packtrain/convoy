"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, type ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { CliThreadForkedFrom } from "@/convex/lib/contracts/validators";
import { extractLatestAskUserQuestionResponses, type AskUserQuestionResponseMap } from "@/lib/ai-tools/ask-user-question";
import { applyDeltaPage, initComposerFromStore } from "@/lib/cli-stream-ui";
import type { ComposerState, EventStoreState, NormalizedChunkRow } from "@/lib/cli-stream-ui";
import { deriveUserMessageResponseMap, rendersFromEnvelope } from "@/lib/threads/message-rows";
import { extractUserText } from "./use-cli-messages";

const WINDOW_LIMIT = 50;

type EnvelopeWindow = FunctionReturnType<typeof api.cli.messages.listEnvelopesByThread>;
type MessageEnvelope = EnvelopeWindow["envelopes"][number];
type WindowResult = FunctionReturnType<typeof api.cli.messageChunks.listWindowByThread>;
type ChunkCursor = NonNullable<WindowResult["nextOlderCursor"]>;

const EMPTY_STORE: EventStoreState = { rows: [], dedupKeys: new Set(), cursor: null };
const EMPTY_HOPS: Hop[] = [];

/** One ancestor's rows before the run that was copied out of it. */
type Hop = {
  forkedFrom: CliThreadForkedFrom;
  /** The ancestor's title, for the divider of the hop below it. */
  title: string;
  /** The ancestor's own origin, when it is a fork too: the next hop up. */
  parentForkedFrom?: CliThreadForkedFrom;
  /** Oldest first. */
  envelopes: MessageEnvelope[];
  hasOlderEnvelopes: boolean;
  store: EventStoreState;
  nextOlderCursor: ChunkCursor | null;
  hasMoreChunks: boolean;
};

type LoadedPrefix = {
  /** Which parent run this was read for. */
  key: string;
  status: "loaded" | "unavailable";
  /** Oldest first; `hops[0]` is the frontier "Show more" pages. */
  hops: Hop[];
  isLoadingOlder: boolean;
};

export interface ForkPrefixSegment {
  forkedFrom: CliThreadForkedFrom;
  title: string;
  parentForkedFrom?: CliThreadForkedFrom;
  /** Oldest first; only messages whose chunks are loaded (or chunkless user rows). */
  messages: MessageEnvelope[];
}

export interface ForkPrefixView {
  status: "loading" | LoadedPrefix["status"];
  /** Oldest ancestor first. */
  segments: ForkPrefixSegment[];
  renderStateByMessageId: ComposerState["messages"];
  userTextById: Map<string, string>;
  userMessageResponseMap: ReturnType<typeof deriveUserMessageResponseMap>;
  askUserQuestionResponses: AskUserQuestionResponseMap;
  getUserMessageAttachments: (messageId: string) => MessageEnvelope["attachments"] | undefined;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => void;
}

function mergeOlderEnvelopes(current: MessageEnvelope[], older: EnvelopeWindow["envelopes"]): MessageEnvelope[] {
  return [...[...older].reverse(), ...current];
}

function hopHasOlder(hop: Hop): boolean {
  return hop.hasMoreChunks || hop.hasOlderEnvelopes;
}

/** `null` when the ancestor is deleted or not viewable; its message queries return empty rather than throwing. */
async function readHop(convex: ConvexReactClient, forkedFrom: CliThreadForkedFrom): Promise<Hop | null> {
  const { threadId, runStart, reply } = forkedFrom;
  const cutoff: ChunkCursor = { createdAt: reply.createdAt, messageId: reply.messageId, chunkOrder: 0 };
  const [thread, envelopeWindow, window] = await Promise.all([
    convex.query(api.cli.threads.core.get, { threadId }),
    convex.query(api.cli.messages.listEnvelopesByThread, { threadId, before: runStart.createdAt }),
    convex.query(api.cli.messageChunks.listWindowByThread, { threadId, before: cutoff, limit: WINDOW_LIMIT }),
  ]);
  if (!thread) {
    return null;
  }
  const { state: store } = applyDeltaPage(EMPTY_STORE, {
    page: window.page as NormalizedChunkRow[],
    nextCursor: null,
    resetRequired: false,
  });
  return {
    forkedFrom,
    title: thread.title,
    parentForkedFrom: thread.forkedFrom,
    envelopes: mergeOlderEnvelopes([], envelopeWindow.envelopes),
    hasOlderEnvelopes: envelopeWindow.hasOlderEnvelopes,
    store,
    nextOlderCursor: window.nextOlderCursor,
    hasMoreChunks: window.hasMore,
  };
}

/**
 * Reads ancestors, oldest first, until one has rows: an ancestor that only held
 * the copied run is passed through. Empty when the first ancestor is gone; a
 * gone ancestor further up ends the walk and the hop below it stops pointing up.
 */
async function readChain(convex: ConvexReactClient, forkedFrom: CliThreadForkedFrom): Promise<Hop[]> {
  const hops: Hop[] = [];
  let next: CliThreadForkedFrom | undefined = forkedFrom;
  while (next) {
    const hop: Hop | null = await readHop(convex, next);
    if (!hop) {
      const below = hops[0];
      if (below) hops[0] = { ...below, parentForkedFrom: undefined };
      break;
    }
    hops.unshift(hop);
    if (hop.envelopes.length > 0 || hopHasOlder(hop)) break;
    next = hop.parentForkedFrom;
  }
  return hops;
}

// Both axes page together: chunk pages reach messages the capped envelope window
// has not loaded yet, and those render only once their envelope arrives.
async function readOlder(convex: ConvexReactClient, hop: Hop): Promise<Hop> {
  const { threadId } = hop.forkedFrom;
  const chunkCursor = hop.hasMoreChunks ? hop.nextOlderCursor : null;
  const oldestEnvelope = hop.envelopes[0];
  const envelopeCutoff = hop.hasOlderEnvelopes && oldestEnvelope ? oldestEnvelope.createdAt : null;
  const [window, envelopeWindow] = await Promise.all([
    chunkCursor ? convex.query(api.cli.messageChunks.listWindowByThread, { threadId, before: chunkCursor, limit: WINDOW_LIMIT }) : null,
    envelopeCutoff !== null ? convex.query(api.cli.messages.listEnvelopesByThread, { threadId, before: envelopeCutoff }) : null,
  ]);
  const { state: store } = window
    ? applyDeltaPage(hop.store, { page: window.page as NormalizedChunkRow[], nextCursor: null, resetRequired: false })
    : { state: hop.store };
  return {
    ...hop,
    store,
    nextOlderCursor: window ? window.nextOlderCursor : hop.nextOlderCursor,
    hasMoreChunks: window ? window.hasMore : hop.hasMoreChunks,
    envelopes: envelopeWindow ? mergeOlderEnvelopes(hop.envelopes, envelopeWindow.envelopes) : hop.envelopes,
    hasOlderEnvelopes: envelopeWindow ? envelopeWindow.hasOlderEnvelopes : hop.hasOlderEnvelopes,
  };
}

/**
 * A fork's view of its ancestors before the copied run (OS-1397): read once
 * with the Convex client, never subscribed. Everything above the cutoff is
 * immutable, so a one-shot read is exact. Mount reads one window from the
 * parent; "Show more" pages it, then walks to the grandparent, one hop per
 * click. Spec: cli-thread-fork.md → Earlier parent messages.
 */
export function useForkPrefix(args: { forkedFrom: CliThreadForkedFrom }): ForkPrefixView {
  const { forkedFrom } = args;
  const convex = useConvex();
  const key = `${forkedFrom.threadId}:${forkedFrom.reply.messageId}`;
  const [loaded, setLoaded] = useState<LoadedPrefix | null>(null);
  const current = loaded?.key === key ? loaded : null;
  // The thread document is a fresh object on every update; the read keys on the run, not the object.
  const forkedFromRef = useRef(forkedFrom);
  useEffect(() => {
    forkedFromRef.current = forkedFrom;
  });

  // One read per parent run.
  useEffect(() => {
    if (current !== null) {
      return;
    }
    let cancelled = false;
    readChain(convex, forkedFromRef.current)
      .then((hops) => {
        if (cancelled) return;
        setLoaded({ key, status: hops.length > 0 ? "loaded" : "unavailable", hops, isLoadingOlder: false });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, status: "unavailable", hops: [], isLoadingOlder: false });
      });
    return () => {
      cancelled = true;
    };
  }, [convex, current, key]);

  const loadOlder = useCallback(() => {
    const frontier = current?.hops[0];
    if (!current || current.isLoadingOlder || !frontier) {
      return;
    }
    const read = hopHasOlder(frontier)
      ? readOlder(convex, frontier).then((hop) => [hop])
      : frontier.parentForkedFrom
        ? readChain(convex, frontier.parentForkedFrom).then((older) =>
            older.length > 0 ? [...older, frontier] : [{ ...frontier, parentForkedFrom: undefined }]
          )
        : null;
    if (read === null) {
      return;
    }
    setLoaded((prev) => (prev ? { ...prev, isLoadingOlder: true } : prev));
    read
      .then((replacement) => {
        setLoaded((prev) => (prev ? { ...prev, hops: [...replacement, ...prev.hops.slice(1)], isLoadingOlder: false } : prev));
      })
      .catch(() => {
        setLoaded((prev) => (prev ? { ...prev, isLoadingOlder: false } : prev));
      });
  }, [convex, current]);

  const hops = current?.hops ?? EMPTY_HOPS;

  // Message ids are unique across threads, so one composer covers every hop.
  const store = useMemo<EventStoreState>(
    () => ({ rows: hops.flatMap((hop) => hop.store.rows), dedupKeys: new Set(), cursor: null }),
    [hops]
  );
  const renderStateByMessageId = useMemo(() => initComposerFromStore(store).messages, [store]);

  const segments = useMemo<ForkPrefixSegment[]>(() => {
    const loadedIds = new Set(store.rows.map((row) => row.messageId));
    return hops.map((hop) => ({
      forkedFrom: hop.forkedFrom,
      title: hop.title,
      parentForkedFrom: hop.parentForkedFrom,
      messages: hop.envelopes.filter(
        (envelope) => loadedIds.has(envelope._id) || rendersFromEnvelope(envelope)
      ),
    }));
  }, [hops, store.rows]);

  const messages = useMemo(() => segments.flatMap((segment) => segment.messages), [segments]);

  const userTextById = useMemo(() => {
    const textById = new Map<string, string>();
    for (const message of messages) {
      if (message.role === "user") {
        textById.set(message._id, extractUserText(renderStateByMessageId.get(message._id)));
      }
    }
    return textById;
  }, [messages, renderStateByMessageId]);

  const userMessageResponseMap = useMemo(
    () => deriveUserMessageResponseMap(messages, userTextById),
    [messages, userTextById]
  );

  const askUserQuestionResponses = useMemo(
    () =>
      extractLatestAskUserQuestionResponses(
        messages.map((message) => ({
          role: message.role,
          createdAt: message.createdAt,
          textContent: message.role === "user" ? (userTextById.get(message._id) ?? "") : "",
        }))
      ),
    [messages, userTextById]
  );

  const getUserMessageAttachments = useCallback(
    (messageId: string) => messages.find((message) => message._id === messageId)?.attachments,
    [messages]
  );

  const frontier = hops[0];
  const hasOlder = frontier !== undefined && (hopHasOlder(frontier) || frontier.parentForkedFrom !== undefined);
  const status: ForkPrefixView["status"] = current ? current.status : "loading";

  return {
    status,
    segments,
    renderStateByMessageId,
    userTextById,
    userMessageResponseMap,
    askUserQuestionResponses,
    getUserMessageAttachments,
    hasOlder,
    isLoadingOlder: current?.isLoadingOlder ?? false,
    loadOlder,
  };
}

/** The handoff's view of a fork's ancestors: everything before the copied run, oldest first. */
export interface WholeForkPrefix {
  envelopes: MessageEnvelope[];
  partsByMessageId: ComposerState["messages"];
  userTextById: Map<string, string>;
  /** False when a page stopped making progress or an ancestor is gone mid-chain. */
  complete: boolean;
}

export async function readWholeForkPrefix(
  convex: ConvexReactClient,
  forkedFrom: CliThreadForkedFrom
): Promise<WholeForkPrefix> {
  let hops = await readChain(convex, forkedFrom);
  let complete = true;
  // The same walk as "Show more", repeated until the oldest ancestor is exhausted.
  for (let frontier = hops[0]; frontier; frontier = hops[0]) {
    if (hopHasOlder(frontier)) {
      const older = await readOlder(convex, frontier);
      if (older.envelopes.length === frontier.envelopes.length && older.store.rows.length === frontier.store.rows.length) {
        complete = false;
        break;
      }
      hops = [older, ...hops.slice(1)];
    } else if (frontier.parentForkedFrom) {
      const ancestors = await readChain(convex, frontier.parentForkedFrom);
      if (ancestors.length === 0) {
        complete = false;
        break;
      }
      hops = [...ancestors, ...hops];
    } else {
      break;
    }
  }

  const store: EventStoreState = { rows: hops.flatMap((hop) => hop.store.rows), dedupKeys: new Set(), cursor: null };
  const partsByMessageId = initComposerFromStore(store).messages;
  const envelopes = hops.flatMap((hop) => hop.envelopes);
  const userTextById = new Map(
    envelopes.flatMap((envelope) =>
      envelope.role === "user" ? [[envelope._id as string, extractUserText(partsByMessageId.get(envelope._id))] as const] : []
    )
  );
  return { envelopes, partsByMessageId, userTextById, complete };
}
