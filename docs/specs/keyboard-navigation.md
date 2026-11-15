# Keyboard Navigation Specification

This document specifies the keyboard navigation behavior for the task list application. It serves as a reference for unit tests, user documentation, and QA testing.

## Overview

The task list supports keyboard-driven navigation and manipulation. Users can navigate between tasks, select multiple items, reorder items, expand/collapse subtasks, and edit task names without using a mouse.

In grouped lists, plain Up/Down crosses collapsed group boundaries. Expand the
preceding or following nonempty group, scroll its last or first navigable task
into view, then focus it. Preserve filters and subtask expansion. Headers also
support Left/Right collapse/expand; their Up/Down keys and group creation inputs
can return focus to tasks. See [task list grouping](task-list-grouping.md).

## Quick Reference

| Shortcut                  | Context                                                           | Action                                                            |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| ↑ / ↓                     | Row/Input                                                         | Navigate to adjacent task or add-task input                       |
| K / J                     | Row selected / Row focused (not while typing)                     | Same as ↑ / ↓                                                     |
| →                         | Row                                                               | Expand subtasks (if collapsed)                                    |
| ←                         | Row                                                               | Collapse subtasks (if expanded)                                   |
| Shift + ↑/↓               | Row                                                               | Extend/contract selection                                         |
| Cmd/Ctrl + ↑/↓            | Row                                                               | Reorder task up/down                                              |
| Tab                       | Row / Task Input / Add Task Input                                 | Indent - make child of previous sibling                           |
| Shift + Tab               | Row / Task Input / Add Task Input                                 | Outdent - move to parent's level                                  |
| Enter                     | Row                                                               | Start editing (cursor at end)                                     |
| Enter                     | Input                                                             | Open local draft row (before if cursor at start, after otherwise) |
| Escape                    | Input                                                             | Exit editing, focus row                                           |
| Escape                    | Row selected / table selection                                    | Clear task selection                                              |
| Space                     | Row                                                               | Toggle status (To Do ↔ Done)                                      |
| S, then O/T/L/V/P/R/B/D/C | Row selected / Row focused                                        | Set task status                                                   |
| T, then T/B/F/E/I/C/D     | Row selected / Row focused                                        | Set task type                                                     |
| P / A / L / D / M         | Row selected / Row focused / Board card focused                   | Open the priority, assignee, label, due date or move-to-list picker |
| I                         | Row selected / Row focused / Board card focused                   | Assign to me                                                      |
| Escape                    | Task panel open (not while typing, no menu or dialog open)        | Close the task panel                                              |
| J / K                     | Task panel open (not while typing, table does not own the key)    | Open the next / previous task in view order                       |
| ?                         | Global (no editable field, dialog or menu focused)                | Open the keyboard shortcuts sheet                                 |
| G, then I/W/T/S           | Global (no editable field, dialog or menu focused)                | Go to inbox, Watch Tower, threads or settings                     |
| Shift + N                 | Global (no editable field, dialog or menu focused)                | Open the quick-thread composer                                    |
| Cmd/Ctrl + Enter          | Quick-thread composer                                             | Start the thread and open it                                      |
| Cmd/Ctrl + Enter          | Row                                                               | Open details sidebar                                              |
| Cmd/Ctrl + Backspace      | Row                                                               | Delete selected tasks                                             |
| Cmd/Ctrl + D              | Row                                                               | Duplicate task                                                    |
| Cmd/Ctrl + B              | Global (when no editable field is focused)                        | Toggle app sidebar                                                |
| Cmd/Ctrl + K              | Global (when no editable field is focused)                        | Find task                                                         |
| C                         | Global (no input focused)                                         | Open local draft row at top                                       |
| Cmd/Ctrl + Shift + A      | Global on task list (no editable field focused)                   | Open archive completed tasks dialog                               |
| Cmd/Ctrl + Shift + B      | Global on active unfiltered task list (no editable field focused) | Move visible top-level closed tasks to bottom                     |
| N                         | Task list (no input focused)                                      | Open new task dialog                                              |
| N                         | Threads (no input focused)                                        | Navigate to new thread page                                       |
| T                         | Threads (no input focused)                                        | Open or toggle the thread tasks sidebar                           |
| [                         | Threads (no input focused)                                        | Collapse or reopen the thread list                                |
| D                         | Thread detail (no input focused)                                  | Toggle the open thread done / not done                            |
| Escape                    | Thread sidebar multiselect active (no dialog open)                | Exit thread multiselect, clear selection                          |
| Escape                    | Thread sidebar shared-threads view open (no dialog open)          | Exit the shared-threads view                                      |
| Enter / Space             | Collapsed workflow rail button focused                           | Expand and pin the run rail, focus its Pin/Unpin toggle             |
| Escape                    | Workflow run rail focused                                        | Close the rail and restore focus to its collapsed button           |
| Shift + K / Shift + J     | Pull request reader on a stack Layer (no editable field focused)  | Open the Layer above / below                                      |
| Cmd/Ctrl + U              | Thread composer                                                   | Attach files or photos                                            |
| Backspace                 | Input (empty draft)                                               | Cancel draft, focus previous                                      |
| Backspace                 | Input (at start)                                                  | Focus previous task                                               |
| Cmd/Ctrl + Click          | Task ref badge                                                    | Copy full task link to clipboard                                  |

## Read-only viewers

A user without `TASK_UPDATE` on the project (a `viewer`, see
[read-only-viewer-ux.md](read-only-viewer-ux.md)) keeps only the shortcuts that
change nothing shared:

| Kept | Not registered |
| --- | --- |
| ↑ / ↓, Shift + ↑/↓, → / ←, Escape (clear selection), Cmd/Ctrl + Enter, Cmd/Ctrl + B, Cmd/Ctrl + K, Cmd/Ctrl + Click on the ref | Enter (edit), Space, Cmd/Ctrl + ↑/↓, Tab, Shift + Tab, Cmd/Ctrl + Backspace, Cmd/Ctrl + D, the `S` and `T` palettes |

The write shortcuts are switched off through each binding's `enabled` option
(`canUpdateTask` on `useKeyboardNavigation`), not by returning early from the
handler. A registered binding that does nothing would still swallow the key, so
Tab would stop moving focus. The task name renders as plain text, so the
input-level Enter, Backspace, and Escape handlers have nothing to attach to.

The keyboard shortcuts dialog hides the write rows (and an Editing group left
empty) when the current route's project is read-only for the user. Outside a
project it lists everything. On the task list page, `C` and `N` need
`TASK_CREATE`, and the archive-completed and closed-to-bottom shortcuts need
`TASK_UPDATE`; each is off through its `enabled` option (OS-1539). Without
`CLI_THREAD` the dialog drops the Threads group and the threads layout does not
register `N`, and a viewer never reaches the threads area anyway (OS-1545).

## Contexts

Keyboard shortcuts behave differently depending on the current context:

| Context                    | Description                                             |
| -------------------------- | ------------------------------------------------------- |
| **Input Focused**          | The cursor is in a task's name input field              |
| **Add Task Input Focused** | The cursor is in an "Add task" input field              |
| **Row Focused**            | A row has keyboard focus (but not editing the input)    |
| **Row Selected**           | One or more rows are selected but no element is focused |
| **No Selection**           | No rows are selected and no input is focused            |

---

## Visual States

### Selection vs Focus

The UI distinguishes between **selection** (which items are selected) and **focus** (which element has keyboard focus):

| State               | Visual Indicator                                    | Description                                      |
| ------------------- | --------------------------------------------------- | ------------------------------------------------ |
| **Selected**        | Light blue background (`bg-[#f8fbff]`)              | Item is part of the current selection            |
| **Focused (Row)**   | Blue inset ring (`ring-1 ring-inset ring-info`)     | Row has keyboard focus, arrow keys will navigate |
| **Focused (Input)** | Browser default / input styling                     | Text input has focus for editing                 |

**Key Points:**

- A row can be both selected AND focused (common state after clicking a row)
- The focus outline appears when the row has focus OR when an input inside the row has focus (`focus-within`)
- Selection persists even when focus moves elsewhere; focus outline disappears when focus is lost
- Selection is limited to rows still visible in the current table; if selected rows leave the view, they are pruned from selection immediately

---

## Navigation Shortcuts

### Arrow Up / Arrow Down

**Context:** Input Focused, Row Focused, or Row Selected

**Behavior:**

- Moves selection to the adjacent task (above or below)
- Clears any multi-selection and selects only the target task
- Focuses the target task's **row** (not the input) - shows blue focus ring
- Updates the selection anchor to the new position
- Works even when focus is outside the table (as long as there's a selection)
- `K` and `J` do the same as Up and Down. Unlike the arrows they never fire
  while a text field or the editor has focus, because they type there.

**Edge Cases:**

- At first task + Arrow Up: No action (stays at first)
- At last task + Arrow Down: No action (stays at last)
- No selection + Arrow: No action

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Task 2 selected | ↓ | Task 3 selected, row focused (ring visible) |
| Task 2 selected | ↑ | Task 1 selected, row focused (ring visible) |
| Task 1 selected | ↑ | Task 1 selected (no change) |
| Tasks 1,2,3 selected | ↓ | Task 4 selected only, row focused |
| Task 2 input focused | ↓ | Task 3 selected, row focused (exits edit mode) |
| Last task selected | ↓ | "Add task" input focused, selection cleared |
| "Add task" input focused | ↑ | Last task selected, row focused |

### Navigation to Add Task Inputs

**Context:** Row Selected or Add Task Input Focused

**Behavior:**

- "Add task" inputs are part of the navigation flow (both inline subtask inputs and the bottom root input)
- When navigating TO an add-task input: clears selection and focuses the input
- When navigating FROM an add-task input: selects the adjacent task and focuses its row
- Add-task inputs have IDs like `add-{parentId}` for inline inputs and `add-root` for the bottom input

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Last child selected (parent expanded) | ↓ | "Add subtask" input focused |
| "Add subtask" input focused | ↓ | Next task selected (or next add-task input) |
| "Add subtask" input focused | ↑ | Previous task selected |
| "Add task" (root) input focused | ↑ | Last visible task selected |

---

### Arrow Right (Expand Subtasks)

**Context:** Row Focused (single selection)

**Behavior:**

- Expands the subtask tree of the selected task
- Only works if the task has children AND is not already expanded
- No effect if task has no children or is already expanded
- No effect during multi-selection

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Task with children (collapsed) | → | Task expanded, children visible |
| Task with children (expanded) | → | No change |
| Task without children | → | No change |
| Multiple tasks selected | → | No change |

---

### Arrow Left (Collapse Subtasks)

**Context:** Row Focused (single selection)

**Behavior:**

- Collapses the subtask tree of the selected task
- Only works if the task is currently expanded
- No effect if task is not expanded
- No effect during multi-selection

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Task with children (expanded) | ← | Task collapsed, children hidden |
| Task with children (collapsed) | ← | No change |
| Task without children | ← | No change |
| Multiple tasks selected | ← | No change |

---

## Multi-Selection Shortcuts

### Shift + Arrow Up / Shift + Arrow Down

**Context:** Input Focused, Row Focused, or Row Selected

**Behavior:**

- Extends or contracts the selection range
- Selection is always a **contiguous range** from the anchor to the cursor
- The anchor (starting point) remains fixed during shift operations
- The cursor (end point) moves with each shift+arrow press
- Focuses the target task's **row** (shows blue focus outline)

**Range Selection Model:**

1. When a single item is selected, it becomes the **anchor**
2. Shift+Arrow moves the **cursor** to extend/contract the range
3. The selection always includes all items between anchor and cursor (inclusive)
4. Plain Arrow (without shift) resets both anchor and cursor to the new position

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Task 2 selected (anchor) | Shift+↓ | Tasks 2,3 selected |
| Tasks 2,3 selected (anchor=2) | Shift+↓ | Tasks 2,3,4 selected |
| Tasks 2,3,4 selected (anchor=2) | Shift+↑ | Tasks 2,3 selected |
| Tasks 2,3 selected (anchor=2) | Shift+↑ | Task 2 selected |
| Tasks 2,3 selected (anchor=2) | Shift+↑ | Tasks 1,2 selected (cursor moved above anchor) |
| Task 2 selected (anchor) | Shift+↑ | Tasks 1,2 selected |

**Edge Cases:**

- At first task + Shift+↑: No action
- At last task + Shift+↓: No action
- Anchor remains even when cursor moves past it in the opposite direction
- Inline add-task/add-subtask inputs are skipped by Shift+↑/↓; range selection
  extends to the next selectable task row across those create rows.

---

## Metadata Shortcuts

### Status Prefix (`S`)

**Context:** Row Focused or Row Selected

**Behavior:**

- Pressing `S` opens a transient status shortcut palette.
- Pressing a mapped second key applies that status to the selected rows.
- If no rows are selected, the focused row is updated.
- Status targets are filtered by the current project's allowed status list.
- The palette closes after a successful status update, `Escape`, an unmapped second key, or 4 seconds.
- Unmapped second keys do not apply metadata and may still be handled by normal table/navigation shortcuts.
- Status updates clear selection only if the updated tasks leave the current filtered view.

**Mappings:**
| Sequence | Status |
|----------|--------|
| S, O | To Do |
| S, T | Triage |
| S, L | Planning |
| S, V | Plan Review |
| S, P | In Progress |
| S, R | In Review |
| S, B | Blocked |
| S, D | Done |
| S, C | Canceled |

### Task Type Prefix (`T`)

**Context:** Row Focused or Row Selected

**Behavior:**

- Pressing `T` opens a transient task-type shortcut palette.
- Pressing a mapped second key applies that task type to the selected rows.
- If no rows are selected, the focused row is updated.
- The palette closes after a successful type update, `Escape`, an unmapped second key, or 4 seconds.
- Unmapped second keys do not apply metadata and may still be handled by normal table/navigation shortcuts.
- Type updates preserve selection.

**Mappings:**
| Sequence | Task type |
|----------|-----------|
| T, T | Task |
| T, B | Bug |
| T, F | Feature |
| T, E | Epic |
| T, I | Investigation |
| T, C | Chore |
| T, D | Idea |

**Shortcut Conflict Rules:**

- Prefix shortcuts are table-scoped: they only start when the table has focus, or when selection exists and focus is on the document body.
- Prefix and second-key events do not fire while an editable field is focused.
- Plain `C` still creates an inline task at the top when no prefix palette is active.
- `S, C` applies `Canceled`; `T, C` applies `Chore` and must not trigger create-at-top.

### Single-key property shortcuts (`P`, `A`, `I`, `L`, `D`, `M`)

**Context:** Row Focused or Row Selected in the task table (including the panel's
subtask table), or a focused Board card. Hidden from read-only viewers.

| Key | Action |
|-----|--------|
| P | Open the priority picker |
| A | Open the assignee picker |
| I | Assign the targets to me (no picker) |
| L | Open the label picker |
| D | Open the due date picker |
| M | Open the move-to-list picker |

**Behavior:**

- Targets are the selected rows, or the focused row when nothing is selected.
  On the Board the target is the focused card.
- The picker opens anchored to the first target row or card, and focus returns
  there when it closes.
- The keys are claimed in the capture phase, so the same letter does not also
  run a document-level shortcut (for example `D` toggling a thread done).
- While an `S` or `T` palette is open, the second key goes to the palette
  (`S, P` is In Progress, `T, I` is Investigation, `S, D` is Done).
- They never fire while a text field or the editor has focus, or with Cmd,
  Ctrl, Alt or Shift held.
- The row and card context menus show `P`, `A`, `L` and `M` next to Priority,
  Assignee, Label and Move to. The menus have no Assign to me or due date item,
  so `I` and `D` have no hint there. Board card menus show only these keys;
  table-only keys (`S`, Space, Cmd/Ctrl + D, Enter, Backspace) are not hinted
  on cards because a card does not handle them.

---

## Reorder Shortcuts

### Cmd/Ctrl + Arrow Up / Cmd/Ctrl + Arrow Down

**Context:** Single item selected (Input Focused or Row Selected)

**Behavior:**

- Moves the currently selected task up or down in the list
- Swaps position with the adjacent task
- Selection and focus remain on the moved task
- Only works with single selection (multi-select move not supported)
- If neighboring ranks are identical (legacy data), the reorder still succeeds without throwing

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Task 2 selected, list: [1,2,3] | Cmd+↓ | Task 2 selected, list: [1,3,2] |
| Task 2 selected, list: [1,2,3] | Cmd+↑ | Task 2 selected, list: [2,1,3] |
| Task 1 selected, list: [1,2,3] | Cmd+↑ | Task 1 selected, list: [1,2,3] (no change) |

**Edge Cases:**

- At first task + Cmd+↑: No action
- At last task + Cmd+↓: No action
- Multiple items selected: No action (single selection only)

---

## Hierarchy Shortcuts

### Tab (Indent)

**Context:** Row Focused or Row Selected (single or multi-selection)

**Behavior:**

- Makes the selected task(s) children of their previous sibling
- All selected tasks must be siblings (share the same parent)
- For multi-select: only "root" selections are moved (children of selected tasks move with their parent automatically)
- The new parent (previous sibling) is automatically expanded
- Works from either a focused row or a focused task-name input
- If task input is focused and selection is empty, uses the focused task as the target
- If indentation is invalid (for example first sibling), no hierarchy change occurs and focus stays in task context (no browser tab traversal)

**Root Selection Filtering:**
When multiple tasks are selected, nested selections are filtered out:

- A task is a "root" if its parent is NOT also selected
- Children of selected tasks move with their parent automatically

**Example:**

```
A
B (selected)      ← root (will be processed)
-C (selected)     ← NOT root (parent B is selected, moves with B)
-D                ← child of B (moves with B)
```

After Tab: B (with C and D) becomes child of A.

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Task B selected, siblings [A, B, C] | Tab | B becomes child of A |
| Tasks B,C selected, siblings [A, B, C, D] | Tab | B and C become children of A |
| Task A selected (first sibling) | Tab | No hierarchy change, focus stays in task context |
| Task with children selected | Tab | Task + children move together |
| Input focused | Tab | Indent selection (or focused task if no selection) |

---

### Shift + Tab (Outdent)

**Context:** Row Focused or Row Selected (single or multi-selection)

**Behavior:**

- Moves the selected task(s) up one level in the hierarchy
- All selected tasks must share the same parent
- The tasks become siblings of their old parent (at grandparent level)
- **Positioning:** Outdented tasks are placed immediately after their former parent, not at the end of the sibling list
- For multi-select: only "root" selections are moved; they maintain their relative order
- Works from either a focused row or a focused task-name input
- If task input is focused and selection is empty, uses the focused task as the target
- If outdent is invalid (for example top-level or mixed parents), no hierarchy change occurs and focus stays in task context (no browser tab traversal)

**Example:**

```
A
- B      ← selected
- C
D

After Shift+Tab on B:
A
B        ← positioned right after A (former parent)
- C      ← C remains child of A
D
```

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Child task selected | Shift+Tab | Task becomes sibling of old parent, positioned after it |
| Multiple children selected (same parent) | Shift+Tab | All become siblings of old parent, preserving order |
| Top-level task selected | Shift+Tab | No hierarchy change, focus stays in task context |
| Tasks with different parents selected | Shift+Tab | No hierarchy change, focus stays in task context |
| Input focused | Shift+Tab | Outdent selection (or focused task if no selection) |

**Edge Cases:**

- Top-level tasks: No hierarchy change; keep task context focus
- Selected tasks have different parents: No hierarchy change; keep task context focus
- Task input is focused: Tab/Shift+Tab runs indent/outdent behavior
- Task has children: Children move with the task

---

## Action Shortcuts

### Enter (Start Editing)

**Context:** Row Focused (not Input Focused)

**Behavior:**

- Enters edit mode for the selected task
- Places cursor at the **end** of the task name input
- Only works when a row element has focus (focus ring visible)
- Does nothing if already editing an input

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Row focused (ring visible) | Enter | Input focused, cursor at end |
| Input already focused | Enter | Normal Enter behavior (create task, including trailing `#tag` extraction) |

---

### Escape (Exit Editing)

**Context:** Input Focused

**Behavior:**

- Exits edit mode without any changes
- Blurs the input field
- Focuses the parent row element (shows focus ring)
- Allows immediate keyboard navigation without clicking

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Input focused, editing | Esc | Input blurred, row focused (ring visible) |

---

### Space Bar (Toggle Status)

**Context:** Row Focused

**Behavior:**

- Toggles the status of all selected tasks between "To Do" and "Done"
- Works with single or multi-selection
- Only works when a row element has focus (not during input editing)

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Task selected (status: To Do) | Space | Status: Done |
| Task selected (status: Done) | Space | Status: To Do |
| Multiple tasks selected | Space | All toggled |
| Input focused | Space | Types space character |

---

### Cmd/Ctrl + Enter (Open Details)

**Context:** Row Focused or Row Selected (single selection only)

**Behavior:**

- Opens the details sidebar for the selected task
- Only works with single selection
- Does nothing if input is focused (editing)
- Does nothing if multiple tasks are selected

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Single task selected | Cmd+Enter | Sidebar opens with task details |
| Multiple tasks selected | Cmd+Enter | No action |
| Input focused | Cmd+Enter | No action |

---

### Cmd/Ctrl + Backspace (Delete)

**Context:** Row Focused or Row Selected

### Cmd/Ctrl + B (Toggle App Sidebar)

**Context:** Global, except while focus is inside an editable field

**Behavior:**

- Toggles the app sidebar open/collapsed state
- Does not fire while focus is in a text input, textarea, select, or `contenteditable` editor
- In particular, rich-text editors such as the task description editor keep ownership of formatting shortcuts like `Cmd/Ctrl + B`

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Row focused | Cmd/Ctrl + B | App sidebar toggles |
| Task title input focused | Cmd/Ctrl + B | Input keeps normal editing behavior |
| Task description editor focused | Cmd/Ctrl + B | Editor toggles bold, sidebar unchanged |

**Behavior:**

- Deletes all selected tasks
- Works with single or multi-selection
- Does nothing if input is focused (normal backspace behavior)
- Shows confirmation dialog if tasks have subtasks
- After delete is confirmed/executed, shows a 5-second toast with `Undo`
- Undo restores deleted tasks only; it does not restore `keep_children` hierarchy changes

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Single task selected | Cmd+Backspace | Task deleted + undo toast |
| Multiple tasks selected | Cmd+Backspace | All selected tasks deleted + single undo toast |
| Input focused | Cmd+Backspace | Normal backspace (delete word) |

---

### Cmd/Ctrl + D (Duplicate)

**Context:** Row Focused or Row Selected (single selection only)

**Behavior:**

- Duplicates the selected task (including subtasks)
- Creates a copy immediately after the original
- Only works with single selection
- Does nothing if input is focused

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Single task selected | Cmd+D | Task duplicated below original |
| Multiple tasks selected | Cmd+D | No action |
| Input focused | Cmd+D | Browser default (bookmark) |

---

### C (Create Task)

**Context:** Global — no input, textarea, or select element focused

**Behavior:**

- Opens a local draft row at the top of the current task list
- Scrolls the task list to the top so the draft row is visible
- Uses the first root task as the insertion anchor (not nested subtasks)
- Respects current filter defaults (status, assignee)
- Auto-focuses the draft input at the start
- Does nothing if archive view is active
- Does nothing if an input, textarea, or select is focused (types "c" normally)
- If adjacent tasks have duplicate legacy ranks, create/reorder must still succeed (no crash)

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| No input focused, active view | C | Task list scrolls to top; draft row opens at top, input focused |
| Input focused (editing task) | C | Types "c" character |
| Archive view active | C | No action |

---

### N (New Task / New Thread)

**Context:** Task list or threads — no input, textarea, or select element focused

**Behavior:**

- In task-list context, opens the compact new task dialog.
- In threads context, navigates to the new thread page (`/o/{org}/{project}/threads`).
- Does nothing if an input, textarea, or select is focused (types "n" normally)
- Task-list shortcuts use the key event's original target when applying this guard,
  so a searchable dropdown cannot trigger `N` if menu handling moves focus during
  the same key event.

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| No input focused, task list | N | Opens the compact new task dialog |
| No input focused, threads | N | Navigates to new thread page |
| Input focused (editing task) | N | Types "n" character |
| Search input in a dropdown | N | Filters the dropdown; no dialog opens |

### T (Thread Tasks Sidebar)

**Context:** Threads — no input, textarea, select element, or contenteditable editor focused

**Behavior:**

- On the new-thread page, toggles the Tasks sidebar when the Tasks panel is visible.
- If task details are visible on the new-thread page, clears task detail selection and keeps the sidebar open on the Tasks panel.
- On a thread detail page, opens or activates the Tasks tab in the thread sidebar.
- If the Tasks tab is already active on a thread detail page, toggles the thread sidebar open/closed.
- In the full-width layout there is no pane to toggle: T activates the Tasks tab, and pressing it again returns to the Thread tab.
- Does nothing if an editable field is focused (types "t" normally).

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| No input focused, new-thread page with Tasks panel open | T | Tasks sidebar closes |
| No input focused, new-thread page with Tasks panel closed | T | Tasks sidebar opens |
| No input focused, thread detail page | T | Thread sidebar opens with Tasks tab active |
| No input focused, thread detail page in full-width layout | T | Tasks tab activates full width; T again returns to the Thread tab |
| Input focused in thread composer | T | Types "t" character |

### D (Toggle Thread Done)

**Context:** Thread detail page — no input, textarea, select element, or contenteditable editor focused

**Behavior:**

- Marks the open thread as done; pressing it again marks it not done. Same action as the header's done button.
- Does nothing while the thread is running, for a read-only viewer, or while the thread is still loading.
- Does nothing if an editable field is focused (types "d" normally).

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| No input focused, thread not done | D | Thread marked done |
| No input focused, thread done | D | Thread marked not done |
| No input focused, thread running | D | No action |
| Input focused in thread composer | D | Types "d" character |

---

### R (Toggle thread read/unread)

**Context:** Thread detail page with no input, textarea, select, or contenteditable editor focused.

- Marks the open thread read if it is unread or requires attention. Otherwise, marks it unread.
- Reuses the manual read toggle, including attention acknowledgment and active-thread auto-read suppression. See `cli-thread-read-state.md`.
- Does nothing for a read-only viewer or while the thread is loading.
- Available while the thread is running, matching the existing read action.
- Does nothing while typing in an editable field.

| Initial state | Key | Final state |
|---------------|-----|-------------|
| Unread thread | R | Thread marked read |
| Read thread requiring attention | R | Attention acknowledged |
| Read thread without attention | R | Thread marked unread; auto-read suppressed |
| Read-only viewer or loading thread | R | No action |
| Thread composer focused | R | Types "r" |

### Escape (Exit Thread Multiselect)

**Context:** Desktop thread sidebar with multiselect mode enabled

**Behavior:**

- Clears the thread selection, exits multiselect mode, and restores the
  status indicators and settings gear.
- Disabled while the batch delete confirmation, single-thread delete, or
  rename dialog is open — the dialog owns the Escape key.
- See `cli-thread-list.md` (Bulk Actions) for the full multiselect behavior.

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Multiselect active, threads selected | Escape | Selection cleared, multiselect exited |
| Multiselect active, batch delete dialog open | Escape | Dialog closes, multiselect and selection remain |

---

### Escape (Exit Shared Threads View)

**Context:** Desktop thread sidebar with the shared-threads view open

**Behavior:**

- Leaves the view and restores the project thread list, exactly like the
  header's X button.
- Registered together with the multiselect binding as a **single** Escape
  handler that dispatches on whichever mode is active, so the two cannot race
  for the key. They are mutually exclusive in practice: both are entered from
  the settings gear, which neither mode renders.
- Disabled while the batch delete confirmation, single-thread delete, or
  rename dialog is open — the dialog owns the Escape key.
- See `cli-thread-list.md` (Shared Threads View) for the rest of the view.

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Shared threads view open | Escape | View exits, project thread list restored |
| Shared threads view open, thread delete dialog open | Escape | Dialog closes, view remains open |

---

### Cmd/Ctrl + Shift + A (Archive Completed Tasks)

**Context:** Global on the project task list, except while focus is inside an editable field

**Behavior:**

- Opens the existing archive-completed confirmation dialog from the task list page
- Uses the current filtered active task list as the source of eligible tasks
- Only targets top-level tasks with status `Done` or `Canceled`
- Does nothing in archived view
- Does nothing when there are no eligible top-level completed tasks
- Does nothing if an editable field is focused (`input`, `textarea`, `select`, or task editing fields)
- Does not archive silently; confirmation is still required

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Active task list, completed top-level tasks available, no editable field focused | Cmd/Ctrl+Shift+A | Archive completed tasks dialog opens |
| Active task list, no eligible top-level completed tasks | Cmd/Ctrl+Shift+A | No action |
| Archived view | Cmd/Ctrl+Shift+A | No action |
| Editable field focused | Cmd/Ctrl+Shift+A | No action |

### Cmd/Ctrl + Shift + B (Move Closed Tasks To Bottom)

**Context:** Global on the active unfiltered project task list, except while focus is inside an editable field

**Behavior:**

- Reorders visible top-level root tasks so non-closed tasks appear above tasks with status `Done` or `Canceled`
- Preserves relative order within the non-closed group and within the closed group
- Uses an optimistic UI update and then settles to the server-confirmed rank order
- Only targets visible top-level rows; subtasks keep their existing parent-local order
- Does nothing in archived view
- Does nothing when status or assignee filters are active
- Does nothing when the visible top-level rows are already normalized
- Does nothing if an editable field is focused (`input`, `textarea`, `select`, or task editing fields)
- Does not show a confirmation dialog

**Expected Result:**
| Initial State | Key | Final State |
|---------------|-----|-------------|
| Active task list, visible roots `[Done, To Do]`, no editable field focused | Cmd/Ctrl+Shift+B | Visible roots reorder to `[To Do, Done]` |
| Active task list, visible roots `[Done, Done, To Do]` | Cmd/Ctrl+Shift+B | The open task moves above the closed tasks |
| Active task list, visible roots `[Done, Done, To Do, To Do, To Do]` | Cmd/Ctrl+Shift+B | The closed tasks move below the open tasks |
| Active task list with status or assignee filter applied | Cmd/Ctrl+Shift+B | No action |
| Archived view | Cmd/Ctrl+Shift+B | No action |
| Editable field focused | Cmd/Ctrl+Shift+B | No action |

---

## Task panel

The task details panel on the list and Board views (`useTaskPanelHotkeys`).

| Key | Action |
|-----|--------|
| Escape | Close the panel |
| J | Open the next task in the view's visible order |
| K | Open the previous task |

**Behavior:**

- Order: the list view uses the table's visible rows (grouping, filters and
  expanded subtasks included, group rows skipped). The Board walks cards in
  rendered order, column by column, top to bottom.
- At the first or last task, and for a task that is not in the view (an opened
  subtask), J and K do nothing.
- The listener sits on the window in the bubble phase and skips keys another
  handler already claimed with `preventDefault`. So when the table owns focus,
  its own J/K and Escape (clear selection) win, and the next Escape closes the
  panel. A Board drag in progress keeps Escape for canceling the drag.
- Ignored while a text field or the editor has focus, inside an open menu,
  listbox or dialog other than the panel's own mobile drawer, and with
  modifiers held.

---

## Global shortcuts

### ? (Keyboard shortcuts sheet)

- `?` opens the keyboard shortcuts sheet from anywhere in the app shell.
  Shift is allowed because `?` needs it on most layouts; Cmd, Ctrl and Alt
  are not.
- Ignored while a text field or the editor has focus, and while focus is in a
  dialog, popover, menu or listbox. The task panel counts as the page, not a
  dialog.
- The sheet lists every shortcut in this spec, grouped under sentence-case
  headers: Global, Go to, Navigation, Selection, Editing, Task properties,
  Task panel, Board, Actions and Threads. Write shortcuts are hidden from
  read-only viewers, and the Threads group needs threads access.

### G chords (Go to)

| Sequence | Destination |
|----------|-------------|
| G, I | Inbox (opens the notifications panel in the sidebar) |
| G, W | Watch Tower for the organization |
| G, T | Threads of the current project, or the last project visited; nothing if there is none |
| G, S | Organization settings |

- The second key must follow within 1.5 seconds. Any other key cancels the
  chord and is handled normally.
- The chord listener runs in the window capture phase and claims the second
  key, so `G, I` does not also assign the task, and `G, T` and `G, S` do not
  open the task type or status palette. `G` itself is not claimed; nothing
  else binds it.
- Ignored while a text field or the editor has focus, while focus is in a
  dialog, popover, menu or listbox (the task panel excepted), and with
  modifiers held.

### Shift + N (Quick thread)

- Opens the quick-thread composer for the current project, else the last
  project visited. Nothing without a project or without `CLI_THREAD` on it.
- `Enter` starts the thread in the background; `Cmd/Ctrl + Enter` starts it
  and opens it.
- Same guards as `?`: ignored in text fields, the editor, dialogs, popovers,
  menus and listboxes, and with Cmd, Ctrl or Alt held.
- Full behavior: [quick-thread-composer.md](quick-thread-composer.md).

---

## Input Field Shortcuts

These shortcuts apply when the cursor is in a task's name input field.

### Enter

**Context:** Input Focused

**Behavior:**

- Opens a local draft row
- If cursor is at the **start** of the input (position 0): Insert draft **before** current
- If cursor is at any other position: Insert draft **after** current
- If that "after" position already has a visible add-task input, focus that existing add-task input instead of opening a second draft row
- Focus moves to the draft input field
- The backend task is created only when the draft is committed with a non-empty value
- Enter on a non-empty draft creates the task and immediately opens the next draft after it
- Blur on a non-empty draft creates the task without opening another draft
- Blur on an empty draft cancels it and removes the draft row

**Precondition:**

- Input must not be empty (Enter on empty input does nothing)

**Expected Result:**
| Cursor Position | Input Value | Action |
|-----------------|-------------|--------|
| Start (pos 0) | "Buy milk" | Draft inserted before, focused |
| End | "Buy milk" | Draft inserted after, focused |
| Middle | "Buy milk" | Draft inserted after, focused |
| Any | "" (empty) | No action |

### Draft Blur

**Context:** Draft Input Focused

**Behavior:**

- Blur on a non-empty draft commits the task
- Blur on an empty draft cancels the draft row

**Expected Result:**
| Input Value | Action |
|-------------|--------|
| "Buy milk" | Create task, close current draft |
| "" (empty draft) | Cancel draft, remove row |

### Backspace

**Context:** Input Focused

**Behavior depends on input state:**

1. **Empty draft input + Backspace:**
   - Cancels the local draft
   - Focuses the previous task's input (at end of text)
   - If no previous task exists, no focus change

2. **Empty persisted task input + Backspace:**
   - Deletes the current task
   - Focuses the previous task's input (at end of text)
   - If no previous task exists, no focus change

3. **Cursor at start (pos 0) + Backspace (no text selection):**
   - Does NOT delete any text
   - Moves focus to previous task's input (at end of text)
   - Current task remains unchanged

4. **Cursor not at start OR text is selected:**
   - Normal backspace behavior (delete character or selection)

**Expected Result:**
| Input State | Cursor | Action |
|-------------|--------|--------|
| "" (empty draft) | - | Cancel draft, focus previous |
| "" (empty persisted task) | - | Delete task, focus previous |
| "Buy milk" | Start (pos 0) | Focus previous task |
| "Buy milk" | End | Delete "k" |
| "Buy milk" | Middle | Delete char before cursor |
| "Buy [milk]" (selected) | Selection | Delete "milk" |

### Backspace In Add-Task Input

**Context:** Add-task Input Focused

**Behavior:**

- `Backspace` on an empty add-task input moves focus to the previous persisted task input
- For the top-level add-task input, this focuses the end of the last visible task in the table
- For nested add-task inputs, this focuses the end of the last visible sibling/subtask before that add-task row
- If no previous task exists, no focus change occurs

**Expected Result:**
| Input | Value | Action |
|-------|-------|--------|
| Top-level add-task | "" | Focus end of last visible task |
| Nested add-task | "" | Focus end of previous visible sibling/subtask |
| Any add-task input | Non-empty | Normal backspace behavior |

### Tab / Shift + Tab

**Context:** Task Input Focused or Add Task Input Focused

**Behavior:**

- `Tab` indents selected task(s)
- `Shift+Tab` outdents selected task(s)
- If selection is empty, uses the focused task input as the target
- Prevents browser focus traversal while handling indent/outdent
- If hierarchy operation is invalid, no hierarchy change occurs and focus remains in task context
- In `Add task...` / `Add subtask...` inputs, `Tab` moves the draft one level deeper under the previous visible task, reveals/focuses the target `Add subtask...` input, and preserves typed text
- In `Add subtask...` inputs, `Shift+Tab` moves the draft one level up after the source create row and preserves typed text. If the source had typed text, the source `Add subtask...` row remains available; if it was an empty childless row revealed only by `Tab`, it collapses so only one parent-level create row remains. A bottom `Add subtask...` row gets a parent-level `Add task...` row after it and before the next root/sibling task; when there is no next root/sibling task, focus moves to the existing bottom parent-level add row instead of rendering a duplicate inline row. An inline draft before an existing child remains before that child while moving one level up.
- `Tab` from a parent-level draft created by `Shift+Tab` returns the draft to the original source `Add subtask...` row instead of indenting under the deepest previous descendant.
- Inline create drafts inserted before an existing task also support `Shift+Tab` and keep their visible position while moving one level up
- If an add-input destination already contains text, the source draft remains intact and focus moves to the destination without overwriting it
- Expanded tasks without visible children do not keep an `Add subtask...` row after their last child moves away unless create-input `Tab` navigation explicitly revealed that row

---

## Click-Based Selection

For completeness, here are the click behaviors that interact with keyboard navigation:

### Normal Click (on row)

- Selects the clicked task (single selection)
- Focuses the row (shows focus ring)
- Opens the details sidebar
- Sets the anchor for range selection
- Clicking directly in the task-name input selects the task and keeps focus in the input for inline editing. If the details sidebar is already open, the sidebar switches to the clicked task and the task URL query updates; if the sidebar is closed, it remains closed.

### Cmd/Ctrl + Click

- Toggles the clicked task in/out of selection
- Focuses the clicked row
- Does NOT open the details sidebar
- Updates anchor to clicked task

### Shift + Click

- Selects range from anchor to clicked task
- Focuses the clicked row
- Does NOT open the details sidebar
- Anchor remains unchanged

### Click on Input Field

- Selects the clicked task (single selection, clears multi-selection)
- Sets the anchor for range selection
- Focuses the input for text editing
- If the task details sidebar is already open, updates the sidebar and task URL query to the clicked task
- Row focus ring IS shown (via `focus-within`)

### Cmd/Ctrl + Click (on Task Ref Badge)

**Context:** Clicking the task ref badge (e.g., "ABC-123") displayed in task rows or the task detail sidebar

**Behavior:**

- Without modifier key: copies the task ref ID (e.g., "ABC-123") to clipboard
- With Cmd (Mac) or Ctrl (Windows/Linux) held: copies the full task URL to clipboard
- Shows a toast confirming what was copied
- Event propagation is stopped so the click does not open the task sidebar

**Expected Result:**
| Modifier | Action |
|----------|--------|
| None | Copies ref ID (e.g., "ABC-123") to clipboard |
| Cmd/Ctrl | Copies full task link (e.g., `https://…/tasks?task=ABC-123`) to clipboard |

---

## Implementation Details

### Key Components

- `useKeyboardNavigation` hook: Handles Arrow, Shift+Arrow, Cmd+Arrow, Tab/Shift+Tab (indent/outdent), Space, Enter (edit), Cmd+Enter, Cmd+Backspace, Cmd+D
- Task input `onKeyDown` (in columns.tsx): Handles Enter, Backspace, Escape
- `handleRowClick`: Handles click-based selection
- `useTaskTableController`: Orchestrates selection, expansion, and provides callbacks

### State Dependencies

| State                                             | Purpose                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `selectedIds: Set<string>`                        | Currently selected task client IDs                                                     |
| `lastSelectedId: string \| null`                  | Anchor for range selection                                                             |
| `inputRefs: Map<string, HTMLInputElement>`        | References to task name input elements                                                 |
| `addTaskInputRefs: Map<string, HTMLInputElement>` | References to "Add task" input elements                                                |
| `rowRefs: Map<string, HTMLElement>`               | References to row elements (for focus management)                                      |
| `taskIds: string[]`                               | Ordered list of task client IDs (for selection)                                        |
| `navigableIds: string[]`                          | Ordered list of all navigable IDs including add-task placeholders and local draft rows |
| `expandedIds: Set<string>`                        | IDs of expanded tasks (showing children)                                               |

### Event Handling

- Task-table shortcuts are registered at the **document level** via TanStack Hotkeys
- This ensures shortcuts work even when focus is outside the task table
- Events are only processed when there's a selection OR focus is within the container
- Input-specific shortcuts (Enter, Backspace, Escape) are handled at the input level
- Row-level shortcuts (Space, Enter to edit) only fire when a row element has focus

---

## Test Scenarios

### Unit Test Cases

1. **Navigation**
   - [ ] Arrow down from middle item selects next item
   - [ ] Arrow up from middle item selects previous item
   - [ ] Arrow up from first item does nothing
   - [ ] Arrow down from last item navigates to add-task input
   - [ ] Arrow clears multi-selection
   - [ ] Arrow up from add-task input selects previous task

2. **Multi-Selection**
   - [ ] Shift+Arrow extends selection by one
   - [ ] Shift+Arrow in opposite direction contracts selection
   - [ ] Selection is always contiguous
   - [ ] Anchor remains fixed during shift operations
   - [ ] Cursor can move past anchor in either direction

3. **Reorder**
   - [ ] Cmd+Arrow swaps with adjacent item
   - [ ] Moved item stays selected
   - [ ] Cmd+Arrow at boundary does nothing
   - [ ] Cmd+Arrow with multi-select does nothing

4. **Expand/Collapse**
   - [ ] Right arrow expands collapsed task with children
   - [ ] Right arrow does nothing on expanded task
   - [ ] Right arrow does nothing on task without children
   - [ ] Left arrow collapses expanded task
   - [ ] Left arrow does nothing on collapsed task
   - [ ] Left/Right does nothing with multi-selection

5. **Action Shortcuts**
   - [ ] Enter on focused row starts editing (cursor at end)
   - [ ] Escape exits editing and focuses row
   - [ ] Space toggles status of selected tasks
   - [ ] Cmd+Enter opens sidebar for single selection
   - [ ] Cmd+Enter does nothing with multi-selection
   - [ ] Cmd+Backspace deletes selected tasks
   - [ ] Cmd+D duplicates single selected task
   - [ ] Cmd+D does nothing with multi-selection

6. **Input Shortcuts**
   - [ ] Enter at start opens draft before
   - [ ] Enter at end opens draft after
   - [ ] Enter at end of the last visible task focuses the existing add-task input instead of opening a second draft row
   - [ ] Enter on empty input does nothing
   - [ ] Enter on non-empty draft creates task and opens the next draft
   - [ ] Blur on non-empty draft creates task without opening another draft
   - [ ] Backspace on empty draft cancels and focuses previous
   - [ ] Backspace at start focuses previous without deleting
   - [ ] Backspace on empty top-level add-task input focuses the end of the last visible task

7. **Indent/Outdent**
   - [ ] Tab makes single task child of previous sibling
   - [ ] Tab with multi-select makes all root tasks children of previous sibling
   - [ ] Tab on first sibling does nothing (no previous sibling)
   - [ ] Tab expands new parent so moved task remains visible
   - [ ] Shift+Tab moves single task to parent's level
   - [ ] Shift+Tab with multi-select moves all root tasks to grandparent level
   - [ ] Shift+Tab on top-level task does nothing
   - [ ] Tab/Shift+Tab works when task input is focused
   - [ ] Tab/Shift+Tab does nothing when tasks have different parents
   - [ ] Parent + child selected: only parent moves, child stays attached

### Manual QA Checklist

**Navigation**

- [ ] Can navigate through entire list using only arrow keys
- [ ] Arrow navigation works when row is focused (not input)
- [ ] Arrow navigation works when input is focused
- [ ] Keyboard navigation works even after clicking outside the table (if selection exists)
- [ ] Can navigate to "Add task" input at bottom
- [ ] Can navigate to inline "Add subtask" inputs when expanded
- [ ] Can navigate back up from any add-task input

**Multi-Selection**

- [ ] Can select range using shift+arrows, then deselect by reversing
- [ ] Shift+arrow focuses the row (shows outline)
- [ ] Selection contracts correctly when reversing direction

**Reorder**

- [ ] Can reorder items using cmd+arrows
- [ ] Reordered item stays selected and focused

**Expand/Collapse**

- [ ] Right arrow expands task with subtasks
- [ ] Left arrow collapses expanded task
- [ ] Inline "Add subtask" input appears when expanded

**Indent/Outdent**

- [ ] Tab indents task under previous sibling
- [ ] New parent expands after indent
- [ ] Shift+Tab outdents task to parent's level
- [ ] Multi-select indent/outdent works with siblings
- [ ] Tab in task input indents (does not move browser focus)

**Action Shortcuts**

- [ ] Enter starts editing, cursor appears at end of text
- [ ] Escape exits editing, row gets focus ring
- [ ] Space toggles done/to do status
- [ ] Cmd+Enter opens sidebar
- [ ] Cmd+Backspace deletes (shows confirmation if subtasks exist)
- [ ] Cmd+D duplicates task

**Single keys and panel**

- [ ] J/K move through the list like the arrows, and type normally in inputs
- [ ] P, A, L, D and M open their pickers on the focused row and on a focused Board card; I assigns to me
- [ ] With the panel open, Escape closes it and J/K open the next/previous task in list and Board order
- [ ] ? opens the shortcuts sheet; G then I, W, T or S goes to inbox, Watch Tower, threads or settings

**Input Editing**

- [ ] Can create new tasks with Enter key
- [ ] Enter-created tasks strip trailing `#tag` tokens into task tags when a non-empty title remains before them
- [ ] Can delete empty tasks with Backspace
- [ ] Backspace at start of text navigates to previous task

**Visual States**

- [ ] Focus ring (blue outline) visible when row has focus
- [ ] Focus ring visible when input inside row has focus (focus-within)
- [ ] Selection background (light blue) visible on all selected items
- [ ] Focus ring disappears when clicking outside the table

---

## Platform Notes

- **Mac:** Use Cmd key for move operations
- **Windows/Linux:** Use Ctrl key for move operations
- The implementation uses `e.metaKey || e.ctrlKey` to support both platforms
