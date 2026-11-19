# Project Settings Developer Settings Specification

This document defines which project settings areas are available by default and which remain behind individual developer settings until implemented.

## Developer Settings Gate

- Project settings availability is controlled by the shared local developer-settings subsystem.
- The settings are managed from the `Developer` section of the user settings dialog and persist in local browser storage.
- The settings pages use the same gate regardless of which entry point navigated to them.

## Section Availability

- Always available: `General`, `Members`, `Agents`, `Workflows`, `Lists`,
  `Labels`, `Customization`, `Usage`, `Danger zone`.
- Gated together by `Extra Project settings`:
  - `Templates`
  - `Recurring tasks`
  - `Automations`
  - `Import & export`
- Outside that toggle, gated sections are hidden, or shown disabled under
  [`Show unfinished items`](user-settings-developer-section.md#unfinished-items).

## Customization Tab Availability

- Always available: `Statuses`, `Task types`, `Columns`.
- Gated together by `Extra Project settings`:
  - `Filters`
- Outside that toggle, gated tabs are hidden, or shown disabled under
  `Show unfinished items`.

## Fallback Rules

- If a gated section route is opened while `Extra Project settings` is off, the page must fall back to rendering `General`.
- If the active Customization tab becomes gated while `Extra Project settings` is off, it must fall back to `Statuses`.
- The pages must not render gated section/tab content while `Extra Project settings` is off, even transiently.

## Acceptance Checklist

- Navigating to project settings from non-header entry points still works when all feature toggles are off.
- `Workflows` and its create and edit routes remain available when `Extra Project settings` is off.
- Outside `Extra Project settings`, gated sections and the `Filters` tab cannot be activated.
- Enabling `Extra Project settings` turns on the grouped in-progress project settings surface without affecting unrelated task-list toggles.
