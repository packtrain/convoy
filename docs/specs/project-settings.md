# Project Settings Specification

This document defines user-visible project settings behavior.

## Location & Navigation

Project settings live at dedicated routes, mirroring organization settings:

```
/o/{organizationSlug}/{projectAlias}/settings/{section}
```

On desktop, entering a settings route swaps the app sidebar into a settings
subpage (collapsed icon rail + expanded section list) via the shared
`SidebarSplitLayout` / `SidebarSubpage` components. The subpage title is
"Project settings" and its back arrow returns to the project's default view.
On mobile, sections are reached through the settings drawer in the page's
mobile nav bar. Unknown section slugs 404 (`isProjectSettingsSection` guard).

The route shell owns the page title: on desktop it renders the section label
and its description (`PROJECT_SETTINGS_SECTION_CONFIG`) through
`SettingsPageHeader`, and section components render no heading of their own.

Entry points (project row actions menu, project header settings dropdown,
mobile toolbar) navigate to the corresponding section route rather than
opening a dialog: Settings → `general`, Add members → `members`,
Agents → `agents`.

The primary project settings sections appear in this order:

1. General
2. Members
3. Agents
4. Prompts
5. Skills
6. Workflows
7. Lists
8. Labels
9. Checks
10. Worktrees
11. Customization

A "Usage" section follows the primary sections and renders the project usage
dashboard inside the settings shell (it is no longer a link out to a separate
page). A "Danger zone" section is listed last. The legacy
`/o/{organizationSlug}/{projectAlias}/usage` route redirects to
`.../settings/usage` for bookmark compatibility. Dev-mode-gated sections
(Templates, Recurring Tasks, Automations, Integrations, Import & Export)
are hidden unless the `extraProjectSettings` dev setting is enabled, and
render as disabled nav entries under [`Show unfinished items`](user-settings-developer-section.md#unfinished-items).

A section with nothing to list (Agents, Prompts, Skills, Workflows, Labels,
Usage) renders the shared empty state
(`docs/guidelines/frontend-development.md#empty-states`) centered in the space
below the page header, with the create action inside it.

## General Settings

Project general settings include the project name, optional description, and
optional project color.

When creating a project, the UI suggests a project alias from the project name.
Generated aliases must contain only uppercase letters and numbers, must start
with a letter, and must be 2-5 characters. Name separators and punctuation
such as `/` are treated as word boundaries and must not appear in the generated
alias.

General settings also include the project `Default view` (List or Board),
`Default list grouping` and `Default board grouping` (columns and rows). They
are the project-wide fallback only: individual Lists can override them from
the List create/edit dialog, and a List override wins. See
[task-kanban-status-columns.md](task-kanban-status-columns.md) → Default View.

The General page has one Save row at the bottom. It saves the changed form
fields and a changed project key together, and stays disabled until something
changed and the key is valid. A key change then redirects to the new alias.

Project color is UI identity metadata used in project navigation and related
project surfaces. It does not affect project permissions, task ordering, task
search, or API key scope.

When set through public mutations, project color must be one of the supported
default palette values selected by the UI:
`#ef4444`, `#f97316`, `#eab308`, `#84cc16`, `#22c55e`, `#14b8a6`,
`#06b6d4`, `#3b82f6`, `#6366f1`, `#8b5cf6`, or `#ec4899`.

Passing `null` clears the project color. Omitting the color field preserves the
existing project color.

## Members

The Members section lists the project's `projectMembers` rows — the complete set
of people with access (OS-1536) — with role changes and removal for anyone
holding `project_members:add` / `project_members:remove`. Org owners and admins
appear only when they hold a row, listed by that project role like anyone else.

The same section component is reused by the Organization Settings → Projects
edit subpage (see
[organization-membership.md](organization-membership.md)). Its `canManage` prop
overrides the project-role check for callers whose authority is org-level
(`projects:manage_all`) and therefore invisible to `projects.members.getMyRole`.
The section renders no heading; the enclosing page provides it. Every mutation is re-checked server-side;
`canManage` only controls what the UI offers.

## Prompts

Project settings include a `Prompts` section for project-scoped Slash commands.
Project prompts use the same Slash command entity and editor patterns as
organization prompts, scoped to the current project. Scope rules, key
collisions, composer badges, typed-key precedence, and permissions are
specified in [slash-commands.md](slash-commands.md).

## Workflows

The always-available Workflows section lists the project's Workflow definitions
with search, create, rename, and soft delete, grouped by category through the
same category sidebar as Skills and Prompts. Members with task write access
(`task:update`) manage workflows; viewers browse the list without write
affordances. The editor at `settings/workflows/{new,workflowId}` is
full-width (no boxed settings section): the identity fields (name,
description, category, palette color, plus the definition's "Run in a new
worktree" toggle) stack in a narrow left column beside the Stage × Lane
grid (OS-1810). The grid edits the draft's structure — add, inline-rename,
and remove Lanes and Stages; removing a Lane drops its Steps in every
Stage. Deleting a Lane or Stage that holds Steps asks for confirmation
first; empty ones delete in one click. One Save persists identity and
definition atomically (create sends the definition with the create
mutation).

Each grid cell offers a hover-revealed "Add step" dropdown (hidden at the
50-steps-per-Stage cap) offering Prompt, Wait, and Bash. Wait has no
config, so picking it drops the step into the cell directly — no dialog.
Picking Bash opens the step config dialog (script, timeout in minutes
defaulting to 10, and a three-state result-handling select: always report
to the agent, report on failures — the default — or stop on failure). In a
Parallel Lane the select is locked to stop on failure with a note saying
why — the Step's one-shot thread has no agent to report to; Save
normalizes a Step dragged into a Parallel Lane the same way.
Picking Prompt (OS-1812) opens the same dialog with the real thread
composer in config mode — the project-agent automation form's reuse — so
slash-command references survive as references (expansion stays at normal
send time). Prompt steps have no name field: the card renders the prompt
text, with slash-command references shown as their labels.

The Prompt composer's selectors follow the Lane override rules
([workflow-data-schema.md](workflow-data-schema.md) → Lane and override
rules), applied by one shared reconcile function on every save and
cross-Lane-type drag. In a single Lane — one thread, configured once on
the Lane — the CLI/model selector is not shown at all; the mode selector
(scoped to the Lane's runtime) is the only override, stored bare. In a
Parallel Lane — one thread per Prompt — the full selectors, Project agent
included, edit the step's overrides, and every save pins a concrete
runtime so the step always resolves one at version cut. A new Parallel-Lane
Prompt opens on the CLI, model, and effort of the Lane's last Prompt step in
grid order (last Stage, last card) — the Lane's "last used" — and, when the
Lane has no Prompt yet, on the remembered last-used selection from local
storage like any new-thread composer (OS-1892; see
[cli-thread-model-selection.md](cli-thread-model-selection.md) →
Persistence and Resolution Rules). Mode and Project agent are not seeded.
Editing an existing Prompt shows its stored overrides. Saving in a
single Lane also sheds runtime, model, effort, and Project-agent
overrides a Lane-type move left behind. The card shows the overrides under
the same rule: only a mode pill in a single Lane; in a Parallel Lane, the
runtime rendered as the Lane header's trigger renders it — CLI icon, then
the model (the runtime's name when no model is set), then the effort
muted — followed by the mode pill (the Project-agent override is not
shown).

Each Lane header holds the Lane's settings inline — no dialog. The name
stays the header's inline rename input. Next to it sits one dropdown, the
composer's CLI/model menu extended at both ends: "Parallel" is the first
item, and below the runtime list a single Lane gets mode and Project-agent
submenus (each submenu trigger is the current selection itself; the agent
submenu hides when the project has no agents and the Lane stores no agent —
a stored id whose agent was deleted keeps the submenu, reading "Unknown
agent", so it stays clearable; a Parallel Lane, storing no defaults, gets
neither) and a destructive "Delete lane" item — the header
has no separate delete affordance. The trigger reads "Parallel" for a
Parallel Lane and the Lane's runtime/model otherwise; picking a runtime,
model, or effort makes the Lane single with that choice pinned into its
defaults, and while the Lane is Parallel nothing in the runtime list
renders as selected. The menu is a settings surface: picks keep it open,
and it closes only on an outside click or Delete lane (which still
confirms first when the Lane holds Steps). Any type flip moves the
runtime settings in the same edit rather than silently at Save: to
parallel, the Lane's defaults (runtime, model, effort, mode, Project
agent) move onto each of its Prompts, a Prompt's own mode winning over
the Lane's; to single, each Prompt's overrides reduce to mode — so the
cards' pills change immediately, and neither flip can produce an
unsaveable draft. Save normalization enforces the same rules
server-side.

Clicking any card opens the dialog to edit its properties (an optional
name for Wait and Bash, plus the type's config) or delete the Step — a
Step's type is fixed at creation and cannot be changed by editing. The
dialog's Delete button deviates from the destructive-actions guideline (no
Delete in dialog footers) on purpose: it removes a row from the unsaved
local draft, the same one-click weight as the lane and stage trash
affordances, not a persisted record. Prompt and Bash cards keep a minimum
card height with their pills bottom-aligned; Wait cards stay compact. A
Bash card uses the blue exec accent from the action catalog (Wait is
amber): a terminal icon beside its name when set (the script preview
otherwise), and blue chips for the timeout and the report mode. The name
sits above the chip row — a long name in the chip row broke the layout.

Step cards also drag: they drag-and-drop between cells (any Stage × Lane)
and reorder within a cell, with the kanban board's mechanics — pointer
drag with a click-safe activation distance, long-press on touch, edge drop
lines between cards, and a highlighted cell body for "append here"
(OS-1820). A cross-stage drop into a Stage at the 50-step cap is refused;
a Stage at the cap can still reorder its own cards. A drop into a Lane of
the other type reconciles a Prompt step's overrides to the destination's
rules (shedding or pinning as above). Dragging follows the
other grid edits: local-draft only until Save, disabled while a Save is in
flight, absent for viewers.

The grid is flush against the identity column, top, and bottom like a
kanban board, with a sticky header row. Add lane / Add stage hide at the
server caps, and grid edits are disabled while a Save is in flight. The
create editor opens seeded with a starter Lane and Stage; an empty stored
draft is seeded the same way for members who can save, while viewers see
the stored draft as-is, read-only.

The editor edits local state reconciled only by Save, so leaving it is
guarded once anything differs from what was loaded — an identity field or
a definition change, compared after the Save normalization so a
whitespace-only rename doesn't count. Reload, tab close, and off-site
navigation get the browser's own prompt; an in-app link click is swallowed
and answered with an "Unsaved changes" dialog offering Stay or Leave
without saving. Viewers and a Save already in flight are never guarded.
Browser Back inside the app is not covered — the App Router exposes no
hook for it. Concurrent editors remain last-write-wins. The
editor routes re-apply the section's dev gate (deep links redirect to General while gated) and treat
a workflow belonging to another project as not found. Data model and
validation rules are in
[workflow-data-schema.md](workflow-data-schema.md).

## Worktrees

The Worktrees section holds one bash setup script per repository. The CLI runs
it in every worktree it creates for that repository, before the agent starts.
How and when it runs, the approval rule, and the script environment are in
[cli-worktrees.md](cli-worktrees.md#worktree-setup-scripts).

- Members with `cli:thread` see the section. For viewers it is hidden and its
  route blocked, like the other permission-gated sections.
- One row per repository, shown as `owner/repo`: every repository that has a
  script, plus the repositories of the caller's own CLI paths that have none
  yet. A row with a script reads "Last edited by <name>, <time>"; one without
  reads "No setup script".
- Clicking a row opens the script in a monospace editor, with the three
  environment variables listed under it and an example as placeholder text.
  Save stays disabled while the script is empty or unchanged. Remove confirms
  first and deletes the script.
- A row whose current revision the caller has not approved adds "Not approved
  by you". An admin who opens it can press Approve without editing: it saves
  the unchanged text, which keeps the revision and records their approval.
  Teammates without `project:update` get their own Approve button in OS-2573.
- Only `project:update` holders (project admins) can save or remove. Everyone
  else opens the editor read-only, under a notice that only project admins can
  edit setup scripts.
- With no repositories, the empty state says a repository appears once one of
  the caller's CLIs connects a path with a Git origin.
- While loading, the page shows skeleton rows in the same list frame.

## Danger Zone

The Danger zone page shows the shell's "Danger zone" title and "Actions that
cannot be undone." above one bordered row per action. The organization renders
the same rows in a two-column "Danger zone" section of its General page. Both
render rows through `SettingsDangerRow` (`components/custom/settings-layout.tsx`).

The section opens for members with the org `project:delete` permission (owners
and admins) or the project `project:archive` permission (project admins). The
layout redirects anyone else to General. Project delete is an org permission,
so a project role cannot grant it, and Delete stays disabled for a project
admin who is only an org member.

- **Archive project** archives the project, and **Unarchive project** reverses
  it. Both confirm first and stay on the page. Rules are in
  [project-archive.md](project-archive.md).
- **Delete project** opens a confirmation dialog naming the project. Confirming
  calls `projects.core.remove`, the mutation the org Projects section and the
  sidebar row menu use, then replaces the route with the organization home,
  which redirects to a remaining project or shows the empty state. Back does not
  return to the deleted project's settings. The dialog keeps the project name
  while the delete runs. A failed delete shows the error toast and stays on the
  page. The button is disabled until the caller's org role is known to allow it.
