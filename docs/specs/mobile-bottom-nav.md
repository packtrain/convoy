# Mobile Bottom Nav

## Scope

Defines the global mobile bottom navigation bar and the mobile-only page
chrome that replaced the old per-page bar compositions (OS-1377). Design
record: the "Mobile nav redesign proposal" artifact on OS-1377.

## The global bar

- One route-aware `MobileNavBar`
  (`components/blocks/mobile/mobile-nav-bar.tsx`) is mounted once in the
  organization layout, inside `MobileNavBarProvider`
  (`components/blocks/mobile/mobile-nav-context.tsx`).
- Five fixed slots, identical on every page — slots never reorder and never
  change meaning. Icon-only (decided: no labels for now):
  1. **Tasks** (`ListChecks`) — navigates to the project's task view entry
     (stored default list/board view). Active state on the task views routes.
  2. **Threads** (`BotMessageSquare`) — navigates to the project threads area.
     Active state while in threads. Hidden for a project without threads
     access, the one exception to fixed slots
     ([read-only-viewer-ux.md](read-only-viewer-ux.md#threads-workflow-runs-and-worktrees-slice-5-os-1545)).
  3. **+** (round primary button) — always creates the main object of the
     current page: in the threads area it opens the new-thread composer
     (`?new=1` on the threads index); everywhere else it opens the
     create-task drawer. No two-option sheet, no long-press. Hidden when
     the user cannot create that object
     ([read-only-viewer-ux.md](read-only-viewer-ux.md#task-create-affordances-slice-3-os-1539)).
  4. **Search** (`Search`) — opens the task search sheet (task-only for v1).
  5. **Menu** (`Menu`) — opens the app menu panel (nav, projects,
     notifications, organization settings, user).
- Outside a project (org settings, watch-tower, org root), the Tasks/Threads
  targets resolve through the remembered last project
  (`lib/routing/last-project-storage.ts`), falling back to the org root when
  none resolves. Search uses that project too; the create-task drawer keeps
  its own project selector.
- The bar renders on **all** organization routes, including settings
  subroutes, usage, artifacts, and watch-tower.

## When the bar hides

- Inside thread conversations: the thread detail route, and the new-thread
  composer (`/threads?new=1`) on mobile. Conversations are full-screen pushes
  with a left-chevron `ThreadMobileBackButton` in the thread header; the
  composer sits flush at the bottom with safe-area padding only.
- While a full-screen task detail surface is open. Surfaces report through
  `useMobileNavBarHidden`; the task views shell wires its detail-surface
  state into it.

## Page-aware slots

- Pages can register a `MobileNavPageConfig` via `useMobileNavBarPageConfig`:
  the task views shell provides view-aware search navigation (keeps
  list/board mode + filters) and the selected list for the create-task
  drawer. Without a registered config the bar uses default navigation
  (`withProjectTaskAndArchive` from the project root path).

## Bottom sheets

- Task-views chrome uses `MobileSheet`
  (`components/blocks/mobile/mobile-sheet.tsx`), a shadcn/vaul `Drawer` wrapper:
  top drag handle, swipe-to-dismiss, sheet reaching the bottom of the screen
  under the floating nav bar, nav-bar clearance as trailing scroll space, and
  `data-vaul-no-drag` on the body so drags scroll content instead of closing the
  sheet. Stacked sheets (the view-options sheet's Settings sub-sheet) pass
  `nested`. The thread group strip's overflow uses it too when collapsed
  (OS-1670, docs/specs/thread-groups.md).
- The older `MobileDrawerPanel` still backs the global nav-bar panels (menu,
  search, create task) and the user menu; those are not migrated yet.
- The create-task drawer's type + title row reuses the desktop create dialog's
  shared layout (`lib/tasks/create-title-row.ts`): top-aligned row with the
  type trigger centered on the title's first line, so it stays put when a long
  title wraps (spec: docs/specs/task-create-dialog.md "Type + Title Row").
  The row's band is padded evenly (`py-3`, matching the drawer's footer band),
  so the trigger and title read as centered between the sheet edge and the
  description divider (OS-1913).

## Per-page mobile chrome (moved out of the bar)

- **Task views**: a mobile-only compact header
  (`components/blocks/mobile/mobile-task-views-header.tsx`) shows the project
  name, the List selector, and a `Filters` button that opens the filters/view
  drawer (`MobileToolbarPanel`). The panel's old "Navigate → Threads" link is
  gone (the tab bar owns area switching); Members / AI Agents /
  column-visibility settings remain under a "Project" section. AI Agents
  hides without `AGENTS_MANAGE`
  ([read-only-viewer-ux.md](read-only-viewer-ux.md#settings-sidebar-and-mobile-chrome-slice-6-os-1546)).
  - The List selector is the same component as the desktop header selector
    (`components/blocks/project/task-lists/project-task-list-dropdown.tsx`); it
    swaps its popover menu for a `Drawer` bottom sheet below the `md`
    breakpoint. It sits at the right of the header, immediately left of
    `Filters`. The trigger pill is the desktop trigger unchanged — same label,
    same styling, no mobile-only affordances (spec:
    docs/specs/task-lists.md "List Selector").
  - The project name stays left and truncates first; the selector is disabled
    until the project resolves.
- **Threads**: the bare threads index renders the thread list as a screen on
  mobile (reusing `MobileThreadListPanel` inside the threads layout); the
  thread-list drawer no longer exists. Tapping a thread pushes the
  conversation full-screen. An agent preselection (`?profileId&pathId`
  without `view=changes`) opens the composer full-screen the same way `?new=1`
  does (`isNewThreadComposerTarget`), so task-page "start a thread" links
  land in the composer instead of the list.
  Desktop keeps the sidebar + new-thread index and ignores `?new=1`.
- **Settings (org + project)**: no dedicated Back slot — the Tasks tab is the
  exit. Section switching is a mobile-only header dropdown
  (`components/blocks/mobile/mobile-settings-section-header.tsx`): the
  current section name as a tappable title opening the section list
  (disabled future sections included). Project sections the caller may not
  open are left out, the same as the desktop nav. Desktop keeps the split
  sub-sidebar; mobile still does not render it.

## Regression cases

- When a task detail drawer is open on mobile, the bar must not remain
  visible above the drawer or intercept taps.
- Inside a thread conversation the bar must not overlap the composer; the
  back button in the thread header is the way out.
- The Menu slot must open the same app menu on every page — settings pages
  must not repurpose it for section navigation.
