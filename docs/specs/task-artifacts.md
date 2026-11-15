# Task Artifacts Specification

This document defines the canonical model and UX for task-level document artifacts.

## Overview

Artifacts are documents associated with a task, either markdown (editable in-app) or html (render-only in-app). They are intended for:
- Agent-produced outputs (plans, reviews, implementation summaries, html reports/previews)
- User-authored notes/docs in the task sidebar
- User-uploaded markdown and html files

Artifacts are separate from binary task attachments.

Artifact create/delete maintain the denormalized `tasks.artifactCount` used by
the task-list resource indicator — see "Denormalized Resource Counts (OS-882)"
in `docs/specs/task-attachments.md`.

## Canonical Data Model

### Task Artifacts Table

```typescript
taskArtifacts: {
  taskId: Id<"tasks">;
  name: string;
  fileName: string; // generated, unique per task, extension follows contentType (.md / .html)
  content: string; // markdown or html source
  contentType?: "markdown" | "html"; // absent on legacy rows = markdown; immutable after create
  source: "user" | "agent";
  runId?: string; // optional provenance from agent run
  createdBy: Id<"users">;
  updatedBy: Id<"users">;
  createdAt: number;
  updatedAt: number;
}
```

Indexes:
- `by_task_and_updatedAt` on `taskId`, `updatedAt`
- `by_task_and_fileName` on `taskId`, `fileName`

## Naming Rules

- `name` is user-visible title.
- `fileName` is generated from `name` with an extension derived from `contentType` (`.md` for markdown, `.html` for html).
- `fileName` is unique within a task.
- On collisions, suffixes are added: `plan.md`, `plan-2.md`, `plan-3.md`, etc. (same for `.html`).
- `contentType` is immutable after creation; renames keep the original extension. Switching type means creating a new artifact.

## Permissions

Task artifacts use task permission parity:
- Read/list: `ProjectPermission.TASK_VIEW`
- Create/update/delete: `ProjectPermission.TASK_UPDATE`

## Convex API Namespace

- Module: `apps/web/convex/tasks/artifacts.ts`
- Namespace: `tasks.artifacts`

Endpoints:
- `tasks.artifacts.listTaskArtifactsByTask`
- `tasks.artifacts.getTaskArtifact`
- `tasks.artifacts.getTaskArtifactSafe` (string-safe lookup for URL state)
- `tasks.artifacts.createTaskArtifact`
- `tasks.artifacts.updateTaskArtifact`
- `tasks.artifacts.moveTaskArtifact`
- `tasks.artifacts.deleteTaskArtifact`

## Moving Artifacts Between Tasks

An artifact can move to another task in the **same project** (OS-1711). Move, not
copy: the artifact leaves the source task.

- `moveTaskArtifact({ artifactId, taskId })` requires `TASK_UPDATE`. That
  permission is project-scoped, so the source check also covers the target.
- A target task in another project is rejected (`Tasks must be in the same
  project`) — comments carry a task-scoped permission anchor.
- The move is a no-op when the artifact already belongs to the target task.
- `fileName` is unique per task, so the move reallocates it against the target's
  filenames using the same collision suffixes as create (`plan.md` →
  `plan-2.md`). `name` never changes.
- Every comment on the artifact has its denormalized `taskId` re-anchored to the
  target task, so comment permissions resolve against the new owner.
- Both tasks' `artifactCount` are adjusted (source clamped at zero) without
  bumping `updatedAt`.
- Activity: `artifact_removed` on the source task, `artifact_added` on the
  target. The trail reads as delete-then-create; that is deliberate for v1 —
  reusing the existing events avoids new activity types.
- The artifact's `updatedAt`/`updatedBy` are stamped, because its owner changed.
  An attachment move leaves `uploadedAt`/`uploadedBy` alone: those record the
  upload, which did not happen again.
- **Archived tasks are not gated.** The target is checked for `isDeleted` only,
  matching `createTaskArtifact` / `saveTaskAttachment` — archiving is enforced in
  the UI, not the backend. So a resource cannot be dragged *out* of an archived
  task but can be moved *into* one via drag, CLI, or MCP. Left consistent with
  the other write paths on purpose; OS-1763 decides the invariant for all three.

## Task Sidebar Behavior

- Artifacts are listed in task details.
- Clicking an artifact selects/highlights it and opens an artifact panel.
- Artifact panel appears to the left of the existing task sidebar content and uses full sidebar height.
- In narrow hosts that cannot grow (the thread-workspace sidebar), the artifact panel opens in **compact mode** instead: it fills the sidebar width, covers the task details (which stay mounted and return when the artifact closes), and the comments rail floats over the editor's right edge (see `docs/specs/artifact-comments.md`). No horizontal scrolling is introduced.
- On mobile, task details render in a full-viewport right drawer; selecting an artifact opens a second bottom drawer above the task details drawer.
- Mobile artifact drawer dismissal clears only `artifact` and keeps the current task details drawer open.
- On constrained desktop widths, the artifact panel shrinks before the task details panel so the combined overlay remains inside the main content area.
- If a previously saved wide details-sidebar width would collapse artifact visibility, the details sidebar is capped while artifact is open so the artifact panel remains visibly usable.
- Desktop resize behavior is CSS-driven (not JS-throttled measurement in page render state) so browser window resizing remains smooth while preserving the same width constraints.
- While an artifact is open there are two resize handles: the artifact panel's left edge resizes the artifact panel, and the artifact/details boundary resizes the task details panel. Drags show a guide line and apply on mouse up; see `docs/specs/task-sidebar-resizing.md`.
- The artifact panel must not clip behind the app sidebar while selected.
- Opening behavior for markdown artifacts is editor-first using the shared MDX editor surface in `apps/web/components/mdx-editor/`.
- Markdown artifact editor surfaces opt into the shared editor's spacious content padding so full-size artifact documents have room around rendered content without changing compact editor defaults elsewhere.
- Markdown artifact content defaults to a narrow, centered readable measure (shared editor `contentWidth="narrow"`, capped at 60rem). A header toggle button switches between narrow and full width; it applies to rich-text mode only (raw markdown source mode stays full width), persists in `localStorage` across artifacts and sessions, and is hidden for html artifacts.
- Html artifacts are render-only in-app: the panel renders the content in a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`, via `srcDoc`) instead of the editor. Content edits happen via MCP/CLI; the name remains renamable in the panel header.
- All artifacts show an "Open full page" button in the panel header that opens `/o/<orgSlug>/<projectAlias>/artifacts/<artifactId>` in a new tab. That page reuses the artifact panel in a full-page mode: html renders in a full-height sandboxed iframe; markdown is editable with the same rename + autosave behavior as the panel (shared `useArtifactAutosave` hook), including the comments rail toggle and the "Download artifact" button. Invalid/inaccessible IDs show a not-found state. If the owning task is archived (or its state is still loading), the full page stays read-only, matching the panel's archived-task behavior.
- In full-page mode the header's "Open full page" and close buttons are replaced by a "Back to task" button (in the same header position) that navigates to the artifact opened over the task details sidebar on the project view — `/o/<orgSlug>/<projectAlias>?task=<taskRef>&artifact=<artifactId>` (plus `archived=true` for archived tasks). The button is hidden until the owning task has loaded. The full page never wraps in the mobile drawer; it is its own viewport.
- All artifacts show a "Download artifact" button in the panel header. It downloads the currently loaded source using the artifact's canonical filename (`.md` for Markdown, `.html` for HTML), including in compact, mobile, and read-only panels.
- On the full-page artifact route, the owning project stays highlighted as active in the app sidebar (the route resolves to the `artifacts` project section in sidebar route state, like `threads`).
- Raw artifact html is never served on the app origin; rendering always goes through the sandboxed iframe.
- There is no dedicated document upload control. Markdown and html files go through the normal Resources attach/drop flow: when an attached or dropped file matches `.md`, `.html`, or `.htm` (case-insensitive), it becomes an artifact instead of a binary attachment. The file is read client-side, checked against the content cap, and created with the matching `contentType`; the artifact name derives from the file name. Other files in the same drop become attachments as usual. Agent-created and user-uploaded artifacts render identically.
- The artifact pill badge shows `md` or `html` based on `contentType`.
- Artifact markdown opens in rich-text mode after shared editor import normalization, so prose placeholders such as `<project role>` and prose command names such as `web:lint` display as literal text and do not crash MDX/JSX or directive parsing.
- Artifact fenced code blocks remain visible and editable as code blocks; unsupported or unlabeled no-metadata fences fall back to plain-text code-block editing instead of blocking rich-text mode.
- When artifact content grows, the artifact editor toolbar remains pinned to the top of the artifact editor scroll region while the document body scrolls underneath it.
- Markdown artifact surfaces (panel and full page, including read-only states) enable the shared editor's inline table of contents wired to the artifact scroll container; it supports the shared pin/unpin sidebar behavior, and heading navigation stays interactive even when editing is disabled.
- Artifact editing supports autosave and flushes pending edits when the panel closes.
- The autosave status does not show `Saving...` during the debounce window; it appears only once the save request starts, then transitions to `Saved` on success.
- Task artifacts use rich-text and source modes in the sidebar; diff mode is not exposed there.
- Archived tasks render the same artifact panel in read-only mode. The resource pill stays clickable so the panel is reachable; archiving gates only mutations (attach, create, rename, edit, delete), never opening.
- The artifact pill is a real link to the full page route (`/o/<orgSlug>/<projectAlias>/artifacts/<artifactId>`), so middle-click, ⌘/ctrl-click and "copy link address" get native browser behavior; a plain left click opens the sidebar panel instead of navigating. Its right-click context menu (long-press on touch) offers "Open in new page" and "Copy ID" (the artifact document ID). Hosts without project route params fall back to a non-link pill with no context menu.
- Deleting an artifact from the resource list requires confirmation.
- Artifact pills are drag sources: dragging one onto a task row (project table
  or the detail sidebar's subtasks table) moves the artifact to that task
  (OS-1711). Attachment pills work the same way. Archived tasks (`disabled`) and
  hosts without project/task context render non-draggable pills. Moving is
  desktop-only — see [Resource Drops Into
  Rows](task-table-drag-and-drop.md#resource-drops-into-rows-os-1711).

## URL Deep-Linking

- Query key: `artifact`
- Value: artifact document ID (stable across rename)
- Example: `?task=ABC-42&artifact=<artifactId>`

Rules:
- Selecting an artifact updates `artifact` in URL.
- Clearing/closing artifact panel removes `artifact` but keeps `task`.
- Changing task clears stale artifact selection.
- Invalid/inaccessible artifact IDs are self-corrected by clearing `artifact`.
- Opening/closing task details from task-row interactions updates `task` via push navigation so browser Back/Forward traverses prior task selections.

The thread route has a second, **host-level** key for the same panel:
- Query key: `threadArtifact` — the artifact as its own sidebar tab, with no task selected (OS-1569; see `docs/specs/cli-thread-detail-sidebar.md`).
- Unlike `artifact` it is not task-scoped: it survives task changes and is unaffected by the task tab's self-correction. Both may be set at once.
- Same panel component in `compact` mode; the tab resolves the owning task itself for the read-only gate and the comments handoff.

## MCP Tools

Artifacts are exposed via MCP tools:
- `list_task_artifacts`
- `get_task_artifact`
- `create_task_artifact`
- `update_task_artifact` — Artifact rewrite and metadata updates
- `replace_in_task_artifact` — Exact string replacement in artifact content
- `move_task_artifact` — Move an artifact to another task in the same project (`taskId` accepts an ID or a ref)
- `delete_task_artifact`

## One-shot CLI

Artifacts are also exposed via one-shot CLI commands under `convoy tasks artifacts`:
- `list <taskId>`
- `get <artifactId>`
- `create <taskId>`
- `update <artifactId>`
- `replace <artifactId>`
- `move <artifactId> --to-task <taskId>`
- `delete <artifactId>`

Rules:
- Commands that take a task (`list`, `create`, `move --to-task`) accept a task ID or ref. Commands that take an artifact use its document ID.
- `list` returns artifact summaries without content.
- `get` returns the full artifact including content and content type.
- `create`/`update` support inline `--content` and file-based `--content-file` input.
- `create` supports `--content-type <markdown|html>` (default `markdown`); invalid values fail before any request.
- `update` supports `--clear-content` and `--clear-run-id`.
- `replace` supports `--old-string` / `--old-string-file`, `--new-string` / `--new-string-file`, and `--replace-all`.
- Partial replace edits use exact string matching: default mode requires exactly one match, `--replace-all` replaces every occurrence, and zero matches always fail.
- MCP reports zero-match and multiple-match replace failures as tool errors (`isError: true`) inside a successful JSON-RPC response so expected editor misses are not logged as uncaught mutation failures.

Task info commands keep artifact content out of the embedded resource payload:
- `convoy tasks get <taskId>` returns artifact summaries and appends a text-mode artifact summary section.
- `convoy tasks refs <REF...>` returns artifact summaries per matched task and appends grouped text-mode artifact summary sections.

## Lifecycle and Cleanup

When a task is permanently deleted, all artifacts for that task are deleted.

## Activity Log Events

Artifact operations emit task activity events:
- `artifact_added`
- `artifact_updated`
- `artifact_removed`
