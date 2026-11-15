# Searchable Picker (shared field-dropdown search behavior)

Field selector dropdowns with a search input (task status, priority, label,
assignee, and the task-list pickers) share one search + keyboard behavior. It is
implemented once in `apps/web/components/custom/searchable-picker.tsx`
(`SearchablePicker` frame + `SearchablePickerItem` row) on top of
`searchable-picker-keyboard.ts`; behavior changes are made there so every
picker stays consistent.

## Behavior

- Opening the picker auto-focuses the search input.
- Typing filters the list; printable keys never leak to the parent menu's
  typeahead. A clear (`X`) button shows while the query is non-empty.
- ArrowDown/ArrowUp move **real focus** (not a cmdk-style virtual highlight)
  through a cycle that includes the search input:
  input → first item → … → last item → input, and the reverse for ArrowUp.
  So pressing Down then Up returns to the search input, and arrowing past the
  last item lands on the search input rather than wrapping straight to the
  first item.
- Enter or Space activates the focused item. While the input is focused,
  Space types a space and Enter does nothing.
- Escape closes the owning overlay (dropdown/popover) and resets the query;
  Tab is left to the overlay's default handling.

## Container

- Status, priority, assignee and label pickers all open in a `DropdownMenu`
  (`modal={false}`) with the same task-field trigger props, so they look and
  dismiss alike. None uses a `Popover`.
- Each picker exports its body as a `*PickerContent` component
  (`StatusPickerContent`, `PriorityPickerContent`, `AssigneePickerContent`,
  `TaskLabelPickerContent`). Hosts with their own menu, like the row context
  menu, render that body inside a submenu and pass `itemAs={ContextMenuItem}`,
  so choosing a row closes the host menu.
- Each picker takes an optional controlled `open` / `onOpenChange` pair, so a
  keyboard shortcut can open it without a click.
- There is one `PriorityPicker` (`components/blocks/tasks/priority-picker.tsx`),
  used by the table cell, the sidebar, the create dialogs and the bulk toolbar.
  It marks the current priority with a check.

## Structure

- `SearchablePicker` renders the shared borderless search row
  (`DropdownSearchInput`) plus a scrollable list container
  (`data-slot="searchable-picker-list"`).
- Items are focusable elements marked via `getSearchablePickerItemProps` —
  either `SearchablePickerItem` (plain focusable row, works inside both
  `DropdownMenuContent` and `PopoverContent`; `checked` renders a trailing
  check icon and `data-checked`) or a Radix `DropdownMenuItem` carrying the
  same marker props (assignee selector).
- cmdk `Command` is not used for these pickers; filtering is plain
  `includes()` in each component.

## Consumers

- `status-dropdown-menu.tsx` (see [task-status-selection.md](task-status-selection.md))
- `priority-picker.tsx`
- `task-label-picker.tsx` (see [task-labels.md](task-labels.md))
- `assignee-selector.tsx`
- task-list pickers (`move-to-list-menu-content.tsx`, `task-list-management.tsx`)
  share the keyboard helper and therefore the same arrow cycle.
