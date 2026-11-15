# CLI Thread Draft Persistence Specification

This document specifies unsent composer draft persistence behavior for CLI thread.

## Related Specs

- Context selector interaction and display: `docs/specs/cli-thread-context-selectors.md`
- Mode behavior: `docs/specs/cli-thread-modes.md`
- Model selection behavior: `docs/specs/cli-thread-model-selection.md`

## Overview

- Draft state is client-side only (`localStorage`)
- Draft scope is per project (`organizationSlug + projectAlias`)
- Drafts persist across route changes and full page reloads
- Drafts are not live-synced across tabs in v1 (last write wins)
- Fresh new-thread composers also consult a separate global client-side remembered selection keyed by `cliType` for model and reasoning effort

## Draft Model

Each thread draft uses the following shape:

```ts
{
  text: string;
  composerContent?: object; // optional serialized Tiptap JSON for command chips
  mode?: string;
  cliType?: CliTypeSlug;
  cliModel?: ClaudeCodeModel; // Portable slots are listed in cli-thread-model-selection.md.
  profileId?: string;
  pathId?: string;
  baseRef?: BaseRefSelection; // worktree/base-ref selection, see docs/specs/cli-worktrees.md
  attachments?: {
    pending: boolean; // any attachment present, including in-flight uploads
    uploaded?: Array<{ filePartId: string; storageId: string; fileName: string; fileSize: number; contentType: string; url?: string }>;
  };
  updatedAt: number;
}
```

`baseRef` is scoped to the working directory: changing `pathId` clears it,
and resolution drops selections that reference a removed worktree or a
worktree of a different parent path.

Task attachment state is intentionally not part of the persisted draft model in v1. Composer task attachments are mounted-local state only and clear on remount/reload.

## File attachments (OS-2141)

Finished uploads persist with the draft, so files survive route changes, task
switches and reloads like the text does. This applies to the `new`,
`thread:<threadId>`, `task:<taskId>` and add-to-group drafts. The agent
automation dialog's draft slot is ephemeral and keeps the old behavior.

- `useThreadMessageAttachmentUpload(projectId, { attachments, save })` owns
  `draft.attachments`. It writes `uploaded` when an upload finishes or the user
  removes one, and the hosts no longer write `pending` themselves.
- `filePartId` is the composer file-part ID, so restored `#filename` reference
  pills in `composerContent` find their file again.
- `url` is the blob's storage URL, returned by
  `registerPendingUploadedAttachment`. Convex storage URLs don't expire, so
  previews work after a reload.
- On mount the hook seeds `uploaded` into its queue as finished items and the
  composer mounts with them (`initialAttachments`). Nothing uploads twice. The
  hook re-registers each restored blob, which refreshes its pending-upload age.
- On unmount the hook keeps blobs listed in `uploaded`. It still deletes the
  others, and uploads still in flight abandon as before.
- An upload still in flight when the composer unmounts is lost. Its blob is
  deleted.
- Unsent uploads whose draft is dropped (pruned, cleared, closed tab) stay
  registered until the server's retention sweep deletes them. See
  [cli-message-attachments.md](cli-message-attachments.md#pending-upload-lifecycle).

## Storage Envelope

Drafts are stored per project key under a versioned payload:

```ts
{
  version: 1;
  drafts: Record<string, ThreadComposerDraft>;
}
```

Validation requirements:

- Invalid/corrupt payloads fall back to an empty map.
- Unknown `cliType` values are ignored.
- Empty/invalid thread keys are ignored.

Pruning requirements:

- Remove drafts older than 30 days.
- Cap drafts to 100 per project by `updatedAt` descending.

## Thread Keys

- New thread route (`/threads`): `new`
- Existing thread route (`/threads/[threadId]`): `thread:<threadId>`
- Task-attached thread composer (task sidebar timeline, task-table Runs overlay): `task:<taskId>`

`new` is a single shared draft per project, regardless of mode/profile/path.

## New Thread Resolution Rules

When rendering the `/threads` new-thread composer, effective values resolve in this order:

For **profile/path** selection:

1. URL preselection (`profileId`, `pathId`) — explicit user action from agent link
2. Valid persisted draft profile/path
3. Runtime defaults (online profile/path fallback)

For **text, cliType, mode, cliModel, cliEffort**:

1. Valid persisted draft values
2. For `cliModel` and `cliEffort`, remembered global selection for the active `cliType`, but only when the selected profile exposes that CLI in `availableClis`
3. Runtime defaults (default cli type/mode/model/effort)

The UI must backfill missing persisted fields (including `attachments`) so a prefilled state is retained after navigation.

## Existing Thread Resolution Rules

When rendering `/threads/[threadId]`:

- Text source: draft text for `thread:<threadId>`
- Mode source: draft mode, else the thread's stored `metadata.cli.lastUsedMode`, else default mode for thread cli type
- Model source: draft `cliModel`, else the thread's stored `metadata.cli.lastUsedModel`, else default model for thread cli type
- Effort source: draft `cliEffort`, else the thread's stored `metadata.cli.lastUsedEffort`, else default effort for thread cli type

The `metadata.cli` fallbacks are denormalized onto the thread document at
user-message-write time (OS-1454) rather than scanned out of the message list,
so they arrive with the same query that gates the view. See
`docs/specs/cli-thread-model-selection.md` and
`docs/specs/cli-thread-effort-selection.md`.

## Clear Behavior

- Successful new thread creation clears the `new` draft's message (`text`,
  `composerContent`, `attachments`) and keeps its selector state (cliType,
  mode, model, effort, working directory, base ref, project agent). Deleting
  the whole draft made every selector flash back to its default (e.g. Plan →
  Act) while the created thread was still opening.
- Successful new thread creation from the task sidebar `Threads` tab clears only that task's `task:<taskId>` draft message.
- Successful new thread creation updates the separate remembered global selection:
  - always records the created thread's `cliType` as the last-used CLI type,
  - records `cliModel` for that `cliType` only when that runtime supports the selected model,
  - records `cliEffort` for that `cliType` only when that runtime supports the selected effort.
- Successful message send in existing thread clears draft `text` and `composerContent`.
- Failed send/create keeps draft unchanged.
- Successful send/create clears `attachments.uploaded` together with the
  message text. The sent message now references those blobs.
- Draft persistence stores uploaded storage references, never file bytes.
- Mounted task attachments are not persisted and therefore clear on remount/reload even when text draft state remains.
- Task-sidebar drafts are isolated per task; switching tasks does not reuse another task's unsent text or selector state.

## Existing Thread Submit Feedback

When submitting from `/threads/[threadId]`:

- The composer enters a local submitting state immediately after the user sends a message.
- While that local send is pending:
  - textarea input is disabled,
  - submit control shows the existing submitting spinner state,
  - mode/path/CLI selectors are disabled so the submitted context cannot drift.
- Outside that submitting state, an empty thread composer remains visually enabled and interactive; only the submit control is disabled until the user has queued text, attachments, or an attached task.
- If the send succeeds, the existing-thread draft text is cleared after the mutation resolves.
- If the send fails, the composer exits submitting state and keeps the existing draft text and uploaded attachments intact for retry.

## Out of Scope (v1)

- Persisting uploads that are still in flight
- Cross-tab live synchronization
- Server-side draft storage

## QA Checklist

- Unsent text survives switching between thread routes.
- Uploaded attachments and their `#filename` pills survive switching threads,
  switching tasks and reloading, and send without re-uploading.
- Unsent text and selectors survive reloading the page.
- New-thread prefilled state remains when returning to `/threads`.
- Fresh new-thread model and effort fallbacks use the remembered global selection for the active CLI after a successful supported thread creation.
- Switching to a profile without the active CLI ignores remembered fallback.
- Existing-thread mode resolves with draft precedence.
- Existing-thread model resolves with draft precedence.
- Existing-thread interactions do not overwrite the remembered global selection.
- Draft persistence remains client-side only; backend command expansion is defined in `docs/specs/slash-commands.md`.
- Slash command chips survive route changes and reloads because `composerContent` stores the serialized editor JSON in addition to plain `text`.
