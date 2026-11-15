# App Sidebar

## Header

- The expanded desktop sidebar header starts with a brand row.
- The brand row shows the Convoy text logo on the left and the sidebar toggle
  action on the right.
- The brand row keeps the same fixed height in expanded and icon-collapsed
  states so the main navigation does not shift vertically during sidebar
  collapse or expand.
- The sidebar does not render a dedicated workspace or organization selector in
  the header.
- Page-level headers and secondary sidebars do not render duplicate sidebar
  collapse or expand buttons. The app sidebar brand row is the canonical
  visible control.

## User Menu

- The footer user menu trigger uses the larger profile row treatment.
- The trigger shows the user avatar, the user's name, and the selected
  organization name below it in smaller muted text.
- Organization color is not shown in the trigger.
- The user menu dropdown header shows the profile avatar, name, email, and an
  icon-only profile settings button on the right.
- Organization switching is handled inside the user menu dropdown below the
  profile header.
- On mobile, the same user menu content opens in the shared bottom drawer
  surface instead of a dropdown.
- Organization colors are shown only in the dropdown organization list.
- The selected organization row shows the user's organization role as a compact
  badge after the organization name.
- The dropdown includes a `New organization` action and does not include
  organization settings or add-members actions.

## Projects Section

- With no projects, the Projects section shows one "+ New project" row. It is a
  real `<button>`, so Tab reaches it and Enter or Space opens the create
  project dialog, the same dialog as the section's `+` action.
- The organization home (`/o/{organizationSlug}`) with no projects shows the
  "No projects yet" empty state with a "Create project" button that opens the
  same dialog. The button needs the org `project:create` permission and stays
  hidden while the role loads. Once a project exists the page redirects to it.

## Environment Notice

- Non-production environments show a compact notice near the bottom of the
  expanded sidebar, above the footer actions.
- The notice uses a filled rounded card treatment without a visible border.
- The notice includes an icon-only dismiss button.
- Dismissing the notice only affects the current mounted session. The dismissed
  state is not persisted to local storage, cookies, or backend state.
- The notice is hidden in icon-collapsed sidebar mode.

## Sub-Sidebar Navigation

- Desktop routes may opt into a split sidebar mode with a temporary icon rail
  on the left and a wider sub-sidebar on the right.
- The temporary icon rail uses icon-collapsed project navigation regardless of
  the persisted app-sidebar state: project icons stay visible, pinned Lists open
  from the project icon menu, and hidden expanded List rows add no spacing.
- Split mode does not mutate the persisted app-sidebar collapsed state.
- The split layout uses the normal expanded sidebar footprint so page content
  does not shift when a sub-sidebar route is active.
- The Notifications inbox (`docs/specs/notifications.md`) reuses the same
  split layout but is state-driven, not route-driven: the main-nav bell
  toggles it over any page without navigating, its back button only closes
  the panel, and while open it takes precedence over a settings sub-sidebar.
  Outside-click and navigation dismissal follow `docs/specs/notifications.md`.
  Sidebar controls stay mounted when split mode changes so a menu or dialog
  opened from the rail survives inbox dismissal.
  The bell shows a red unread-count pill badge ("99+" cap) in the expanded
  sidebar.
  On mobile, the mobile menu's bell opens the inbox in the shared bottom
  drawer instead.
- Organization settings is the first sub-sidebar route group:
  `/o/{organizationSlug}/settings/general` and
  `/o/{organizationSlug}/settings/members`.
- The Settings sub-sidebar Back action links to `/o/{organizationSlug}/`.
- If the client has a remembered last project for the organization, Settings
  Back actions link directly to that project (avoiding the org-root redirect
  loader), resolving the project's stored default view the same way sidebar
  project links do: List opens `/o/{organizationSlug}/{projectAlias}`, Board
  opens the kanban route. Until the project's settings have loaded, Back falls
  back to the bare `/o/{organizationSlug}/{projectAlias}` route.
- Clicking the Settings sub-sidebar Back action immediately exits split sidebar
  mode while the route transition finishes.
- The main sidebar Settings item is route-active only while an organization
  settings route is active.
- The organization settings nav includes active sections for `General`,
  `Members`, `Projects`, `Prompts`, `Agents`, and `Skills`.
- Under [`Show unfinished items`](user-settings-developer-section.md#unfinished-items), the
  organization settings nav also shows disabled future sections: `Workflows`,
  `Task Templates`, and `Project Templates`. They do not render as links, and
  are hidden while the toggle is off.
- Mobile does not render the split sub-sidebar panel. The mobile menu exposes a
  `Organization settings` action that opens a bottom drawer with the same active
  section links plus the same disabled future sections.
- Mobile organization settings pages render the global bottom nav bar (fixed
  Tasks / Threads / + / Search / Menu slots; see
  `docs/specs/mobile-bottom-nav.md`). Section switching is a mobile-only
  header dropdown on the section title with the same section links and
  disabled future sections; there is no dedicated Back slot.
- Organization settings content is rendered by the routed settings pages. The
  old organization settings popup and footer popup launch buttons are not
  rendered.
- The General settings page includes the Danger Zone content below the general
  organization form.
- The General settings page uses a two-section settings layout: section title
  and description on the left, controls on the right, with the save action in
  the first section.

## Collapsed State

- In icon-collapsed desktop mode, the brand row shows the Convoy mark.
- Hovering anywhere over the collapsed sidebar fades the mark into the expand
  sidebar button.
- The collapsed brand row remains an accessible button for expanding the
  sidebar.
- Clicking collapsed sidebar background space expands the sidebar. Clicks on
  buttons, links, inputs, or other interactive controls keep their own behavior.
