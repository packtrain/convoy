# Project Sidebar Actions Specification

This specification defines behavior for project actions shown in the sidebar `...` menu.

## Scope

- Component: `apps/web/components/blocks/project/project-actions-dropdown.tsx`
- Integration: `apps/web/components/blocks/sidebar/nav-projects.tsx`
- Related settings UI: `apps/web/components/blocks/project/settings/project-settings-dialog.tsx`

## Row Affordances

- Project rows do not render a separate `Threads` icon action in the sidebar.
- The sidebar `...` trigger remains hover/focus-revealed.
- Project title text uses the full available row width by default and only yields space to the `...` trigger while the row is hovered or focus is within the row.

## Action Rules

1. `Settings` opens Project Settings on the `General` section.
2. `Add members` replaces `Share`.
3. `Add members` opens Project Settings on the `Members` section.
4. `Prompts`, `Skills`, `Workflows`, `Integrations`, and `Lists` open Project
   Settings on their matching section, listed in that order after `Agents`.
5. All settings actions render as anchors, so middle-click and modifier-click
   open the target section in a new tab natively.
6. `Archive` is hidden from the sidebar action menu, or shown disabled under
   [`Show unfinished items`](user-settings-developer-section.md#unfinished-items).
7. `Archive` is also disabled in Project settings `Danger zone`.
8. `Delete` behavior is unchanged.
9. Items follow the caller's permissions
   ([read-only-viewer-ux.md](read-only-viewer-ux.md#settings-sidebar-and-mobile-chrome-slice-6-os-1546)).
   `Settings` always shows. `Add members` needs `PROJECT_MEMBERS_ADD` and `Integrations` needs
   `PROJECT_UPDATE` (who can manage the connection; viewers still reach the
   page from the settings nav). The
   section items show only when the section is open to the caller. `Delete`
   needs the org `PROJECT_DELETE`. While the roles load, only `Settings` shows.
   A section hidden by its developer toggle has no action either
   (`Integrations` while `GitHub integration` is off).

## Label and Icon Rules

- The action label is exactly `Add members`.
- The action icon is `UserPlus`.
- The previous `Share` label and `Share2` icon are not shown.
- `Prompts`, `Skills`, `Workflows`, `Integrations`, and `Lists` use the same
  icons as the Project Settings nav: `FileText`, `Sparkles`, `Workflow`,
  `Plug`, `List`.

## Settings Dialog Section Routing

- Sidebar actions link to the settings route for their section:
  - `Settings` → `general`
  - `Add members` → `members`
  - `Agents` → `agents`
  - `Prompts` → `prompts`
  - `Skills` → `skills`
  - `Workflows` → `workflows`
  - `Integrations` → `integrations`
  - `Lists` → `lists`

The menu takes the organization slug and project alias and builds each href with
`appRoute.projectSettings`; the sidebar does not pass per-section hrefs.

## Acceptance Checklist

- Project `...` menu shows `Add members` and no `Share`.
- Clicking `Add members` opens Project Settings with Members content active.
- Clicking `Settings` opens Project Settings with General content active.
- Project `...` menu shows `Prompts`, `Skills`, `Workflows`, `Integrations`, and `Lists` linking to their sections.
- Middle-clicking any settings action opens that section in a new tab.
- Sidebar `Archive` item is hidden by default and disabled under `Show unfinished items`.
- Danger Zone `Archive` button is disabled.
- A project viewer sees only `Settings`, plus `Delete` when their org role allows it.
