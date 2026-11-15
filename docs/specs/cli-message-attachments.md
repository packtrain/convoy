# CLI Message Attachments Specification

This document defines how thread message attachments are uploaded, persisted, rendered, and consumed by the CLI executor.

## Scope

- Applies to thread composer flows in `apps/web`:
  - `/threads` new-thread composer
  - `/threads/[threadId]` detail composer
- Applies to backend contract in `apps/web/convex` for `cliMessages`/`cliThreads`.
- Applies to local attachment staging and execution in `apps/cli`.
- Applies to CLI-originated uploads: `convoy threads create --attach` and
  `convoy threads send --attach` (OS-1634). The CLI both uploads and consumes.
- Applies to agent reply attachments: `convoy threads attach` (OS-2091), and
  its `--inline` html pages (OS-2220).

## Limits and Defaults

- Maximum attachments per message: 10.
- 50 MB per file, enforced server-side against the stored blob. See
  [task-attachments.md](task-attachments.md#size-limit-os-1676).
- Attachment metadata is persisted with user messages and, for agent-attached
  files, with assistant replies (OS-2091).
- CLI local cache TTL: 7 days by last access.

## Upload and Message Contract

### Mutation inputs

- `cliMessages.send` accepts optional `attachments`:
  - `storageId`, `fileName`, `fileSize`, `contentType`, optional `dimensions`
    (`{ width, height }` in pixels, images only), optional `display: "inline"`
    (`text/html` only; see [Inline HTML](#inline-html-os-2220))
- `cliThreads.create` accepts optional initial `attachments` with the same shape.

### Stored message data

- `cliMessages.attachments[]` stores:
  - `storageId`, `fileName`, `fileSize`, `contentType`, `uploadedAt`, optional `dimensions`,
    optional `display`
- The web upload queue measures an image's `dimensions` (`createImageBitmap`) while it
  uploads. Drafts, queued-message edits, and edit-last resends carry them; envelopes and
  `getMessageAttachmentUrls` return them. CLI uploads and messages sent before this field
  existed have none.
- `cliMessageAttachmentRefs` tracks attachment references by:
  - `storageId`, `messageId`, `threadId`
  - used by pending-upload cleanup.

### Query return data

- `cliMessages.listByThread` and `cliMessages.listUnprocessedUserMessages` return attachment summaries including signed `url`.
- `cliMessages.listEnvelopesByThread` returns attachment **metadata only** — no
  signed `url` (OS-1600). Resolving a storage URL is I/O for data that changes
  only when the message is created, and that query is subscribed and re-runs on
  every message write in the thread.
- `cliMessages.getMessageAttachmentUrls({ messageId })` resolves the signed URLs
  for one message on demand. Both lazy readers are gated on thread viewability
  and return empty for a caller without access.

### Pending upload lifecycle

- `cliMessages.generateMessageAttachmentUploadUrl` returns signed upload URL.
- `cliMessages.registerPendingUploadedAttachment` records the uploader in
  `cliMessagePendingUploads`, so only they can reclaim an abandoned blob. It
  refuses (silently, inserting nothing) when the id is referenced or pending
  anywhere, in this family or in task attachments (OS-1901, `convex/lib/storageRepo.ts`).
  Re-registering your own upload refreshes its `createdAt`. An unclaimed blob
  over the size cap is deleted instead of registered (OS-1676). It returns the
  blob's storage URL when the caller owns the row, else `null`. Composer drafts
  store that URL (OS-2141).
- `cliMessages.send` and `cliThreads.create` attach a `storageId` only when the
  sender owns a pending row for it in the thread's project, else `Upload not
  found. Register the upload before attaching it`. The row is spent by the send.
- `cliMessages.deletePendingUploadedAttachment` and message deletion delete a
  blob only when no attachment record in either family references it. See
  [task-attachments.md](task-attachments.md#storage-ownership-os-1901).
- Uploaded-but-unsent attachments are cleaned up on explicit remove. Composers
  that persist drafts keep finished uploads on unmount so the draft can restore
  them (OS-2141, [cli-thread-drafts.md](cli-thread-drafts.md#file-attachments-os-2141)).
  Other composers delete them on unmount.
- All three accept an optional `apiKey` and pass `principal` to project
  authorization (OS-1632), so a CLI caller with no Clerk identity can attach
  files. A non-composer caller must register on upload and delete in a
  `finally`. Otherwise a failed send leaves the blob around until the retention
  sweep. See [permissions-system.md](permissions-system.md).
- A daily cron (`cliMessages.pendingUploadRetentionSweep`) deletes pending rows
  older than 30 days (`PENDING_UPLOAD_RETENTION_MS`, the same as the draft TTL)
  and deletes their blobs unless a message references them. This is the only
  cleanup for an upload whose draft was dropped or whose tab closed (OS-2141).

## Composer Behavior

Composers use `useThreadMessageAttachmentUpload` (wrapper over `useStorageUploadQueue`):

0. Attachments are initiated from the composer `+` action menu or the `Mod+U` shortcut.
1. File parts are synchronized into the upload queue as attachments are added/removed.
2. Upload states are displayed as pill chips in the composer.
   - Clicking a queued image attachment with a usable local URL opens the same lightbox preview used by sent user messages, without removing the attachment.
   - Clicking a queued text attachment (a handoff file, say) opens the [text preview](task-attachments.md#text-attachment-preview-os-2133). It needs the file's size from its upload row, so a text part without one stays a plain pill.
   - The preview action is available from both inline attachment pills and previewable rows inside the grouped attachments menu.
3. Composer attachment chips cap visible pills at three total:
   - with an attached task: task pill, first file pill, then an `X more attachment` / `X more attachments` dropdown pill for the rest
   - without an attached task: first two file pills, then an `X more attachment` / `X more attachments` dropdown pill for the rest
   - the dropdown label uses the singular `attachment` when only one file is hidden
4. Dragging files over the composer highlights the input surface with the same blue drop affordance used in the task detail sidebar and shows the `Drop files to attach` overlay label.
5. Submit is blocked while any attachment is `uploading` or `error`.
6. On submit, composers wait for in-flight uploads, validate queue state, and send/create with uploaded attachment metadata.
7. On successful submit, pending queue state is cleared.
8. On failure, pending queue state remains for retry.

## Attachment references in the composer

OS-1619 uses `#filename` references for attachments; `@path` remains a repository
file mention. This applies to existing threads, new threads, group drafts, and
message editing through the shared thread composer.

- File paste adds accepted files to the top attachment section and inserts atomic
  reference pills at the editor selection immediately. A batch preserves input
  order, replaces a selected range, separates references with spaces, and leaves
  a trailing space. Rejected files never get references.
- The + picker, Mod+U, and file drops only add attachments. They never insert
  references automatically, including drops over editable text.
- Typing `#` at a text start or after whitespace opens a local attachment menu.
  Filtering is case-insensitive and works offline. Whitespace ends the query;
  choosing a result can insert a filename containing spaces. No matches leave
  ordinary text and keyboard behavior intact. Arrow keys, Enter, Tab, Escape,
  pointer selection, blur, and composition follow the existing mention menu.
- Hovering an image in the `#` suggestion menu or an inserted image reference
  opens a 384px-wide popover with an image up to 256px high, constrained to
  the viewport. The hover preview shows only the image, without repeating its
  filename. Use the current attachment URL so
  local images can be previewed while uploading. Clicking a suggestion row still
  inserts its reference. Clicking an inserted image reference or the popover's
  image opens the existing attachment lightbox without editing or submitting the
  draft. Preview interactions preserve the editor selection. Non-image and
  unavailable references have no image-preview action; removing the target
  closes its preview and lightbox.
- Each reference stores the file-part ID separately from its filename. Pending
  references show a spinner, even before the upload queue registers them.
  Completion clears it; failure shows an error explanation and preserves submit
  blocking. Removing an attachment grays out every corresponding reference and
  marks it unavailable. A late upload completion cannot restore that reference.
- Deleting or undoing references leaves attachments intact. Upload state changes
  affect only appearance, never insertion, caret position, serialization, or undo.
- Newly accepted files receive unique names before upload. Compare names without
  case; preserve display casing and append the first unused `-2`, `-3`, etc.
  before the last extension. Dotfiles without another dot are extensionless.
  Reserve names for the active draft after removal, and clear reservations on
  successful send or explicit reset. Restored files keep their original names.
- Reserve file-part IDs before asynchronous preparation so overlapping additions
  upload each file once. Submission waits for preparation and upload completion.
  Preparation errors show the same error state as failed uploads. Removal during
  preparation or upload abandons the completed storage object and cannot restore
  a reference or attach that file to a later message.
- The reference, attachment chip, upload queue, sent metadata, and CLI context use
  the same filename. Plain serialization uses `#name`, or `#` followed by a
  JSON-quoted name if it contains whitespace, `#`, quotes, or backslashes.
- Draft JSON retains identity and labels. Missing draft blobs make references
  unavailable. Queued edits rebuild exact, unambiguous references as pills using
  restored file-part IDs and preserve storage IDs without uploading again.
  Historical duplicate names remain
  ambiguous in plain text; leave those references and unmatched `#` prose as text.
  Rebuild pills only when hydrating external text, never in response to typing,
  upload updates, or adding files; deleted references must not reappear.
- Sent messages keep plain text in storage. The display resolves references as
  described below; no new backend fields or migration are required.

Claude inline images are immediately preceded by a text block containing the
JSON-quoted filename and MIME type. Keep each label/image pair inside its source
message and in attachment order, including steering. Other runtime attachment
lists and unsupported-image fallback retain their existing behavior.

## Queued Message Edit and Steer

- Editing a queued message (queued-messages strip) restores its attachments
  into the composer without re-uploading: `removeQueued({
  preserveAttachments: true })` keeps the blobs (attachment refs are
  converted to `cliMessagePendingUploads` rows) and returns their summaries;
  the client seeds them into the upload queue as already-uploaded items and
  re-attaches the existing storage ids on send. See
  `docs/specs/cli-steering.md`.
- Steered messages keep their attachments: the CLI resolves and injects them
  into the active run, and the inline steered bubble renders the
  attachment pills via the steered message's envelope.

## Message Rendering

- Regular and steered user messages display exact `#filename` references as
  highlighted inline chips when the filename uniquely matches that message's
  attachments. JSON-quoted names follow composer serialization. Match only at
  text starts, whitespace, or opening brackets, with a token boundary afterward.
  Leave unknown names, partial matches, URL fragments, and case-insensitive
  duplicate names as plain text. Preserve slash-command and skill formatting.
- Image references use the same 384px hover preview as the composer, without a
  repeated filename caption. Hover or keyboard focus resolves image URLs lazily;
  show loading and unavailable states. Clicking a reference or preview image opens
  the attachment lightbox, including clicks made before URL resolution finishes.
  Non-image references are highlighted labels without an image action. Stored
  text and edit/copy payloads remain unchanged. Existing messages work without
  migration.

- Regular and steered user messages render persisted attachments with the
  agent reply renderer, right-aligned above the bubble: images inline or in a
  gallery, other files as cards. Layout, URL reads, previews, and fallbacks follow
  [Agent reply rendering](#rendering).

## Agent Reply Attachments (OS-2091)

A running agent attaches local files to its own reply with `convoy threads
attach`. No task is involved. Command surface:
[cli-one-shot-commands.md](cli-one-shot-commands.md#threads-attach); prompt line:
[cli-thread-agents.md](cli-thread-agents.md#reply-attachment-delivery-os-2091).

### `cliMessages.attachToResponse`

- Args: `threadId`, `messageId`, `sessionId`, `attachments` (the input shape
  above), optional `check`, optional `apiKey`. Returns `{ messageId, storageIds }`.
- Authorizes like the other run mutations: thread owner, API-key project scope,
  live session claim on the thread, and the message claimed by that session.
- The message must be this thread's assistant reply, still `streaming`, and the
  thread's `activeAssistantMessageId`. Anything else fails with `Selected run is no
  longer active`. The explicit reply ID is what makes an old run's slow upload
  fail instead of landing on a newer run of the same thread.
- In one transaction: drop exact duplicates (same storage ID and metadata) within
  the batch and against files already attached; reject any remaining storage ID
  that is already attached or repeated, because no pending claim is left for it;
  check the cumulative 10-file cap and file names; spend pending claims and check
  stored sizes (`createAttachmentRefs`); append metadata in command order with
  `uploadedAt`, patching the reply once. Thread activity and chunk order are not
  touched.
- So a repeated call with the same batch is a no-op. Rerunning the CLI command is
  not: it uploads new blobs.
- Completion and failure keep the files. A batch arriving after completion fails.
- Optional `check` (`{ key, status, note?, label?, value?, artifactId? }`, OS-2291,
  OS-2385) also records a
  Check result on the thread's task in the same transaction, pointing at this
  call's files; the batch may then be empty. Returns `checkResultId`. Rules and
  errors: [task-checks.md](task-checks.md#reporting-agent-side).

### Lifecycle

- Deleting a reply releases its refs through `deleteMessageAttachmentRefs`
  (retry of a failed reply, edit-last rewind). A blob is deleted only when no
  other ref or attachment family still holds it.
- Branching copies the reply's metadata and inserts refs for the fork's copy, so
  deleting the source reply leaves the fork's files intact.
- Thread deletion stays a soft delete and keeps storage.

### Rendering

`ResponseAttachments` (`components/blocks/thread/response-attachments`) renders
after the reply text, above the Changes card and the run footer (stats and
actions). `AssistantCliMessage` hosts it for replies, mounting it from the
`attachments` array; user messages host it too (see
[Message Rendering](#message-rendering)). An attachment-only reply mounts `AssistantCliMessage` too,
with an empty render state, so text arriving later does not remount the files and
re-read their URLs:

- Order is preserved. Adjacent images form a group: one image renders inline
  (max 320px high); two or more form a gallery row of at most four thumbnails,
  wrapping on narrow screens. When more are hidden, a `+N` control over the fourth cell opens
  the first hidden image that can still preview, so the rest stay reachable even
  when the visible thumbnails fail. The `+N` cell's wrapper is a flex box: a
  block wrapper puts the thumbnail on a line box, and the row's stretch
  alignment would copy that descender gap under every image. Files and videos
  render as file cards and split image groups.
- Clicking a thumbnail opens that image in the attachment lightbox, which
  navigates every image and video of the reply.
- Clicking a text file card opens the
  [text preview](task-attachments.md#text-attachment-preview-os-2133); other
  file cards download.
- URLs come from a one-shot `getMessageAttachmentUrls` read keyed by message ID
  and ordered storage IDs: when an image reply enters the viewport, or on first
  click for a file-only reply. A new batch reads again; other envelope updates do
  not. Late results for an old key are ignored. Clicks waiting on a read keep it
  alive when a new batch lands, so they still open.
- A failed read is not cached as missing blobs. It shows one toast, and images
  fall back to file cards; the next click reads again. Nothing retries on its own.
- A file renders as a card: a file-type icon tile, the name, and the size,
  with no remove button.
- Skeletons hold image space while loading. A single image with `dimensions` holds
  its final box from the skeleton on: its own width capped at 320px of height and at
  the column width, at its aspect ratio, so the row does not resize when the image
  loads. Without `dimensions` the skeleton is 288×192px and the image takes its
  natural size once loaded. A missing blob renders an error
  card named after the file; an image that fails to load becomes a file card,
  or a tile of the same size inside a gallery.
- Images load lazily from the original upload; there is no thumbnail service.
- An attachment-only reply has no chunks. The live view and the fork prefix both
  show chunkless assistant envelopes that carry attachments (`rendersFromEnvelope`
  in `lib/threads/message-rows.ts`), under the same loaded-suffix rule as
  chunkless user messages, and "No output generated" is suppressed. The latest
  pending, streaming, or failed reply is listed once even when it also qualifies
  as its status row.
- Markdown export lists the reply's attachment names and sizes, as for users.
- An attachment with `display: "inline"` also renders as an expanded page above
  the attachments (see below).
- `threads messages` and MCP message summaries do not list reply attachments.

### Inline HTML (OS-2220)

`convoy threads attach page.html --inline` shows the page expanded at the end of
the reply: charts, comparison tables, small dashboards. The agent writes the page
on its machine, Convoy stores the file, and the viewer's browser renders it.
Agent-facing guide: `plugins/convoy/skills/convoy/references/inline-html.md`.

- **Explicit, never by MIME type.** An `.html` file without the flag stays a
  download card: evidence files (OS-2216) and exports are not meant to be read
  inline. The CLI rejects the flag on non-html files before uploading, and
  `assertValidMessageAttachments` rejects `display: "inline"` unless
  `contentType` is `text/html` (`Only html attachments can be shown inline`), for
  every write path. `display` is part of the dedupe identity in
  `attachToResponse`. Rows without the field read as before; no migration.
- **Reading.** Inline pages read URLs on entering the viewport, like images, then
  `fetch(url).text()` once per URL (Convex storage URLs allow it from the app
  origin, as the text preview already relies on). A failed fetch, URL read, or
  missing blob shows no frame; the file card remains.
- **Rendering** (`inline-html-attachment.tsx`). Inline pages render above the
  reply's other attachments, 16px below the reply text: a file-name caption,
  then `HtmlArtifactFrame` with `srcDoc`, full column width, transparent. The
  frame starts at 240px behind a skeleton. There is no download control on the
  page: each inline file also keeps its card in the attachment rows below, in
  attachment order, and that card is how the reader opens or downloads it.
- **Sandbox.** `allow-scripts allow-popups allow-popups-to-escape-sandbox`,
  never `allow-same-origin`: the page runs in an opaque origin with no app
  cookies, storage, or Convex access. Popups exist only so links open in a new
  tab.
- **Host head** (`useHostHeadHtml` in `html-artifact-frame.tsx`, shared with the
  html [text preview](task-attachments.md#text-attachment-preview-os-2133)). Inserted after the page's doctype (or at the start), so the page
  keeps standards mode and its own styles win:
  1. `@font-face` for self-hosted Inter at
     `<app origin>/fonts/inter-latin-v20.woff2`, the same file `next/font`
     ships. `next.config.ts` serves `/fonts/*` with
     `Access-Control-Allow-Origin: *` and an immutable cache, which an
     opaque-origin frame needs to load a font. No third-party font requests;
     self-hosted installs serve their own copy.
  2. `:root` with `color-scheme` copied from the app (a mismatch makes the
     browser paint the frame opaque), the theme tokens read from the app's
     computed styles, `--font-sans: "Inter", system-ui, sans-serif`, and a
     system `--font-mono` stack. The token list must match the guide's table.
  3. A base sheet: transparent `html`/`body`, `body { margin: 0; display:
     flow-root }`, `--foreground` text, 14px / 1.5.
  4. A script that posts `{ type: "convoy:inline-html:height", height }` (the
     root element's own height, not the viewport's) from a `ResizeObserver` and
     on `load`, and sets `target="_blank" rel="noopener"` on clicked links.
- **Height.** The parent accepts the message only when `event.source` is that
  frame's window, clamps it to 80–4000px, and sets the frame height.
- **Theme.** A `MutationObserver` on the root's `class` and `style` rebuilds the
  head; the new `srcDoc` reloads the page in the new theme.

## CLI-Originated Uploads

`convoy threads create --attach` and `convoy threads send --attach` (OS-1634)
are the only non-composer uploaders. Why the CLI has attachments when the MCP
surface does not is a transport constraint, not a scope cut: step 2 below is a
direct upload an MCP client cannot be instructed to perform, and the CLI has
filesystem access. Agents on the MCP surface share files by writing a path into
the prompt — both threads run on the same machine.

- Per file, in order: `generateMessageAttachmentUploadUrl` → `POST` the bytes to
  the signed URL → `registerPendingUploadedAttachment`. Metadata is then passed
  inline to `cliMessages.send` / `cliThreads.create`.
- **`deletePendingUploadedAttachment` runs in a `finally`, and registration is
  never skipped on the reasoning that a send follows immediately.** Cleanup is
  explicit-only — `crons.ts` has no pending-upload sweep — so an upload followed by
  a failed send would leak the blob with nothing to reclaim it. Discarding after a
  successful send is a no-op on storage: the mutation deletes bytes only when
  `storageId` has no `cliMessageAttachmentRefs`.
- Cleanup is settled per blob and never rethrown: one failing discard must not skip
  the others, and must not turn a committed send into a reported command failure.
- Per-file size cap of 50 MB, mirroring the server's `MAX_ATTACHMENT_SIZE`,
  checked before the bytes are read. The server enforces the same cap at
  registration ([task-attachments.md](task-attachments.md#size-limit-os-1676)).
- The project the three mutations authorize on is the **thread's own**
  (`cliThreads.getSummary.projectId`), never the CLI's resolved `--project`: a
  thread outside the configured default would otherwise fail or attach elsewhere.
- The composer's `useThreadMessageAttachmentUpload` is not reusable (it is React),
  and neither is `uploadTaskAttachmentFile` — it ends in `saveTaskAttachment`,
  which thread attachments have no equivalent of. Only the content-type map is
  shared, hoisted to `apps/cli/src/lib/content-type.ts`. Implementation:
  `apps/cli/src/lib/thread-attachments.ts`. Command surface:
  [cli-one-shot-commands.md](cli-one-shot-commands.md).

## CLI Attachment Handling

- CLI downloads attachment URLs to stable paths:
  - `~/.cache/convoy/thread-attachments/<threadId>/<storageId>__<sanitizedName>`
- Existing cached files are reused across continuation runs.
- Cache is not deleted per run.
- GC runs on connect startup and periodically; stale files older than 7 days are removed.

## Claude Execution Rules

- Non-image attachments are always included as local-path context in prompt text.
- Supported image attachments (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) are also passed via `stream-json` bootstrap input blocks with `source.type = "base64"` (`media_type` + base64 `data`).
- Unsupported image MIME types fall back to prompt path context.

## Other Runtime Execution Rules

- Runtimes without inline-image support (Codex, Cursor, OpenCode) include all
  attachments — images included — as local-path context lines in the run
  prompt (OS-1392).
