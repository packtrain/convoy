# Artifact Comments

This document specifies commenting on a selected range of a markdown Artifact's
content, shown in a collapsible panel beside the Artifact.

See [ADR 0005](../adr/0005-external-anchors-for-artifact-comments.md) for the
anchoring decision and `CONTEXT.md` for vocabulary (**Artifact comment**,
**Comment anchor**, **Detached comment**, **Comment reply**, **Resolve**).

## Overview

- A user selects text in a markdown Artifact and attaches a comment to that range.
- A user can also add a **general comment** with no anchor: a "+" button in the
  comments-rail header (left of the filter button) opens the composer with the
  input focused. General comments have no highlight and no quoted snippet.
- Comments appear in a collapsible right rail docked inside the Artifact panel.
- Commented ranges are highlighted in the content; clicking a highlight focuses
  its comment and vice versa.
- Comments are flat threads: a root comment with a flat list of replies.
- Comments can be resolved/un-resolved; resolved are dimmed and can be filtered out.
- Comments persist across content changes. When the anchored text disappears the
  comment detaches (kept, readable, un-highlighted) and re-attaches if the text returns.
- The selected snippet is copied into the comment so the referenced text stays
  visible even after the content changes.
- Scope: markdown Artifacts only. HTML Artifacts show no comment affordance in
  v1, and `create` rejects non-markdown artifacts server-side.
- Comment bodies are trimmed and must be non-empty; blank content is rejected
  by `create`/`reply`/`update` (guards CLI/MCP writers, not just the UI).
- AI-answering of comments is v2 (see Non-Goals).

## Data Model

New Convex table `artifactComments` (`convex/schema.ts`), keyed to an Artifact,
modeled on `taskComments` (`schema.ts:420`) but range-anchored and threaded.

- `artifactId: Id<"taskArtifacts">`
- `taskId: Id<"tasks">` — denormalized for project/permission resolution and indexing
- `parentId: Id<"artifactComments">` (optional) — absent = root; present = reply to a root
- `authorId: Id<"users">`
- `content: string`
- Anchor (root comments only, optional — absent for general comments; replies
  have no anchor):
  - `anchorText: string` — the selected snippet, copied verbatim at creation
  - `anchorPrefix: string` — ~40 chars of leading context
  - `anchorSuffix: string` — ~40 chars of trailing context
  - `startOffset: number`, `endOffset: number` — search hints, not authoritative
- `status: "open" | "resolved"` (root only)
- `createdAt`, `updatedAt`, `isEdited: boolean`
- Soft-ish: match `taskComments` behavior (hard delete); deleting a root cascades
  to replies. Deleting an Artifact (explicitly or via permanent task deletion)
  cascades to all of its comments.

Indexes:
- `by_artifact_and_createdAt` `[artifactId, createdAt]` — panel listing
- `by_parent_and_createdAt` `[parentId, createdAt]` — replies
- (offsets are not indexed; they are per-comment hints)

Backend module `convex/tasks/artifactComments.ts` with its entity folder
`convex/tasks/lib/artifactComments/` (`artifactCommentsRepo.ts`, `validators.ts`,
`anchor.ts`), paralleling `convex/tasks/comments.ts` + `tasks/lib/comments/`.

Functions (all with `returns` validators):
- `listByArtifact` query — paginated (`paginationOptsValidator` /
  `paginationResultValidator`), returns roots with reply counts + per-row
  `canEdit`/`canDelete`/`canResolve`, enriched with author name/avatar. Gate on
  Artifact/task view permission (`TASK_VIEW`).
- `listReplies` query (or fold into `listByArtifact` bootstrap) — replies for a root.
- `create` mutation — root (anchor fields optional — omitting both `anchor`
  and `anchorText` creates a general comment; a provided anchor must have
  non-blank text) or reply (with `parentId`). Requires `COMMENT_CREATE`.
- `update` mutation — author-only, sets `isEdited` (mirror `comments.ts:206`).
- `remove` mutation — author or `COMMENT_DELETE_ANY`; cascades replies for a root
  (mirror `comments.ts:235`).
- `setStatus` mutation — resolve/un-resolve a root. Allowed to any member with
  Artifact view access (per decision: any project member can resolve).

Reuse permission enums from `lib/authz/permissions.ts:52` (`COMMENT_CREATE`,
`COMMENT_UPDATE_OWN`, `COMMENT_DELETE_OWN`, `COMMENT_DELETE_ANY`) and helpers from
`convex/lib/access/permissions.ts`. No new permission keys in v1.

## Anchoring

Client-side, against the live `@mdxeditor/editor` (Lexical) instance in
`components/mdx-editor/editor.tsx` (used by `task-artifact-panel.tsx`).

- **Create**: from the current Lexical selection, capture `anchorText`, the
  ~40-char `anchorPrefix`/`anchorSuffix` from the surrounding text content, and
  the text-content offsets as `startOffset`/`endOffset`.
- **Place highlight**: find `anchorPrefix + anchorText + anchorSuffix` in the
  current text content, using `startOffset` as a search hint (search near it
  first, then fall back to a global search). The prefix/suffix disambiguate
  near-duplicate snippets. If not found → **Detached comment**.
- **Live remap**: on Lexical editor-state changes, recompute highlight positions.
  Highlights are a decoration/overlay layer, never persisted into the document
  (per ADR 0005) so autosave and MCP string edits stay clean.
- **Reload / agent rewrite**: re-run placement from stored anchor fields; comments
  naturally re-attach when their text is present and detach when it is not.

Known limitation (accepted v1): if prefix+snippet+suffix still matches multiple
locations after a large edit, placement may pick the wrong one.

## UI

- **Panel**: a collapsible right rail docked to the right edge of the Artifact
  panel (`components/blocks/tasks/task-artifact-panel.tsx`), between Artifact
  content and the task-details column. Integrates with the existing resize system
  in `task-sidebar-overlay.tsx` (`ARTIFACT_RESIZE_BOUNDS`, `SidebarResizeHandle`).
  When collapsed the panel is **fully hidden** (no strip) — a comment icon with a
  count badge in the artifact panel header toggles it open. Mobile: the same
  header toggle opens a full-width comments section stacked under the editor
  inside the existing artifact bottom `Drawer` (no resize handle). Compact
  artifact panel (thread-workspace sidebar): the rail floats over the editor's
  right edge as an overlay (no resize handle, capped at 85% of the panel) —
  a docked column would squeeze the editor to nothing in a narrow sidebar.
- **Add comment**: selecting text shows a floating "Comment" affordance near the
  selection; confirming opens the composer in the panel. A "+" button in the
  rail header (left of the filter button, hidden when the rail is read-only)
  opens the same composer for a general (non-anchored) comment with the input
  focused. The "+" and filter controls use the compact panel-header icon-button
  treatment (`icon-sm`: 28px target, 14px glyph). The pending block shows a
  "New comment" label instead of the quoted snippet. General comments never
  enter the Detached group and sort by creation time (after located threads in
  document order).
- **Comment card**: shows the **commented snippet as a quote** (a blockquote of
  the copied `anchorText`) above the comment body, so the referenced text is
  always visible — including when the comment is detached.
- **Highlights**: commented ranges get a highlight style in the content; the
  active comment's range is emphasized. Clicking a highlight scrolls/focuses its
  panel item; clicking a panel item scrolls/focuses its highlight. Overlapping
  ranges stack visually (darker where they overlap).
- **Thread**: root comment + flat replies + reply composer. Author gets edit;
  author/admin get delete (behind a confirmation dialog — deleting a root also
  deletes its replies). **Resolve/un-resolve is a root-only action** — replies
  have no resolve control. Mutation failures surface as error toasts; a failed
  composer submit keeps the draft. When the task is archived (panel disabled)
  the rail is fully read-only: no reply, resolve, edit, or delete controls.
- **Resolved**: dimmed inline and in panel; a panel filter can additionally hide
  resolved. Default filter shows all (resolved dimmed).
- **Sorting**: the panel's filter dropdown also selects the thread order —
  **Document order** (default; by the anchor's located position in the content,
  detached/unlocated fall back to creation time), **Newest first**, or **Oldest
  first**. The new-comment composer is inserted at the position matching the
  selected sort (top for newest-first, bottom for oldest-first, at its document
  position for document order), so a submitted comment stays where the composer
  was. The filter and sort choices persist per browser in localStorage
  (`task-artifact-comment-prefs`) together with the rail's open/closed state
  (`isOpen` — toggling the rail, activating a comment, or starting a new
  comment updates it), as does the panel width
  (`task-artifact-comments-width`).
- **Detached**: shown in the panel (e.g. a "Detached" group) with the copied
  snippet visible, no highlight, still replyable/resolvable/deletable.

### Send open comments to a thread

A send button in the comments-rail header (next to the filter) hands the open
comments to a CLI thread so an agent can address them. It is visible only when
the rail has at least one open (unresolved) root and the panel is not
read-only. The dropdown offers three destinations:

1. **Task threads** — up to 5 unarchived threads already associated with the
   task (`api.cli.threads.lists.listByAssociatedTask`), newest activity first.
2. **New thread** — the threads workspace with the task pre-attached
   (`?attachedTask=<taskRef>`, same as the task header's thread link).
3. **Search threads…** — a cmdk picker over all project threads
   (`components/blocks/thread/thread-picker-dialog.tsx`). Its result list fills
   the dialog's available height and scrolls internally; it does not inherit
   the shared command list's compact maximum height. Result and pagination rows
   omit the command item's selection indicator because activating either
   navigates or loads more rather than selecting persistent state. **Containers
   — groups, including workflow-run ones — are filtered out** (OS-1716): `listByProject` pages
   the roots and a container is one, but it has no composer of its own — its
   URL redirects to a child tab — so picking one seeded a draft key nothing
   reads and the message silently vanished. Because that filter is per loaded
   page, the empty state waits for the last page: a page of only containers
   still offers "Load more".

Existing-thread destinations in both the recent list and search results reuse
the shared compact thread-row content, including task context, status/unread
state, agent, runtime, and relative activity time.

All three seed the destination composer through the thread-draft store and then
go to the thread, leaving the user free to edit before sending. **A mounted
`ThreadDraftProvider` owns the seed** (`seedDraft`, OS-1716): it merges the new
text into the *live* in-memory row, so text the user typed a moment earlier —
still inside the provider's 200 ms persist debounce, not yet in storage — is
kept rather than overwritten. Only hosts with no provider (the task and artifact
routes) seed through storage directly
(`lib/threads/artifact-comments-handoff.ts`), where the provider's mount-time
read picks it up after navigation. Going through storage while a provider is
mounted cannot work: two writers holding different fields of the same row and
reconciling by whole-row timestamp lose one side's edit either way.

Because the composer does not remount for the same thread either, the seed is
also pushed into the live editor: `seedDraft` bumps the draft's `seedCount`, and
the composer applies the text once per change (`ThreadComposerSeedSync`), so
typing after a seed is never reverted and re-sending identical text still
re-seeds. The new-thread composer folds `seedCount` into its `draftScopeKey`
instead, remounting the editor it seeds on mount only.

**Sending keeps the open artifact open.** Which sidebar holds it is URL state —
`?artifact=` when the task detail sidebar hosts it (the task tab), or
`?threadArtifact=` for the workspace's own artifact tab — so a bare push of the
thread route dropped the param and closed the artifact as the send navigated.
That was the whole of the reported symptom: "clicking Send → Thread just closes
the artifact." A push that stays within the threads route therefore carries the
current query string over; arriving from another page (task detail, board) leaves
that page's query behind, since it does not describe the thread route. The
new-thread destination carries it too, minus `?threadArtifact=` — that tab
belongs to a thread, and there is no thread yet.

Inside the thread workspace the host's own tab switch runs instead
(`onNavigateToThread` → `navigateToThreadTab`), which likewise preserves the
query and additionally selects the tab when the destination is a group sibling —
siblings share the workspace's active-thread state, so a route push alone would
not switch tabs. Both artifact hosts reach it: the workspace's artifact tab
directly, and the task tab through `ThreadTaskPane` → `TaskDetailSidebar`. The seed is
an **upsert**: a previously seeded block for the same artifact (matched header
through footer, tolerating a renamed artifact) is replaced instead of stacked,
so re-sending is idempotent; the user's own draft text is kept and the block
is appended after a blank line. Seeding also clears the draft's stored
`composerContent` so the new text is what the composer renders. The composer
preserves the message's line structure — plain-text drafts are converted to a
paragraph-per-line Tiptap doc (`plainTextToDoc` in
`prompt-input-tiptap-textarea.tsx`) instead of being parsed as HTML, which
would collapse newlines — and the composer forces uniform paragraph styling
(`!text-sm !leading-6 !mt-0`) so seeded lines render textarea-like instead of
inheriting the tiptap template's 1rem/20px-margin paragraphs.

The composed message is plain editable text: a header naming the artifact
(name + artifactId), then one block per open comment, followed by a footer
telling the agent to resolve addressed comments via
`set_artifact_comment_status` (MCP) or `convoy tasks artifacts comments
resolve` (CLI). Each block leads with `# `-prefixed technical metadata and the
`> `-quoted anchor snippet, then the unquoted comment body:

```
# comment id: <id>          ← the id an agent needs to resolve the comment
# lines: <start>-<end>      ← 1-based lines of the artifact `content` string
                              (as returned by get_task_artifact / `convoy
                              tasks artifacts get`); a single line renders as
                              just "<n>"; omitted when the snippet can't be
                              located in the source (locateAnchorLines)
> <anchor snippet lines>    ← omitted for anchor-less comments
<comment body>
Reply: <reply>              ← one line per reply, if any
```

Resolved comments are never included, regardless of the rail's filter state.

Frontend hook `lib/tasks/hooks/comments/use-artifact-comments.ts` paralleling
`use-task-comments.ts` (`usePaginatedQuery`, `PAGE_SIZE`, create/update/delete +
`setStatus`). Components under
`components/blocks/tasks/artifact-comments/` paralleling the existing
`components/blocks/tasks/comments/` set. Real-time via Convex live queries (no
optimistic layer required for v1, matching task comments).

## Agent Access (MCP + CLI)

Agents read, write, reply to, and resolve artifact comments through MCP tools
(`list_artifact_comments`, `create_artifact_comment`,
`reply_to_artifact_comment`, `set_artifact_comment_status`, and
`get_task_artifact` with `includeComments`) — contracts in
`docs/specs/mcp-server.md`. The `convoy` CLI mirrors them under
`convoy tasks artifacts comments list|add|reply|resolve|unresolve` and
`convoy tasks artifacts get --comments [--comments-status]`.

- The backend functions (`listByArtifact`, `create`, `reply`, `setStatus`)
  accept an optional `apiKey`; agent-created comments are authored as the API
  key's owner. `update`/`remove` remain web-only.
- Agents provide a bare `anchorText` (+ optional 1-based `occurrence`); the
  server derives prefix/suffix context and offset hints from the artifact's
  markdown source. Web anchors are captured from rendered text instead — for
  snippets containing markdown syntax the context candidate may not match the
  rendered document, but the bare-text fallback in the anchor ladder still
  re-attaches plain snippets.
- `setStatus` takes a batch of root comment ids (1–100) and is atomic.

## Non-Goals (v1)

- AI answering a comment (v2). Leave a seam: `setStatus`/reply plumbing and an
  author/attribution field able to represent an agent later.
- HTML Artifact comments.
- Nested replies (replies-to-replies).
- Comment-level (non-artifact) or cross-artifact comments.
- Comment activity in task history / notifications (revisit after v1).

## Manual Verification

1. Open a task with a markdown Artifact; select text → "Comment" appears →
   create a comment. Highlight shows; panel item appears; snippet is copied in.
2. Reply to the comment; confirm flat replies and reply count.
3. Edit the Artifact around the comment (type before it) → highlight tracks the
   text live via autosave.
4. Delete the anchored text → comment detaches (kept, shows snippet, no
   highlight). Re-type the exact text → it re-attaches.
5. Create two comments on identical snippets in different paragraphs; edit
   heavily → confirm context keeps each on its own occurrence.
6. Resolve a comment → dimmed; toggle the filter → hidden; un-resolve → back.
7. As a non-author member: can resolve/un-resolve; cannot edit; cannot delete
   others'. As admin: can delete others'.
8. Trigger an agent `replace_in_task_artifact` that removes commented text →
   comment detaches without being lost.
9. Click the "+" in the rail header → composer opens focused, no quoted
   snippet → submit → a general comment appears with no highlight and no
   quote; it never shows in the Detached group.

Backend unit tests (`pnpm web:test:once`) for `artifactComments`: create
root/reply, list pagination, update (author-only), delete cascade, `setStatus`
permissions, and anchor fields round-trip.
