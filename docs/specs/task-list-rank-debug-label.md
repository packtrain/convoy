# Task List Rank Debug Label Specification

This document defines the developer-toggleable LexoRank label shown in the main project task list.

## Overview

- A dedicated developer setting named `Task list: Show rank` controls whether the raw task rank is shown inline in the main project task list.
- This is a UI-only debug aid for investigating task ordering issues.
- The feature does not change backend task data, ordering logic, routing, or pagination behavior.

## Scope

- Applies to the main project list page task table for both active and archived task-list views.
- Does not apply to playground task tables.
- Does not apply to compact subtask tables in the task detail sidebar.

## Rendering Rules

- When enabled, the task name cell shows the full raw `rank` string.
- The rank appears after the checkbox / expand affordance and before the editable task title input.
- The rank uses muted monospace styling so it reads as debug metadata rather than primary content.
- When disabled, the task name cell layout remains unchanged and the rank is not rendered.

## Interaction Rules

- Toggling the setting updates the task list without a page reload.
- Existing task title editing behavior remains unchanged, including Enter-based draft insertion and Backspace-based delete/navigation behavior.

## Acceptance Checklist

- The `Developer` section includes a `Task list: Show rank` toggle.
- The main project task table hides ranks by default.
- Enabling the toggle shows the raw rank inline before the task title input in both active and archived list views.
- Non-targeted task-table surfaces remain unchanged.
