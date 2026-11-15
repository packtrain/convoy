# Task Attachments Specification

This document defines the canonical naming and API contracts for task-level file attachments and task comment file attachments.

Note: markdown task documents are modeled separately as task artifacts (see `docs/specs/task-artifacts.md`), not as attachments.

## Canonical Data Model

### Task Attachments Table

```typescript
taskAttachments: {
  taskId: Id<"tasks">;
  storageId: Id<"_storage">;
  fileName: string;
  fileSize: number;
  contentType: string;
  uploadedBy: Id<"users">;
  uploadedAt: number;
}
```

Indexes:
- `by_task` on `taskId`
- `by_storageId` on `storageId`

### Task Comment Attachments Table

```typescript
taskCommentAttachments: {
  commentId: Id<"taskComments">;
  storageId: Id<"_storage">;
  fileName: string;
  fileSize: number;
  contentType: string;
  uploadedBy: Id<"users">;
  uploadedAt: number;
}
```

Indexes:
- `by_comment` on `commentId`
- `by_storageId` on `storageId`

## Convex API Namespaces

- `tasks.attachments` (module: `apps/web/convex/tasks/attachments.ts`)
- `tasks.comments` attachment functions in `apps/web/convex/tasks/comments.ts`

## Task Attachment Endpoints

- `tasks.attachments.generateTaskAttachmentUploadUrl`
- `tasks.attachments.registerPendingUploadedAttachment`
- `tasks.attachments.saveTaskAttachment`
- `tasks.attachments.listTaskAttachmentsByTask`
- `tasks.attachments.moveTaskAttachment`
- `tasks.attachments.deleteTaskAttachment`

All six accept optional `apiKey` auth for CLI/API-key callers. Browser-auth
callers continue to omit `apiKey`. Save, move, and delete operations require
`TASK_UPDATE`; list requires `TASK_VIEW`. Generate and register require only
authentication.

## Storage Ownership (OS-1901)

A Convex storage id is a bearer token: nothing in `_storage` records who uploaded
it. Without an ownership record, any authenticated caller who learned another
tenant's storage id could resolve its URL, attach it to their own task, and
delete it. `taskAttachmentPendingUploads` (`userId`, `storageId`, `createdAt`;
index `by_storageId`) is that record. The row is the proof of ownership, and it
is spent when the blob is attached. Mirrors `cliMessagePendingUploads`
(`cli-message-attachments.md`), but user-scoped: task uploads are generated
without a project.

The blob is shared across both families, so every ownership and deletion
decision reads every table that points at `_storage`. That lives in one place,
`convex/lib/storageRepo.ts`: `isStorageReferenced` (`taskAttachments`,
`taskCommentAttachments`, `cliMessageAttachmentRefs`), `isStorageClaimed` (those
plus both pending tables), and `deleteStorageIfUnreferenced`. Both families keep
their own pending table and mutations and call these checks.

Upload flow, per file: `generateTaskAttachmentUploadUrl` (or the comment
variant) → `POST` the bytes → `registerPendingUploadedAttachment({ storageId })`
→ `saveTaskAttachment` / `tasks.comments.createWithAttachments`.

- **Register** resolves the URL first; a missing blob returns `null` and inserts
  nothing, so a deleted id can never carry a claim. If the caller already owns a
  row it returns the URL and changes nothing. Otherwise it returns `null` when
  `isStorageClaimed` is true, that is when any attachment record or any pending
  row in either family points at the id. Only an id nobody has touched gets a
  row. "No pending row" never means "unowned": a saved attachment, a legacy
  attachment without a row, and a thread attachment are all refused. The refusal
  is the same answer as a missing blob, so ownership stays opaque.
- **Claim** (`saveTaskAttachment`, `createWithAttachments`): the caller must own
  a pending row for every `storageId`, else `Upload not found. Register the
  upload before attaching it`. The claimed `fileSize` must equal the stored
  blob's size, else `Attachment fileSize does not match the uploaded file`.
  The claim deletes the row, so a blob is attached
  once and cannot be re-registered by anyone, its uploader included. Attaching
  a second time re-uploads.
- **Cleanup** (`tasks.comments.deletePendingUploadedAttachment`): a no-op unless
  the caller owns a pending row. Runs `deleteStorageIfUnreferenced`, then deletes
  the caller's row. Ownership-scoped, so `taskId` is retained only for the
  existing task/permission checks.
- **Delete** (`deleteTaskAttachment`, `tasks.comments.remove`,
  `deleteTaskCommentAttachment`, `tasks.core.permanentlyDelete`): the row goes
  first, then `deleteStorageIfUnreferenced`. The claim rule makes a shared blob
  rare (legacy rows or a direct insert), but the guard keeps a delete from ever
  reaching another record's file, including a thread message's.
- **Inline description images** register to obtain the URL and never claim, so
  their row is never spent. Kept on purpose: dropping it would leave the blob
  unowned, and the owner is the only one who may later discard it through
  cleanup. The table grows by one row per inline image; no cron sweep. Revisit if
  it matters.
- **Registration happens in the upload queue** (`useStorageUploadQueue`'s
  `registerUpload` option), right after the `POST` resolves and before the
  abandon check. An upload removed while the `POST` is in flight is therefore
  registered and then cleaned up; an unregistered blob would have no owner able
  to delete it.

Rollout: `saveTaskAttachment` rejects unregistered ids from the moment this
deploys. Publish the CLI first (patch bump, see `publishing-the-cli.md`), then
deploy Convex. CLI versions published before the register step cannot upload
task attachments until they update. There is no grace rule for unregistered ids;
one would reopen the hole.

## Size Limit (OS-1676)

One per-file cap, `MAX_ATTACHMENT_SIZE` (50 MB) in `convex/lib/constants.ts`,
covers task, comment, and thread attachments. The web upload queue imports the
same constant; the CLI mirrors it in `apps/cli/src/lib/storage-upload.ts`.

- **Register** (both families) reads the real size from the `_storage` system
  table, after the ownership checks. An unclaimed blob over the cap is deleted
  and the call returns `null`, like any refusal. It does not throw: a throw
  would roll back the delete, and an unregistered blob has no owner to clean it
  up. The later attach then fails with `Upload not found`.
- **Claim** rejects a `fileSize` that differs from the stored size, so recorded
  metadata always matches the bytes. A blob that is gone by then reports
  `Upload not found`. `cli.messages.editLastResend` runs the same check on
  attachments it keeps, since it rewrites their metadata from the caller.
- After a rejected claim the blob stays registered, and the caller's cleanup
  deletes it: the web queue on remove, `threads --attach` in a `finally`, and
  `tasks attach` on a failed save via `tasks.comments.deletePendingUploadedAttachment`,
  which accepts `apiKey`.
- Clients check the cap before uploading, so honest callers never reach either
  server check. The client check exists to avoid reading and sending the
  bytes; the server checks are the trust boundary.
- There is no per-message total. Ten files at the cap is 500 MB.
- A caller can still `POST` bytes to an upload URL and never register them.
  Nothing records or sweeps such a blob. Convex sets no size limit on upload
  URLs, only a 2-minute timeout on the `POST`
  ([docs](https://docs.convex.dev/file-storage/upload-files)).

## File name validation (OS-1902)

`fileName` is stored as sent, so every save path checks it is a single path
segment with `isSafeFileName` (`convex/lib/shared/strings.ts`) and rejects with
`Attachment file name must be a plain file name without path separators or
control characters`. Rejected: empty, `.`, `..`, any `/` or `\`, control
characters (0x00-0x1f, 0x7f), more than 255 characters. Applies to
`tasks.attachments.saveTaskAttachment`, `tasks.comments.createWithAttachments`
and `cli.messages.send` attachments. Browsers send `File.name` (always a
basename) and the CLI sends `path.basename`, so well-behaved clients never hit
it. The CLI download command also reduces the name to a safe basename on its
side, so old rows are covered too (see `cli-one-shot-commands.md`).

## Moving Attachments Between Tasks (OS-1711)

`moveTaskAttachment({ attachmentId, taskId })` re-owns an attachment. Move, not
copy: it leaves the source task.

- Same project only; a target in another project is rejected with `Tasks must be
  in the same project`. `TASK_UPDATE` is project-scoped, so the source check
  covers the target.
- No-op when the attachment already belongs to the target task.
- The stored file never moves — only `taskAttachments.taskId` is patched, so
  `storageId` and the download URL are unchanged.
- `fileName` is **not** rewritten: attachments have no per-task name uniqueness
  (only a `by_task` index), so a name already used on the target is fine. This is
  the main way the move is cheaper than the artifact one, which must reallocate
  `fileName` and re-anchor comments (see `task-artifacts.md`).
- Both tasks' `attachmentCount` are adjusted (source clamped at zero) without
  bumping `updatedAt`.
- Activity: `attachment_removed` on the source, `attachment_added` on the target.
- `uploadedAt`/`uploadedBy` are left alone: they record the upload, which did not
  happen again. (The artifact move does stamp `updatedAt`, because a document's
  owner changing is an edit to the document.)
- Archived targets are not rejected, matching `saveTaskAttachment` and the
  artifact paths — see the same note in `task-artifacts.md`; OS-1763 decides it.
- Exposed on the web (drag and drop) and the CLI. **Not** exposed via MCP:
  attachments have no MCP mutations at all, so a move-only tool would be the
  odd one out.

## Denormalized Resource Counts (OS-882)

Tasks carry denormalized `tasks.attachmentCount` and `tasks.artifactCount`
fields (`v.optional(v.number())`; absent on legacy rows) so the task list can
show a resource indicator without reading `taskAttachments`/`taskArtifacts`
rows on the hot `tasks.core.listByProject` path.

Maintenance rules:

- `saveTaskAttachment` / `createTaskArtifact` increment the respective counter
  after inserting the row.
- `deleteTaskAttachment` / `deleteTaskArtifact` decrement it, clamped at zero
  for defensive cleanup/retry paths.
- Counter patches use `patchTask(..., { bumpUpdatedAt: false })` and must NOT
  bump the task's `updatedAt` — attachment/artifact changes are already
  recorded via activity logs.
- `tasks.core.duplicate` does not copy attachments or artifacts, so copies
  start at 0.
- `tasks.core.permanentlyDelete` needs no counter maintenance (the task doc is
  deleted in the same mutation).
- Comment attachments (`taskCommentAttachments`) do NOT count toward either.

Read contract:

- `taskReturnValidator` exposes non-optional `attachmentCount: v.number()` and
  `artifactCount: v.number()`; the enrichment mapper normalizes missing values
  with `?? 0`.
- The task table renders a paperclip icon plus the total resource count
  (`attachmentCount + artifactCount`) after the task title when the total is
  greater than zero — no per-row resource metadata or signed URLs.
- Visibility is controlled per project by `projects.showArtifactsCount`
  (`v.optional(v.boolean())`; absent means shown), toggled in Project Settings →
  General ("Show resource count in task list"). Counts are always maintained on
  the backend regardless of this setting — it only hides the indicator.
- The sidebar/details view keeps using `listTaskAttachmentsByTask` /
  `listTaskArtifactsByTask` for full metadata and URLs.

Backfill: the idempotent `backfillTaskResourceCounts` migration
(`convex/migrations.ts`, included in `runAll`) recomputes both counts from the
`by_task` / `by_task_and_updatedAt` indexes for legacy/drifted rows.

## Task Sidebar Attachment UX

- Clicking an image task attachment (`contentType` starts with `image/` and `url` is not null) opens a lightbox preview.
- Clicking a video task attachment (`contentType` starts with `video/` and `url` is not null) opens the same lightbox preview with native playback controls; the video autoplays inline.
- The image preview supports zoom interactions via a library-backed lightbox.
- The preview supports finite gallery navigation between all previewable task attachments (images and videos), opening on the clicked attachment.
- The header pill shows the slide position as `X/N` before the file name, so the viewer knows where they are in the gallery. Every host of the lightbox gets it.
- The slide reserves a 64px top band for that pill, so the picture scales to fit below it instead of being covered.
- Gallery navigation uses a shortened slide transition so moving between slides feels immediate.
- Clicking a text task attachment opens the [text preview](#text-attachment-preview-os-2133).
- Clicking a non-previewable task attachment still opens a confirmation dialog first.
- The dialog explains that preview is not available and asks whether to download.
- Download starts only after explicit user confirmation.
- Attachment pills are drag sources on the same terms as artifact pills: dragging one onto a task row moves the attachment to that task (OS-1711). See [Resource Drops Into Rows](task-table-drag-and-drop.md#resource-drops-into-rows-os-1711).
- When a task sidebar is open, pasting clipboard image files in the sidebar fallback area uploads them as task attachments.
- The sidebar fallback must not intercept paste events owned by the task description editor or task comment composer.

## Task Comment Attachment Endpoints

- `tasks.comments.generateTaskCommentAttachmentUploadUrl`
- `tasks.comments.createWithAttachments`
- `tasks.comments.deletePendingUploadedAttachment`
- `tasks.comments.deleteTaskCommentAttachment`

## Task Comment Attachment UX

- Comment attachments upload immediately when users add/paste/drop files in the composer.
- The final comment is created with attachments atomically after uploads complete.
- If a pending upload fails, comment submit remains blocked until failure is resolved.
- Each upload is registered with `tasks.attachments.registerPendingUploadedAttachment` as it completes; see [Storage Ownership](#storage-ownership-os-1901).
- Uploaded-but-unsent comment files are removed with best-effort cleanup when discarded.
- Pending-upload cleanup deletes only the caller's own registered uploads, and only storage objects no `taskAttachments` or `taskCommentAttachments` record references.
- Clicking an image comment attachment (`contentType` starts with `image/` and `url` is not null) opens the same lightbox preview used for task attachments.
- Clicking a video comment attachment (`contentType` starts with `video/` and `url` is not null) opens the same lightbox preview with native playback controls.
- The preview supports finite gallery navigation between all previewable comment attachments (images and videos), opening on the clicked attachment.
- Gallery navigation uses the same shortened slide transition as task attachment previews.
- Clicking a text comment attachment opens the [text preview](#text-attachment-preview-os-2133).
- Clicking a non-previewable comment attachment still downloads it directly.

## Text Attachment Preview (OS-2133)

Every surface that opens attachments through `useAttachmentPreview` previews text
files: task attachments, comment attachments, sent thread-message attachments,
and agent reply attachments.

- A file is text when its `contentType` starts with `text/`, `application/json`,
  or `application/xml`, its URL is resolved, and its size is at most 1 MB.
  Larger text files, and files of unknown size, take the surface's
  non-previewable path (download, or the task sidebar's confirm dialog).
- Clicking one opens a dialog titled with the file name. The file is fetched
  once when the dialog opens. A skeleton shows while it loads.
- `text/markdown` (and `text/x-markdown`) renders as markdown with the thread's
  message renderer, with the same Preview / Source toggle as html. Anything
  else shows as wrapped monospace text.
- `text/html` opens as a rendered page, with a Preview / Source toggle (eye and
  code icons, labelled for screen readers) at the footer's left (Preview by default; Source is the monospace text). The page
  renders in `HtmlArtifactFrame` (opaque origin, links open a new tab) with the
  [inline html host head](cli-message-attachments.md#inline-html-os-2220), so
  pages written against the theme tokens look the same as inline. The frame is
  65vh tall and scrolls inside.
- The footer has Close and Download; Download runs the surface's normal download.
- A failed fetch says the preview couldn't load and keeps the Download button.
- Text files are not lightbox slides: image and video gallery navigation skips
  them.
- Composer pills preview text too (see
  [cli-message-attachments](cli-message-attachments.md)); `#` attachment
  references stay image-only.
- Content type comes from the uploader. The CLI maps extensions in
  `apps/cli/src/lib/content-type.ts`, so `.log`, `.yaml`, `.diff`, `.py`, `.sh`, and
  `.ts` files arrive as text. Files uploaded as `application/octet-stream` before
  that mapping still download.

## Naming Rules

- Use `taskAttachments` for task-level file records.
- Use `taskCommentAttachments` for comment-level file records.
- Avoid legacy names (`attachments`, `commentAttachments`) in new code.
