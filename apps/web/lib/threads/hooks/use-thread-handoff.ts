"use client";

import { useCallback, useEffect, useRef } from "react";
import { useConvex, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_MESSAGE_ATTACHMENTS } from "@/convex/lib/constants";
import { getNewThreadDraftKey, useThreadDraftProvider } from "@/components/blocks/thread/thread-draft-provider";
import { uploadToStorage } from "@/hooks/uploads/use-storage-upload-queue";
import { getErrorMessage } from "@/lib/errors";
import { appRoute, useNavigation } from "@/lib/navigation";
import { buildAddToGroupDraftSeed } from "@/lib/threads/draft-flow";
import type { ThreadComposerDraftAttachment } from "@/lib/threads/draft-storage";
import { useCliProfiles } from "@/lib/threads/hooks/use-cli-profiles";
import {
  THREAD_HISTORY_TOAST_ID,
  useDrainThreadHistory,
  type ThreadMarkdownExportMessages,
} from "@/lib/threads/hooks/use-thread-markdown-export";
import {
  buildHandoffDraftText,
  buildHandoffMarkdown,
  threadMarkdownFileName,
  type ThreadExportEnvelope,
} from "@/lib/threads/markdown-export";
import { readWholeForkPrefix } from "@/lib/threads/hooks/use-fork-prefix";
import { forkDividerAnchor } from "@/lib/threads/message-rows";
import type { CliThreadDetailItem } from "@/lib/threads/thread-query-patches";
import { CLI_TYPE_MAP } from "@/lib/threads/types";

/** The group's add-to-group draft tab; absent when the group can't take a tab. */
interface HandoffTab {
  draftKey: string;
  /** Shows the draft tab without seeding it. */
  open: () => void;
}

/**
 * Handoff from here: the conversation through one reply's run, as Markdown files on a
 * seeded new-thread or draft-tab draft. Spec: docs/specs/cli-thread-handoff.md
 */
export function useThreadHandoff({
  chat,
  cliMessages,
  organizationSlug,
  projectAlias,
  newTab,
}: {
  chat: CliThreadDetailItem | null | undefined;
  cliMessages: ThreadMarkdownExportMessages;
  organizationSlug: string;
  projectAlias: string;
  newTab?: HandoffTab;
}): {
  handoffToNewThread: (messageId: Id<"cliMessages">) => void;
  handoffToNewTab: ((messageId: Id<"cliMessages">) => void) | undefined;
} {
  const { profiles } = useCliProfiles(chat?.projectId);
  const { getDraftSnapshot, seedDraft } = useThreadDraftProvider();
  const navigation = useNavigation();
  const generateUploadUrl = useMutation(api.cli.messages.generateMessageAttachmentUploadUrl);
  const registerUpload = useMutation(api.cli.messages.registerPendingUploadedAttachment);
  const deletePendingUpload = useMutation(api.cli.messages.deletePendingUploadedAttachment);
  const convex = useConvex();
  // The reply being handed off and its target draft (`null` key: a new thread); set for the whole pass.
  const pendingRef = useRef<{ replyId: Id<"cliMessages">; tabDraftKey: string | null } | null>(null);
  const newTabRef = useRef(newTab);
  useEffect(() => {
    newTabRef.current = newTab;
  });

  const handOff = async (source: CliThreadDetailItem, replyId: Id<"cliMessages">, tabDraftKey: string | null) => {
    const { envelopes } = cliMessages;
    const reply = envelopes.find((envelope) => envelope._id === replyId);
    if (!reply) {
      throw new Error("The reply is no longer in this thread");
    }
    // Through the reply's whole run, so a steer sent after it started still counts.
    const runEndId = forkDividerAnchor(envelopes, reply.runId) ?? reply._id;
    const covered = envelopes.slice(0, envelopes.findIndex((envelope) => envelope._id === runEndId) + 1) as ThreadExportEnvelope[];
    // A fork's own rows start at the copied run; the ancestors hold the rest.
    const prefix = source.forkedFrom ? await readWholeForkPrefix(convex, source.forkedFrom) : null;

    const createdAt = Date.now();
    const fileName = threadMarkdownFileName(source.title, createdAt, "handoff");
    const fullFileName = fileName.replace(/\.md$/, "-full.md");
    const cliLabel = CLI_TYPE_MAP[source.cliType];
    const { capped, full } = buildHandoffMarkdown({
      title: source.title,
      taskRef: source.associatedTask?.refId,
      cliLabel,
      exportedAt: createdAt,
      hasUnreachableHistory: cliMessages.hasOlderEnvelopes || prefix?.complete === false,
      envelopes: [...((prefix?.envelopes ?? []) as ThreadExportEnvelope[]), ...covered],
      partsByMessageId: prefix ? new Map([...prefix.partsByMessageId, ...cliMessages.renderStateByMessageId]) : cliMessages.renderStateByMessageId,
      userTextById: prefix ? new Map([...prefix.userTextById, ...cliMessages.userTextById]) : cliMessages.userTextById,
      fullFileName,
    });
    const files = [
      { fileName, markdown: capped },
      ...(full === null ? [] : [{ fileName: fullFileName, markdown: full }]),
    ];

    // The new-thread composer is unmounted while a thread shows; an open draft tab remounts on the seed.
    const draftKey = tabDraftKey ?? getNewThreadDraftKey();
    const draftAttachments = getDraftSnapshot(draftKey)?.attachments;
    const kept = draftAttachments?.uploaded ?? [];
    if (kept.length + files.length > MAX_MESSAGE_ATTACHMENTS) {
      throw new Error(`The new-thread draft already has ${kept.length} attachments; remove some to make room for the handoff`);
    }

    toast.loading("Preparing the handoff", { id: THREAD_HISTORY_TOAST_ID });
    const results = await Promise.allSettled(
      files.map(async ({ fileName: name, markdown }): Promise<ThreadComposerDraftAttachment> => {
        const blob = new Blob([markdown], { type: "text/markdown" });
        const storageId = await uploadToStorage(await generateUploadUrl({ projectId: source.projectId }), blob, blob.type);
        // `null` is a refusal (oversized, so already deleted, or claimed).
        const url = await registerUpload({ projectId: source.projectId, storageId });
        if (url === null) {
          throw new Error(`Could not store ${name}`);
        }
        return { filePartId: crypto.randomUUID(), storageId, fileName: name, fileSize: blob.size, contentType: blob.type, url };
      })
    );
    const uploaded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) {
      await Promise.all(
        uploaded.map(({ storageId }) =>
          deletePendingUpload({ projectId: source.projectId, storageId: storageId as Id<"_storage"> }).catch(() => undefined)
        )
      );
      throw failure.reason;
    }

    const text = buildHandoffDraftText({
      title: source.title,
      threadUrl: new URL(
        appRoute.projectThreadDetail(organizationSlug, projectAlias, source._id).pathname,
        window.location.origin
      ).toString(),
      cliLabel,
      replyAt: reply.createdAt,
      fullFileName: full === null ? undefined : fullFileName,
    });
    seedDraft(
      draftKey,
      (previousText) => (previousText.trim() ? `${previousText.trimEnd()}\n\n${text}` : text),
      {
        ...buildAddToGroupDraftSeed(source, profiles),
        // The tab keeps the stamp so "+" doesn't re-seed it; a new thread has no source.
        ...(tabDraftKey === null && { seededFrom: undefined }),
        attachments: { pending: draftAttachments?.pending ?? false, uploaded: [...kept, ...uploaded] },
      }
    );
    toast.dismiss(THREAD_HISTORY_TOAST_ID);
    if (tabDraftKey !== null) {
      // Left the group mid-pass: the seeded draft waits for the group's "+".
      if (newTabRef.current?.draftKey === tabDraftKey) {
        newTabRef.current.open();
      }
      return;
    }
    navigation.push(
      appRoute.projectThreadsWithPreselection(organizationSlug, projectAlias, {
        attachedTask: source.associatedTask?.refId,
      })
    );
  };

  const { drain } = useDrainThreadHistory(cliMessages, () => {
    const pending = pendingRef.current;
    if (!chat || !pending) {
      pendingRef.current = null;
      return;
    }
    handOff(chat, pending.replyId, pending.tabDraftKey)
      .catch((error: unknown) => {
        toast.error(getErrorMessage(error, "Could not hand off the thread"), { id: THREAD_HISTORY_TOAST_ID });
      })
      .finally(() => {
        pendingRef.current = null;
      });
  });

  const start = useCallback(
    (replyId: Id<"cliMessages">, tabDraftKey: string | null) => {
      if (pendingRef.current) {
        return;
      }
      pendingRef.current = { replyId, tabDraftKey };
      drain();
    },
    [drain]
  );
  const handoffToNewThread = useCallback((messageId: Id<"cliMessages">) => start(messageId, null), [start]);
  const handoffToNewTab = useCallback(
    (messageId: Id<"cliMessages">) => {
      const draftKey = newTabRef.current?.draftKey;
      if (draftKey) {
        start(messageId, draftKey);
      }
    },
    [start]
  );

  return { handoffToNewThread, handoffToNewTab: newTab ? handoffToNewTab : undefined };
}
