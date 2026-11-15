# Task Sidebar Resizing

Defines resize behavior for the desktop task detail overlay (task details
panel + optional artifact panel) on the project task views.

Related:

- `docs/specs/task-artifacts.md` — artifact panel layout constraints
- `docs/specs/task-table-name-column-resize.md` — the "drop to apply" drag model
- `docs/specs/cli-thread-sidebar-resizing.md` — threads sidebar (live resize, unaffected)

## Layout Model

The overlay is anchored to the container's right edge. With an artifact open
it is two panels side by side: `[artifact panel][task details]`. Each panel
has a requested width; CSS caps them so the overlay never exceeds the
container and the artifact keeps a minimum visible width (240px).

## Resize Handles

- **No artifact open:** one handle on the overlay's left edge resizes the
  task details panel.
- **Artifact open:** two handles:
  - the overlay's left edge (the artifact panel's left side) resizes the
    **artifact panel** width;
  - the boundary between the artifact panel and the details content resizes
    the **task details** panel width.
- Handles are `role="separator"` with vertical orientation and ARIA
  current/min/max values ("Resize artifact panel" / "Resize task sidebar").
- Mobile renders drawers with no resize controls.

## Drag Behavior ("drop to apply")

- Dragging a handle does **not** resize content live. A vertical guide line
  follows the cursor at the prospective panel edge; the width is committed
  (and persisted) on mouse up.
- The guide mirrors the CSS caps, so it lands where the edge will actually
  end up (e.g. the details guide stops at `container − 240px` while an
  artifact is open).
- A press without movement is a click, not a resize: nothing is committed or
  persisted.
- During a drag, a transparent shield covers the task view so pointer events
  keep flowing (html artifact iframes would otherwise swallow them) and the
  `col-resize` cursor stays consistent.

## Width Rules & Persistence

- Task details panel: clamped 300–900px, default 400px, persisted in
  localStorage under `task-sidebar-width`.
- Artifact panel: clamped 320–1600px, default 1140px, persisted in
  localStorage under `task-artifact-panel-width`. The rendered width is still
  capped by available container space, so wide stored values degrade
  gracefully on smaller screens.
- Mouse resizing persists on drag end; keyboard resizing applies and persists
  immediately per step.

## Keyboard

- Handles are focusable; `ArrowLeft` grows / `ArrowRight` shrinks (both
  panels expand leftward) by 16px, 48px with `Shift`.

## Related Code

- Shared resize hook (deferred commit mode): `apps/web/hooks/ui/use-resize-panel.ts`
- Overlay + handles: `apps/web/components/blocks/tasks/task-sidebar-overlay.tsx`
- Surface wiring, guide, shield: `apps/web/app/o/[organizationSlug]/[projectAlias]/(task-views)/use-project-task-detail-surface.tsx`
- Effective width helper: `apps/web/lib/tasks/sidebar-layout.ts`

## Acceptance Checks

- With no artifact open, dragging the overlay edge shows a guide; content
  resizes only on release.
- With an artifact open, the far-left handle resizes the artifact panel and
  the boundary handle resizes the details panel — both deferred with a guide.
- Reloading restores both persisted widths independently.
- Dragging across an html artifact iframe does not stall the drag.
- Keyboard arrows on either handle adjust that panel immediately and persist.
