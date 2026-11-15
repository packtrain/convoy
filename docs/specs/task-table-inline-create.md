# Task Table Inline Create

## Scope

Defines the inline task creation rows rendered in task tables, including root task creation and subtask placeholders.

Related:

- `docs/specs/task-lists.md`
- `docs/specs/keyboard-navigation.md`

## Create Row Behavior

- The root table add row renders an inline title input with placeholder `Add task...`.
- Expanded task subtrees may render an inline title input with placeholder `Add subtask...`.
- Expanded tasks without visible children do not render `Add subtask...` unless that row was explicitly revealed by create-input `Tab` navigation.
- Clicking the plus affordance beside either inline create input focuses the adjacent title input.
- The plus affordance does not create an empty task by itself.
- Pressing Enter from a non-empty inline create input submits through the existing task creation flow.
- Blurring a non-empty inline create input may submit according to the row's existing controlled or uncontrolled mode.
- Pressing `Tab` from an inline create input moves the draft one level deeper under the previous visible task, reveals/focuses that task's `Add subtask...` input, and preserves typed text.
- Pressing `Shift+Tab` from an inline subtask create input moves the draft one level up after the source create row and preserves typed text. If the source had typed text, the source `Add subtask...` row remains available; if it was an empty childless row revealed only by `Tab`, it collapses so only one parent-level create row remains. A bottom `Add subtask...` row gets a parent-level `Add task...` row after it and before the next root/sibling task; when there is no next root/sibling task, focus moves to the existing bottom parent-level add row instead of rendering a duplicate inline row. An inline draft before an existing child remains before that child while moving one level up.
- Pressing `Tab` from a parent-level draft created by `Shift+Tab` returns the draft to the original source `Add subtask...` row instead of indenting under the deepest previous descendant.
- Inline create drafts inserted before an existing task also support `Shift+Tab` and keep their visible position while moving one level up.
- Invalid create-input hierarchy moves keep focus in task context and do not use browser tab traversal.

## Empty and loading states

- A task table with no rows shows only the root `Add task...` row, with no
  empty state; the add row already says what to do. The mobile card list,
  which has no add row, shows `TaskListEmptyState` ("No tasks").
- The loading skeleton draws rows at the real row height (`ROW_HEIGHT`, 44px)
  with no outer padding, so the table does not shift when data arrives.

## Acceptance Checks

- Clicking the plus affordance beside `Add task...` focuses that row's title input.
- Clicking the plus affordance beside `Add subtask...` focuses that row's title input.
- `Tab` in `Add task...` reveals/focuses `Add subtask...` under the task immediately above.
- `Tab` and `Shift+Tab` preserve typed text when moving between create inputs.
- Existing Enter submit, blur submit, and tag extraction behavior remains unchanged.
