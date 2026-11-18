# Frontend Development Guidelines

This is the design and frontend implementation guide for `apps/web/`. It is the first version of a living document; add new conventions here when a pattern becomes useful across more than one screen.

The goal is not to make every UI identical. The goal is to make repeated product surfaces feel coherent: consistent widths, spacing, controls, density, empty states, and action placement.

---

## Product UI Principles

- Group status by the entity it describes, with a heading and short labeled rows. Keep actions visually separate, deduplicate shared recovery guidance, and show disruptive-action warnings when relevant. Avoid turning summaries into paragraphs of instructions.
- Separate authentication-method selection from sign-in actions. Hide selectors with only one available choice, and show existing account status when reopening the flow. A failed status check is unknown, not signed out.
- Build application screens, not marketing pages. The product is an operational tool, so screens should be quiet, dense enough to scan, and efficient for repeated use.
- Prefer clear hierarchy over decoration. Use spacing, alignment, type scale, and dividers before adding cards, shadows, gradients, or illustrative elements.
- Reuse existing app primitives before creating local layout. Start with `components/ui/`, `components/custom/`, and feature-local shared components.
- Abstract only stable structure. Widths, section shells, form grids, empty states, and action rows are good abstractions. Domain copy, field order, validation, and special behavior usually stay local.
- Keep responsive behavior explicit. Fixed-format UI should use stable grid spans, max widths, aspect ratios, or min heights so labels, validation messages, loading text, and dynamic content do not shift the layout unpredictably.
- Document terminal shortcuts in the CLI UI and CLI docs only. Do not list them in the web shortcuts dialog; CLI and web releases can differ.
- CLI TUI navigation and action placement follow [TUI interaction guidelines](../../apps/cli/TUI-UX-GUIDELINES.md). Use one contextual Actions panel, visible sidebar creation rows, and inline status/recovery. Multi-field setup, progress and results belong in the main panel. Compact dialogs handle short confirmations and single-value prompts. Preserve drafts through repair; confirm before discarding entered fields. Terminal shortcuts remain in CLI UI/docs only.
- Use semantic design tokens. Avoid raw colors such as `bg-white`, `text-black`, or hard-coded dark-mode colors. Prefer tokens like `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, and `text-destructive`.
- Theme tokens that fill large surfaces (e.g. `--background`) must be exact 8-bit sRGB values (hex). `oklch()` values compile to fractional `lab()` colors, and one that lands between two 8-bit values (like `oklch(0.185 0 0)` ≈ 18.6/255) renders as visible stripes where GPU layers round differently.
- Add `cursor-pointer` to interactive controls, including custom labels that toggle checkboxes.
- For a primary action with an extra mode, use `ButtonGroup` with a joined dropdown trigger, as in the plan approval footer. Keep the default action directly clickable and give the icon-only trigger an accessible label.
- Color a state with the status tokens, never a raw Tailwind hue. Use `success` for done, online and diff additions; `warning` for waiting on the user, archived and caution notes; `info` for running, in review, informational notes and drop or selection indicators; `destructive` for failed and diff deletions. Each has three classes: the base (`text-warning`, `bg-warning` for dots) holds 4.5:1 on background and card in both themes, `bg-warning-soft` is a tinted surface, and `text-warning-foreground` is copy on that surface. A callout is `border-warning/40 bg-warning-soft` with `text-warning-foreground` copy.
- A hue with no token (a categorical task status, the Skill accent) is a light/dark pair: the 600 shade in light and the 400 shade in dark, as in `text-orange-600 dark:text-orange-400`. A single raw hue is tuned for one theme and fails contrast in the other. `app/globals.test.ts` enforces this for the thread, task, project and workflow blocks.
- Use `text-info` for inline command accents such as slash command mentions and active Plan-mode composer affordances.
- Use `text-violet-600 dark:text-violet-400` for inline Skill accents — the `/` menu row, the composer pill, and the rendered mention. Skills share the `/` trigger with Prompts, so the accent is what tells the two apart at a glance.

## Layout

### Widths

Use established page widths instead of inventing a new one for each screen.

- Settings edit pages: `max-w-4xl`.
- Modal/dialog content: follow the existing dialog component or the nearest feature dialog.
- A `p-0` dialog with the default close button puts its title in `DialogTitleBar`, which centres it on the X. Hand-set top padding drifts with the title's line height.
- Lists and dashboards: use the existing page shell width for that product area.

Do not widen a single page to fit a local form. If a form feels cramped, adjust field spans, break the form into sections, or move large editors into their own section.

### Alignment

Page titles, section content, and form actions should usually share the same content container. Avoid separate max-width wrappers for the title and body; they drift as soon as one wrapper changes.

When validation messages appear, fields in the same row should stay top-aligned. `FormItem` handles this itself (`grid content-start`); a hand-rolled `grid gap-2` field needs `self-start`. Prefer grid defaults, `items-start`, or `self-start` over vertical centering for mixed-height form rows.

### Cards

Use cards for repeated items, modal content, and genuinely framed tools. Do not use cards as a default page-section wrapper.

Avoid cards inside cards. If a section needs visual separation, use a full-width section, divider, heading, spacing, or a constrained layout before adding another framed surface.

Pending interaction requests above a thread composer use an overlapping deck
with one open card and up to three waiting previews. Hover spreads the cards
without moving the composer. The pending-count text opens a picker for all
requests; do not add separate All or Spread cards buttons. Preserve drafts
when switching, support keyboard and touch selection, and respect reduced
motion. A single request needs no stack controls.

Use shared dropdown radio items for compact single-choice pickers such as
the pending-request menu. Keep their default padding and row spacing; do not
build spaced button lists inside a popover for these menus.

CLI subagent lifecycle and orchestration calls belong in one agent activity
accordion. Preserve the event history when combining cards; do not replace it
with only the final status. Keep completed waits, pending operations, failures,
and results inside the group. Collapse consecutive duplicate lifecycle labels
in the visible history while retaining the original notifications in raw data.
Expose full payloads through a collapsed raw-data
control as well as the debug copy action.

## Typography

- Use page-scale headings only for page titles.
- Use compact headings inside panels, forms, sidebars, and dashboards.
- Omit `source unknown` from the composer cost strip and its popup, including
  totals and model rows. Keep historical cost metadata out of these compact labels.
- Do not put decorative icons in page, tab, or section titles. Sidebar and menu
  items may use icons, but the content header should usually be plain text.
- Keep letter spacing at the default unless matching an existing component.
- Do not scale font size with viewport width.
- Text must not overflow buttons, cards, tabs, or fixed controls. Prefer wrapping, truncation, or a smaller fixed scale over layout shifts.

## Copy

- Use sentence case for buttons, headings, labels, menu items, dialog titles,
  tooltips, `aria-label`s and toasts: "Delete project", "Organization settings",
  "Save changes". Only the first word and proper nouns are capitalized. Product
  and vendor names stay as written: Convoy, Watch Tower, Claude Code, Codex,
  GitHub, CLI, MCP, API.
- Domain nouns from `CONTEXT.md` are lowercase mid-sentence in UI copy ("Create
  list", "No assignee"), even though the specs capitalize them.
- Use the `CONTEXT.md` name for each thing, and only that name: "No assignee"
  (not Unassigned), "Agents" (not AI Agents), "Project key" (not Alias), "CLI
  profiles" (not Profiles). Call the CLI and its
  connection "CLI", never "agent": "CLI offline", "Fetching from CLI…". "Agent"
  means an AI agent.
- A table cell, badge or metadata field with no value shows `—` in
  `text-muted-foreground`, not "None", "N/A" or an empty gap. Use `EmptyValue`
  from `components/blocks/tasks/task-table/badges.tsx` in task surfaces.

## Forms

Single-choice form dropdowns, including MCP enum and boolean fields, use the
shared `Select` components from `components/ui/select`. Scrollable form regions
must leave space inside their scroll boundary for the controls' focus rings.

Multi-select fields are a dropdown of checkbox rows (`Popover` + `Checkbox`, as
in `ApiKeyScopePicker`), not an inline checkbox list. When the picks are ordered,
list them below the dropdown and reorder them by drag with `SortableRankRow`,
not up/down buttons. Show a task type with the `TaskType` pill from
`task-ref-with-type.tsx`, not a text badge.

### Standard Fields

Use `FormFieldExt` for ordinary labeled fields.

```tsx
<FormFieldExt
  control={form.control}
  name="title"
  label="Title"
  className="sm:col-span-3"
  render={({ field }) => <Input {...field} placeholder="Architecture Review" />}
/>
```

Use direct `FormField` when the control needs custom structure that `FormFieldExt` would hide, such as a checkbox row with label and description.

### Input Groups

Use the shared input group components for prefixes, suffixes, or other adornments.

```tsx
<InputGroup>
  <InputGroupAddon>
    <InputGroupText>/</InputGroupText>
  </InputGroupAddon>
  <InputGroupInput value={value} onChange={onChange} />
</InputGroup>
```

Do not hand-roll bordered prefix wrappers for common input adornments.

### Search Inputs

Use `SearchInput` from `components/custom/search-input.tsx` for reusable
search fields in product surfaces. It wraps the shared shadcn `InputGroup`
primitive and should be preferred over local icon-positioned search inputs.

Use `DropdownSearchInput` from
`components/custom/dropdown-search-input.tsx` inside searchable dropdowns and
pickers. It provides the shared transparent, borderless search row for both
Command-backed and native-filtered menus; do not place a standard bordered
field inside a dropdown.

Searchable dropdowns and pickers focus their search input when they open so
typing can begin immediately. `ArrowDown` and `ArrowUp` move focus through
enabled results, and both `Enter` and `Space` activate the focused result.
Text-entry keys stay in the search input instead of bubbling into menu
typeahead, so users can enter multi-character queries without losing focus.
Render only the product clear button; do not combine it with a browser-native
search cancel control.
Use the shared searchable-picker keyboard helper for non-Command menus rather
than recreating per-surface key handling.

### Buttons

Use named `Button` sizes instead of local height overrides. If a repeated
surface needs a height that does not exist, add a semantic size to
`components/ui/button.tsx` and use that size at callsites.

Project settings popup toolbar/action buttons should use:

```tsx
<Button variant="outline" size="settings">
  Add member
</Button>
```

Do not use `size="sm"` plus `className="h-8"` in project settings. Row-local
compact controls can still use `size="sm"` or icon sizes such as
`size="icon-sm"` when they are intentionally smaller than toolbar actions.

Project settings secondary workflows, such as adding from an external catalog
or choosing a template, should open in their own dialog. Do not replace the
current settings tab body with a temporary picker view.

### Panel Header Icon Buttons

Icon-only buttons in panel/sidebar headers (task detail header, artifact
viewer header, notifications panel, and similar toolbars) use the compact
treatment:

```tsx
<Button variant="ghost" size="icon-sm" aria-label="Close">
  <X />
</Button>
```

The `icon-sm` variant owns both dimensions: a `size-7` (28px) button target
and a `size-3.5` (14px) glyph. Do not add local button-size overrides or size
the child icon directly. Do not use `size="icon"` with `className="size-8"`
and `size-4` icons for these — that reads oversized next to the compact header
controls. Reference: the threads button in
`task-detail-sidebar/task-detail-header.tsx`.

### Destructive Actions

Dialog and popup edit forms should not place Delete buttons in their footers.
For list-managed records, expose deletion from the owning row's `...` actions
menu, use a destructive menu item, and show a confirmation dialog before
running the delete mutation.

### Danger Callouts

Use `DangerCallout` from `components/custom/danger-callout.tsx` for an error the
user can act on — a stale app version, a failed run. It owns the red surface, the
icon, and the title/description hierarchy; the callsite passes copy, its action
buttons, and any positioning via `className`. Give the primary action
`DANGER_CALLOUT_ACTION_CLASS` — solid callout red with a white label and icon.
Do not hand-roll another red panel.

Its palette lives in the `--danger-callout*` vars and is applied as inline
styles, not through a `@theme` color namespace: a bespoke namespace failed to
generate utilities in dev, and the callout rendered with no colour at all.

### Checkboxes And Switches

Use a checkbox when the setting is part of a form that is saved explicitly.

Use a switch when toggling has an immediate effect or is clearly an on/off control outside an explicit save flow.

Checkbox rows should be plain form rows unless there is a specific reason to visually frame them. Do not put a checkbox in a card just to make it more visible.

```tsx
<FormField
  control={form.control}
  name="autoExpand"
  render={({ field }) => (
    <FormItem className="col-span-full">
      <label className="flex cursor-pointer items-start gap-3">
        <FormControl>
          <Checkbox
            aria-label="Auto expand"
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked === true)}
          />
        </FormControl>
        <span className="grid gap-1">
          <span className="text-sm font-medium leading-none">Auto expand</span>
          <span className="text-sm leading-6 text-muted-foreground">
            Insert the full prompt content when this command is selected.
          </span>
        </span>
      </label>
      <FormMessage />
    </FormItem>
  )}
/>
```

### Settings Rows

Settings controls that pair a label with a single control (switch, select, etc.) use a horizontal row: label + muted description stacked on the left, the control on the right.

```tsx
<div className="flex items-start justify-between gap-4">
  <div className="space-y-1">
    <Label>Show resource count in task list</Label>
    <p className="text-sm text-muted-foreground">
      Display a paperclip with the number of attachments and artifacts after the task name.
    </p>
  </div>
  <Switch aria-label="Show resource count in task list" ... />
</div>
```

Give the right-side control `shrink-0`. Dropdowns in settings rows use the compact badge-style trigger: `<SelectTrigger variant="badge">` (see below). Inside a react-hook-form form, wrap only the control in `FormFieldExt` (no `label`/`description` props) and keep the label/description as the plain left column. Reference implementations: `DeveloperSettingRow` in `components/blocks/user/settings/developer-section.tsx`, the Default view / resource count rows in `components/blocks/project/settings/general-section.tsx`.

### Badge-Style Select Triggers

Compact inline dropdowns — member role selects, settings-row dropdowns, and similar "value that happens to be editable" controls — use the shared `variant="badge"` on `SelectTrigger` (`components/ui/select.tsx`) instead of hand-rolled trigger classes:

```tsx
<SelectTrigger variant="badge" aria-label="Default view">
  <SelectValue />
</SelectTrigger>
```

`ProjectRoleSelect` forwards the same prop (`<ProjectRoleSelect variant="badge" ... />`). Do not copy the underlying class string inline; extend the variant if the style needs to evolve. The matching static (non-editable) counterpart is `RoleBadge` from `components/ui/role-badge`.

### Explicit Save

Full-page edit forms should use explicit save unless the feature already has an established auto-save pattern.

Place cancel/save actions at the bottom of the form, not in the header. This keeps editing workflow consistent with dialogs and avoids duplicating primary actions above and below the form.

### Generated Fields

Fields derived from another field, such as slugs, project aliases, and slash command keys, may auto-fill while the derived field is untouched.
Once the user edits the derived field directly, stop overwriting it on later source-field changes.

## Settings Section Pages

A settings *section* is the body rendered under a section slug
(`/o/{slug}/settings/{section}`). The route shell already renders the section
title from `ORGANIZATION_SETTINGS_SECTION_LABELS`, so:

- **Do not render a second heading or sub-description inside a section
  component.** The shell owns the page title through `SettingsPageContainer`
  and `SettingsPageHeader`, in organization and project settings alike; the
  project shell also shows the section's description from
  `PROJECT_SETTINGS_SECTION_CONFIG`. A section that adds its own
  `<h2>Projects</h2>` + "Every project in this organization…" produces a visible
  double header. Two-column sections inside a page (`SettingsTwoColumnSection`,
  `tone="danger"` for a Danger Zone) keep their left-column titles.
- **Put the create action at the top of the section**, as an
  `variant="outline" size="settings"` button, above the list. When the list is
  empty, move it into the `Empty` state as `variant="secondary"` instead. See
  Lists And Empty States.
- **Render repeated entities as divided rows**, not as an accordion or a card
  grid: `SettingsCatalogListFrame` (`rounded-lg border divide-y`) wrapping `p-4`
  rows. Reference rows: `SlashCommandRow`, `ProjectAgentRow`, `ProjectRow`.
- **Two lines in the row, actions on the right.** Line one is the entity name
  plus its identifier and status badges; line two is muted `text-xs` metadata
  (author, relative date). Do not push metadata to the far right of line one —
  it strands the eye across the row and collapses badly at narrow widths.
  Trailing space belongs to a single `⋯` `DropdownMenu` (`variant="secondary"
  size="icon-sm"`, `aria-label="{name} actions"`), not to text.
- **Relative dates use `formatDistanceToNow(..., { addSuffix: true })`** from
  `date-fns`, phrased as `created by {name}, {n} days ago`. Omit the author
  clause when unknown rather than printing a placeholder name.
- **A row navigates; it does not expand.** Drilling into an entity is a nested
  route with its own page, not an in-place accordion. Nesting a full section
  (with its own members list, dialogs, and mutations) inside a collapsible row
  buries actions and duplicates the surrounding chrome.
- **Do not put per-row counts in a list row when the count costs a query per
  row.** A "3 members" line that fans out one membership read per project is not
  worth the header line; show it on the entity's own page, where one read is
  already paid for.

### Entity Detail Subpages

A nested settings route (`.../settings/{section}/{entityId}`) renders its own
`main` and owns its layout — the section shell does not wrap it. Use the same
header shape as the prompt and agent editors:

```tsx
<main className="flex min-h-0 w-full flex-1 flex-col px-6 pb-24 pt-10 md:pb-6 md:pt-12">
  <SettingsPageContainer className="flex flex-1 flex-col gap-6">
    <SettingsPageHeader
      title={entity.name}
      description={entity.description}
      backLink={{ href: sectionRoute, label: "Back to projects" }}
    />
    {/* body */}
  </SettingsPageContainer>
</main>
```

The back link label names its destination (`Back to projects`), never a bare
`Back`. Reference: `SlashCommandEditorPage`, `AgentEditorPage`,
`OrganizationProjectDetailPage`.

When the subpage edits the entity (the common case), title it `Edit {thing}`
rather than echoing the entity's name, and build the body from
`SettingsTwoColumnSection` + `SettingsFormGrid`. A read-only variant is a
fallback for callers who lack the manage permission, not the default shape.

Two rules about where the actions go:

- **Never put `flex-1` on a form that has sections below it.** It stretches to
  fill the remaining viewport and opens a large empty gap between the form's
  actions and the next section. `flex-1` is only for a form that is the last
  thing on the page.
- **A form whose page continues below it keeps its Save inside its own
  section**, not in a page-level `SettingsActions` row — a full-width actions
  bar reads as "end of page" and strands whatever follows. Disable Save until
  the form is dirty. Reserve the trailing `SettingsActions` row for pages where
  the form *is* the page (`SlashCommandForm`). Leave that section's default
  bottom border in place: it is what visually separates it from the next
  section. Only the last section on the page drops it (`border-b-0 pb-0`).

A settings detail page keeps its own Delete and Cancel even when the owning list
row already offers `⋯` → Delete and the header has a back link (OS-1793 product
call). Someone who opened a record to edit it should be able to finish there —
delete it, or back out — without navigating up to the list. Reference:
`SkillForm`, `SlashCommandForm`: Delete on the left of `SettingsActions`, Cancel
next to Save.

## Settings Edit Pages

Settings edit pages should share one visual system across organization, project, and user settings. The shared primitives live in:

```txt
apps/web/components/custom/settings-layout.tsx
```

Use these components for new settings edit pages:

- `SettingsPageContainer`
- `SettingsPageHeader`
- `SettingsSectionHeader`
- `SettingsTwoColumnSection`
- `SettingsFormGrid`
- `SettingsActions`

### Page Container

Use `SettingsPageContainer` for the content wrapper.

The canonical settings content width is:

```tsx
mx-auto w-full max-w-4xl
```

Example:

```tsx
<SettingsPageContainer className="flex flex-1 flex-col gap-6">
  <SettingsPageHeader
    title="New prompt"
    backLink={{ href: promptsRoute, label: "Back to prompts" }}
  />
  {/* settings form */}
</SettingsPageContainer>
```

The page title and form should be inside this same container.

Nested create and edit routes should give `SettingsPageHeader` a `backLink`
to their owning settings list. Use a specific label such as `Back to prompts`
or `Back to agents`, not a generic `Back`, so the destination is clear before
the user follows it.

### Two-Column Sections

Use `SettingsTwoColumnSection` for edit forms with explanatory section copy on the left and controls on the right.

```tsx
<SettingsTwoColumnSection
  title="Details"
  description="Name the prompt and choose the slash command users will type."
>
  <SettingsFormGrid>
    {/* fields */}
  </SettingsFormGrid>
</SettingsTwoColumnSection>
```

The section owns:

- Responsive one-column to three-column layout.
- Left-side section title and description.
- Right-side content area.
- Bottom divider and section padding.

Do not wrap these sections in cards. Settings sections are page structure, not card content.

### Settings Form Grid

Use `SettingsFormGrid` inside a `SettingsTwoColumnSection` when the right side contains standard form fields.

It provides the canonical form spacing:

```tsx
grid max-w-2xl grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6
```

Use field spans to control width:

```tsx
<FormFieldExt className="sm:col-span-3" />
<FormFieldExt className="sm:col-span-2" />
<FormFieldExt className="col-span-full" />
```

Do not stretch fields just to fill a row. It is acceptable, and often preferable, to leave empty grid columns when fields should be visually shorter.

### Field Ordering

Group fields by workflow, not by implementation order. For example, on prompt edit pages:

1. Title and category on the first row.
2. Command key on the second row.
3. Description below the command key.
4. Feature toggles or checkboxes below the descriptive text.
5. Large content editors in a separate section.

### Settings Actions

Use `SettingsActions` for bottom form actions.

```tsx
<SettingsActions start={deleteButton}>
  <Button type="button" variant="outline" onClick={onCancel}>
    Cancel
  </Button>
  <Button type="submit" disabled={disabled}>
    Save
  </Button>
</SettingsActions>
```

Conventions:

- Destructive or secondary context actions go on the left via `start`.
- Cancel and primary save/create actions go on the right.
- Keep the footer outside the last `SettingsTwoColumnSection` so the section divider stays above the action row.

## Lists And Empty States

Use the shared empty state component when a page has no entities to show.

### Empty states

Every page-level or section-level "nothing here yet" state uses one pattern.
The reference is Watch Tower's empty state (`watch-tower-page.tsx`).

- Render it with `EmptyState` from `components/custom/empty-state.tsx`:
  `icon` (a lucide icon, shown in a muted circle), `title`, `description`
  and `action`. It has no border and no background. The parts it is built
  from (`EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`) are
  internal, and lint flags importing them.
- Pass the create action as `action`, a `variant="secondary"` `Button`, and
  drop the toolbar's create button while the list is empty. Other content
  the empty state needs, such as a command to copy or templates to import,
  also goes in `action`; size it with `actionClassName`.
- Do not wrap it in a card, a bordered box or a dashed box.
- When the empty state is the whole page body, pass `fill` to center it
  vertically in the space below the page header. Every ancestor up to the
  page's flex column needs `flex flex-1 flex-col`; settings pages already
  give the section that chain. When other content sits above or below it in
  the same section, leave `fill` off so it stays top-aligned.
- Small empties inside dropdowns, pickers, comboboxes, command menus and
  popovers keep `EmptyMessage` or the picker's own empty slot. A "no search
  results" message inside a list may use `EmptyMessage` or
  `<Empty variant="dashed">` with the text as its only child.
- Tests can assert the pattern with `expectEmptyState` and
  `expectVerticallyCentered` from `test-utils/empty-state.ts`.

Conventions:

- Do not render empty sidebars, placeholder cards, or large plus cards when the list is empty.
- Show one clear empty state with a secondary action to create the first item when the user has permission.
- Hide category or filter navigation when there are no real categories or filters to show.
- Default list views should show all items unless the user has selected a specific filter.
- Put the primary create action in the page header or toolbar when the list has items. Do not add a large plus card to the list grid.
- Row state that has a value to show (a version, a count) is a compact badge on
  the trailing edge of the row, colored to carry the state: `outline` when
  normal, `destructive` when it needs attention. State with no value (sync
  pending, update available) is a small muted icon instead. Either way the
  wording lives in a tooltip and an `aria-label`, never as inline text next to
  the title — and the labelled element needs `role="img"`, since `aria-label` is
  ignored on a roleless `<span>` or `<div>` by several screen readers.
- A count beside a tab, toggle, or group label is plain muted text
  (`text-xs tabular-nums text-muted-foreground`), not a badge. A filled badge
  blends into a selected tab's background, and a bordered one reads as a
  separate control.
- For compact, scrollable picker menus, size the viewport so an overflowing
  menu shows part of the next row. The partial row is the visual affordance
  that more options are available; shared pickers should keep this behavior
  consistent across every surface that uses them.

## Loading States

Use `Skeleton` placeholders for loading states in product surfaces. Avoid plain
loading text in settings panels, lists, menus, and entity rows unless there
is no stable shape to represent. Where loading text remains (a full-screen
redirect spinner, a load-more row), end it with the `…` character, not three
dots: `Loading…`. Give a skeleton block an `aria-label` such as
`Loading threads` so tests and screen readers can find it.

An unknown URL or a `notFound()` call renders the app-level `app/not-found.tsx`.
An editor whose entity is missing renders `NotFoundState`
(`components/blocks/not-found-state.tsx`) with a Back action instead of its own
heading.

Skeletons match the final layout: use row skeletons for lists, form-field
skeletons for forms, and compact line/control skeletons for toolbars. This
keeps project settings popups and dense operational surfaces from shifting or
feeling unfinished while data loads.

Build a skeleton from the loaded UI, not from memory. Read the component it
replaces, or screenshot that component with real data filled in, then copy its
structure: the same toolbars, section headers, rows, and side panes, at their
real heights and inside the same containers. The PR reader's Diff skeleton
(`PullRequestChangesSkeleton`) is the example: the summary toolbar, file
sections with their header and a few code lines, and the Files pane. A single
`Skeleton` block standing in for a panel or tab is wrong, however short the
load.

A skeleton follows the same layout switches as the content it stands for. If
rows render as cards or as compact lines depending on a preference, the
skeleton reads that preference and draws the same row. A page that loads into
a split layout (list pane plus reader) skeletons both panes with their real
headers and tab rows, not one generic block. Test it: assert the skeleton's
shape in each mode (OS-2181's PR browser and reader).

Never swap a whole workspace for a skeleton when only one part of it is
reloading. If a surrounding shell (header, tabs, sidebar, toolbars) can render
from data you already hold, keep it mounted and skeleton only the part that is
actually fetching — a full-page skeleton on an in-app navigation reads as a
page reload. In the App Router this usually means hosting the persistent shell
in the **layout**, above the segment whose param is changing: the router keys a
dynamic segment by its param value, so rendering the shell from the page
remounts it (and every piece of workspace state) on each id change. Keep the
per-entity subtree keyed by that id so its own state still resets. The threads
page is the reference implementation (`ThreadWorkspace`, OS-1558; see
`docs/specs/thread-groups.md` → Rendering).

## Large Editors

Large text or MDX editors should usually live in their own section.

Guidelines:

- Keep the editor full width within its content column.
- Use a stable min height so loading and validation states do not collapse the page.
- Keep section labels simple. If the left section is titled `Prompt`, the field label can be `Content`.
- Do not place a large editor inside a decorative card unless the editor component itself needs a framed surface.
- Editor toolbars should stay single-row. When horizontal space is tight, move secondary actions into an overflow menu instead of allowing the toolbar to wrap and increase the editor header height.
- When a settings page constrains a large editor, offer a wider overlay editing mode instead of widening the whole settings page. The overlay should edit the same form value and still rely on the page's explicit save action.
- Full-height editor overlays need an unbroken flex column chain: the dialog body, editor frame, and editor root should all be `min-h-0` with the expanding layer using `flex-1`. Otherwise compact editor content can stop at its default min-height instead of filling the overlay.

## Component Reuse

Create or use shared layout components when the same structure appears across multiple screens:

- Page max width.
- Page title and description.
- Two-column settings sections.
- Standard form grid spacing.
- Bottom action row.
- Empty states.

Keep these local to the feature unless they are stable across multiple screens:

- Field ordering.
- Field spans.
- Domain copy.
- Validation messages.
- Data normalization.
- Editor configuration.
- Special-case permissions or disabled states.

The goal is consistency without making every form negotiate a generic schema of props.

### Color pickers

- Entity color selection uses `ColorPicker` from `@/components/custom/color-picker`.
- Pickers on the extended palette (`palette="extended"`) render as the standard
  8-column grid (three shade rows — the agent-editor layout). `ColorPicker`
  defaults to that grid for extended palettes; do not override `columns` for
  them.

### Mobile bottom sheets

- Mobile panels that slide up from the bottom use `MobileSheet`
  (`components/blocks/mobile/mobile-sheet.tsx`), a wrapper over the shadcn/vaul
  `Drawer`. Do not hand-roll a fixed-position panel: the drawer gives the top
  drag handle and swipe-to-dismiss users expect on touch.
- `MobileSheet` owns the app conventions: it reaches the bottom of the screen
  under the floating mobile nav bar, reserves that bar's clearance as trailing
  scroll space, and marks its body `data-vaul-no-drag` so vertical drags scroll
  content instead of closing the sheet.
- Use `body="fill"` when the content needs a pinned header/footer and owns its
  own scroll area (e.g. a picker with a search row); the default `body="scroll"`
  scrolls the whole sheet.
- Stacked sheets pass `nested` so vaul stacks them instead of fighting over the
  same layer.
- Dropdowns rendered inside a sheet must be `modal={false}` (see the
  nested-overlay gotchas in AGENTS.md).
- A dialog, sheet, or drawer blocks touch and wheel scroll outside its own
  DOM, and body-portaled menus sit outside it. `DropdownMenuContent` and
  `PopoverContent` already lift that lock with a non-isolating `RemoveScroll`;
  a hand-rolled `createPortal` menu that scrolls must do the same (OS-2198).

### Board (kanban) layouts

- `components/blocks/board/` holds the layout primitives shared by every board
  surface: `BoardLayout` (horizontal track, mobile scroll-snap gallery) and
  `BoardColumn` (header, card stack, optional create affordances,
  `headerActions` and `footer` slots). Both are generic over the item type and
  domain-free — build a new board by mapping data to `BoardColumnData[]`, not by
  copying column markup.
- The column header is a fixed height (`h-10`), not padding-sized: columns share
  one border line across the board, so a header that grew around its content
  (selection actions, a taller icon button) would misalign that line in one
  column only. `BoardSkeleton`'s header matches it, so loading doesn't shift the
  board.
- Columns are fixed-width (`md:w-80`) by default. Pass `BoardLayout`'s
  `fillWidth` (plus `className="md:w-full md:min-w-0"` on the column) to share
  the viewport evenly instead — only for a small, fixed column set.
- Equal flex shares do **not** give equal widths: `min-width: auto` floors every
  flex item at its own content, so the column with the longest title stays wider.
  Put one shared floor on the wrapper and `min-w-0` on everything inside it. The
  scroll container must not keep `min-w-max` in that mode either — it would size
  the track to the summed content and overflow the viewport.
- The *cards* are not shared across domains. `KanbanCard` is task-specific;
  Watch Tower's thread board has its own card. Extract the parts two cards
  genuinely share (a meta cluster, a status glyph) instead of generalizing one
  card to serve both.
- Omit per-card status on a board grouped by status — the column already says
  it. Only genuine sub-states inside a bucket earn a glyph.

### Mobile task lists

- Group headers and creation footers span the content width without gaps
  between adjacent headers. Use normal card insets and a compact creation
  inset on mobile; desktop tree indentation does not carry over.
- Below subtask cards, use an always-visible muted plus and transparent
  `Add task...` input, matching the board's create row. Avoid a boxed field
  or hover-only visibility for this affordance.

- Mobile list surfaces render tasks as the shared `KanbanCard`
  (`components/blocks/tasks/kanban-card.tsx`) instead of table rows — see
  `docs/specs/mobile-task-list.md`. Do not fork the card or build a separate
  mobile card component; wrapper concerns (tap target, drag attributes,
  selection/drop styling) belong on a wrapper element around the card.
- When a card must support the table's long-press drag, render `KanbanCard`
  without `onClick` (its `role="button"` body would be treated as an
  interactive target and block the drag) and put the tap handler on the
  wrapper.

### Thread status glyphs

- Any surface showing a thread's state renders `ThreadStatusIndicator`
  (`components/blocks/thread/thread-status-indicator.tsx`) rather than its own
  spinner/dot switch. It is the glyph counterpart to `THREAD_STATUS_META`
  (`lib/threads/status-meta.ts`), which owns the *words*: both were extracted
  after three surfaces' copies had already drifted on tooltips and wording.
- A surface on its own palette or its own status union may keep a local dot
  (`AgentThreadWorkStatusDot` does, for the task's agent-work entries) — but it
  must still take its *wording* from `THREAD_STATUS_META`, which is where the
  drift actually hurts.
- Derive the status through `getThreadDisplayStatus`
  (`lib/threads/display-status.ts`) rather than reading `status` raw — a run
  parked on an approval is `streaming` on the row but reads as waiting to the
  user, and an acknowledged failure reads as settled.
- Surfaces differ only through props (`resting`, `showDoneCheck`): a column of
  rows wants `resting="placeholder"` so it doesn't reflow as threads settle,
  and a surface that sizes its own slot wants `resting="blank"`. Add a prop
  rather than a second implementation.

### Status glyphs in measured rows

When a status glyph sits in a container whose layout is *measured* (an overflow
cut, a virtualized row, anything reading `offsetWidth`), give it a slot whose
width does not depend on the status — either a fixed-size box or paint it
absolutely into padding widened to hold it (the group tab strip: a tab with an
indicator widens its leading padding and centres the glyph in it). Size that
padding wider than the glyph itself — flush against the adjacent content, an
indicator reads as part of it rather than as a status. A glyph in normal flow resizes
its container when the status changes, which silently invalidates measurements
taken on a different signal. In unmeasured surfaces (menu rows, cards) render it
in flow as usual.

## Browser-Local Preferences

Client-only UI state (collapse flags, view prefs, remembered selections, cached
scan results) persists through `lib/browser/local-storage.ts` — never through
`window.localStorage` directly:

- `readLocalString` / `writeLocalString` for scalar values, `readLocalJson` /
  `writeLocalJson` for structured payloads, `removeLocalValue` to clear a key.
- The helpers own the SSR guard and the fail-soft `try/catch` (quota, private
  mode, security policies), so callers must not re-add either. Reads fall back
  to `null`/`undefined`; writes return `false` instead of throwing.
- `readLocalJson` returns `unknown` on purpose: narrow persisted payloads with
  a type guard (`isRecord` and friends from `@/lib/type-guards`) rather than
  casting, because stored data is untrusted and may predate the current shape.
- Give each preference a small named module that owns its storage key and
  exposes intent-named read/write functions (e.g. `lib/threads/group-last-tab.ts`,
  `lib/routing/last-org-storage.ts`). Components should not repeat raw keys —
  a key duplicated across call sites is a module waiting to be extracted.

## Read-only roles

Gate writes with the `useProjectPermissions` flags and follow [read-only-viewer-ux.md](../specs/read-only-viewer-ux.md):

- Hide primary create actions, drag affordances, and destructive items.
- Keep field editors and meaningful menu items visible but not editable, with `readOnlyReason` as a native `title`. Render the value as plain text so it stays legible, not greyed out.
- Treat a loading role (`myRole === undefined`) as read-only.
- Leave filters, sorting, search, selection, and per-user preferences interactive.

## Accessibility And Interaction

- Prefer native controls and shadcn primitives.
- Icon-only buttons need an accessible name through visible text, `aria-label`, or a tooltip pattern already used in the app. `TooltipExt` names a trigger after its tooltip when the trigger has no text, `aria-label` or `aria-labelledby`. Give an explicit `aria-label` anyway when the name should differ from the tooltip, for example to include the row's name (`"{name} actions"`).
- A control hidden until hover (`opacity-0 group-hover:opacity-100`) must also appear on keyboard focus: add `focus-visible:opacity-100` on the control, or `group-focus-within:opacity-100` (`group-focus-visible` when the group itself is the focusable element).
- A status shown only by an icon or color, such as an availability check, needs text for screen readers: an `sr-only` span inside a `role="status"` wrapper.
- Labels should be connected to inputs through `FormFieldExt`, `FormLabel`, `htmlFor`, or accessible wrapper labels.
- Validation messages should be associated with the input where practical.
- Keyboard and pointer behavior should match the control. A clickable label that toggles a checkbox should have `cursor-pointer`.

## Verification

Before finishing frontend changes:

- Run focused tests for the component or page changed.
- Run `pnpm web:lint`.
- Run `cd apps/web && npx tsc --noEmit`.
- For visible layout changes, visually verify in the running app when possible. Do not start a new dev server; use the existing app server or ask for visual verification if it is not running.

## Cost displays

Use `describeCost` from `lib/costs/cost-summary.ts` for aggregate cost labels and
explanations. Preserve known amounts alongside missing pricing; never display
all-unpriced usage as free. Keep source qualifiers small next to the numeric
amount and make their meaning accessible without relying on color or a symbol.
Use `canCompareCosts` before displaying a spend percentage. Charts must retain
daily coverage and authoritative totals when model allocation is incomplete.

Thread/task cost indicators show estimate wording only in the popover's top
total. Keep the closed trigger and model rows compact. Do not repeat pricing
explanations or snapshot identifiers in this popover; retain only short
coverage notices when usage is unpriced or incomplete.

### Terminal browser navigation

Keep the connection sidebar visible when opening a conversation in the main
panel. Enter on a project sidebar row focuses its content panel. Escape returns
to the previous browser view and selection. Resizing must
not reset inspection state or interrupt exports.

Terminal forms use Left/Right to move between adjacent action buttons while text
inputs keep caret movement. Use dropdowns with named options and explanations
for workspace setup choices; do not cycle unexplained modes with Space.

Size terminal forms to their fields and compact spacing before hiding inputs.
When fields still overflow, show the visible range and explicit PageUp/PageDown
navigation. Do not make Tab the only advertised way to reveal hidden fields.
Repository URL inputs need a plain label and a concrete example.

Terminal environment setup must show its Internet access policy explicitly. Show
advanced allowlist settings only for Restricted access and repeat the policy in review.

Terminal Stop and Delete environment flows keep progress and results in the compact
confirmation popup. Do not switch them to a full-width panel after confirmation.

Task-list group headers match standard task-row height and expand-control size.
Use one standard "Add task..." row at the end of each expanded group, without
a header add button or global creation footer. Indent grouped task content by
one tree level visually while keeping metadata columns aligned.

Task-view settings use grouping icons for the current layout. Keep List/Board
switching in the page header. Label list grouping "Group by" and board column
grouping "Columns by"; show "Rows by" separately when row grouping is available.
