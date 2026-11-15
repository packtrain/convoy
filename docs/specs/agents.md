# Agents

## Scope

This document defines v1 Agent templates, Project agents, and task delegation to Project agents.
V1 does not start agent executions, bind agents to local/cloud runners, or change comment/artifact/activity attribution beyond task assignee-change and delegation-change details.

## Tracking Tasks

- OS-1035: v1 Agent assignment foundation.
- OS-1036: backend Agent and Project-agent model.
- OS-1037: typed task assignees.
- OS-1038: settings and Project-agent management UI.
- OS-1039: task assignee UI, filtering, and MCP support.
- OS-1335: assignee/delegation split (human owner vs executing agent).
- OS-691: revised Assignee vs Attribution planning context.

## Terms

- **Agent**: an organization-owned work actor template.
- **Project agent**: an editable project-local copy of an Agent, or a project-local agent created without an Agent source.
- **Agent prompt**: an optional reusable working prompt stored on an Agent or Project agent. Runtime delivery to CLI threads is specified in `cli-thread-agents.md` (OS-1138).
- **Agent appearance**: the visual identity of an Agent or Project agent.
- **Assignee**: the human user accountable for a task. Always a user, never an agent.
- **Delegation**: the Project agent currently executing a task (`delegatedToAgentId`). Delegation is how work gets executed; it never transfers ownership.

The canonical glossary is `CONTEXT.md`.

## Organization Agent Templates

- Organization Agent templates belong to one organization.
- Organization Agent templates are managed from organization settings.
- Organization owners and admins can create, edit, and delete organization Agent templates.
- Organization members who are not admins cannot manage organization Agent templates.
- Agent templates include:
  - `name`
  - optional `description`
  - optional `prompt`
  - optional `category` string
  - `appearance`
- `appearance` groups visual identity fields:
  - `color`
- `appearance.color` must be one of the supported extended Agent palette colors.
- Agent avatar rendering is derived by the UI from the Agent name initials and `appearance.color`.
- V1 does not store avatar uploads or icon names for Agents.
- `instructions` is not the product term; use `prompt`.
- `prompt` is markdown authored through the shared MDX editor. Saving strips
  trailing whitespace from every line, including the `&#x20;` character
  references the markdown serializer emits in place of it, so consumers that
  read the prompt as plain text never see an escape. See
  `slash-commands.md` for the same rule on Slash command `content`.
- `category` is a single optional string in v1, not a category table and not tags.
- Active Agent template names are unique per organization after trimming,
  whitespace normalization, and case normalization.
- Duplicate Agent template name errors identify the colliding active Agent
  template display name.
- Deleting an Agent template removes it from normal catalog lists.
- Deleting an Agent template is a soft delete and does not block reusing the
  same name for a new Agent template.
- Existing Project agents copied from a deleted Agent template continue to exist and use their copied fields.
- If a Project agent's source Agent can no longer be resolved, source/provenance surfaces fail soft with a deleted-source placeholder.

## Project Agents

- A Project agent belongs to one project.
- A Project agent can be created by copying an organization Agent template.
- A Project agent can also be created directly inside a project without an Agent source.
- `sourceAgentId` is optional.
- Copying an Agent template snapshots its user-visible/configuration fields into the Project agent:
  - `name`
  - `description`
  - `prompt` if present
  - `category`
  - `appearance`
- After creation, the Project agent owns those fields locally.
- Editing an organization Agent template does not automatically update existing Project agents.
- V1 has no automatic or manual promotion from Project agent back to organization Agent template.
- Project admins and project members with `ProjectPermission.AGENTS_MANAGE` can
  create, edit, and delete all Project agents in that project.
- Project viewers cannot create, edit, delete, or assign Project agents.
- Organization owners/admins get Project-agent access from their own `projectMembers` row like anyone else; org role alone grants none (OS-1536).
- A Project agent is not a project member and carries no project permissions.
- Active Project-agent names are unique per project after trimming, whitespace
  normalization, and case normalization.
- Duplicate Project-agent name errors identify the colliding active
  Project-agent display name.
- Deleted Project agents are hidden from normal project-agent lists and new delegation selection.
- Deleting a Project agent is a soft delete and does not block reusing the same
  name for a new Project agent.

### Template Versions and Refresh (OS-1759)

- Every Agent template carries `version: number`, starting at 1 and bumped
  whenever a save changes a stored value. A save that submits identical values
  changes nothing and does not write, so it never advertises an update to
  installed copies. Deleting a template does not bump it either.
- A Project agent copied from an Agent template records the template version it
  carries in `installedVersion`. Copying under a different name (the template
  dialog's `Create with new name` resolution) also sets `locallyEdited: true`,
  so a later refresh cannot silently rename the copy back.
- Rows written before versioning count as version 1: templates report 1 to
  clients, and a copy with no `installedVersion` displays v1 and reads as up to
  date until its template is saved again.
- Changing a template-owned field of a copied Project agent (`name`,
  `description`, `prompt`, `category`, `appearance`) sets `locallyEdited: true`.
  Re-submitting the same values does not, nor do project-local fields
  (`automation`) or Project agents without a `sourceAgentId`.
- An update is available when the source template's version is greater than the
  copy's `installedVersion`. A copy whose source Agent can no longer be resolved
  never reports one.
- Refreshing a copy is `replaceFromAgent`: it overwrites every template-owned
  field, sets `installedVersion` to the template's current version, and clears
  `locallyEdited`. The template dialog's `Replace existing` conflict choice is
  the same mutation and has the same effect.
- Local edits are never overwritten implicitly. `replaceFromAgent` enforces this
  itself rather than trusting the caller's view of the row: it rejects a copy
  that may hold local work unless the caller passes `overwriteLocalEdits`, which
  only the two paths carrying an explicit user decision do — the refresh
  confirmation and `Replace existing`.
  - A copy may hold local work when it is `locallyEdited`, or when it has no
    `installedVersion` at all: nothing is known about how such a copy diverged,
    and unknown provenance counts as edited because the guarantee is about not
    losing text.
- Refresh always confirms first, clean copy or not (OS-1805): it replaces the
  copy's content wholesale and cannot be undone. The confirmation names the
  fields the template replaces, the target version when the template is ahead,
  and the loss of local edits when the copy is `locallyEdited` or predates
  versioning. The dialog is the consent, so the mutation is always called with
  `overwriteLocalEdits`.
- The same mutation is the way back for a copy the project edited: a copy that
  may hold local work whose template is **not** ahead offers a reset, which
  reinstalls the template's current content over the local one. Same overwrite,
  same confirmation, no separate code path. A clean copy that is already current
  has nothing to fetch and nothing to reset, so it gets no action at all.
- Agent rows carry a compact `vN` version badge (see UI Placement) — the
  template's own version on Agent-template rows, the `installedVersion` on
  copies. Project agents without a `sourceAgentId` have no template to version
  against and show no badge.
- There is no field-level merge and no version history; refresh is the only
  resolution, whether it moves the copy forward (`Update`) or back (`Reset`).

### Importing Project Agents from Another Project

- A Project agent can be created by copying an existing Project agent from
  another project (`copyFromProjectAgent`).
- Importing requires `ProjectPermission.AGENTS_MANAGE` on the target project
  and at least `ProjectPermission.PROJECT_VIEW` on the source project.
- The source project may belong to a different organization; only the user's
  access to both projects matters.
- The copy snapshots `name`, `description`, `prompt`, `category`, and
  `appearance`. The imported Project agent owns those fields locally and keeps
  no provenance link to the source Project agent (`sourceAgentId` stays unset,
  even if the source was itself copied from an organization Agent template).
- Deleted source Project agents cannot be imported.
- Imported names follow the normal Project-agent name uniqueness rules; the
  mutation accepts an optional `name` override for conflict renames.

## Task Assignment and Delegation (OS-1335)

- Tasks carry two independent optional fields:
  - `assigneeId: v.optional(v.id("users"))` — the human owner, the person
    accountable for the task.
  - `delegatedToAgentId: v.optional(v.id("projectAgents"))` — the Project
    agent executing the task.
- Mental model: the assignee is the human accountable for the task;
  delegation is how work gets executed; an agent never owns a task.
- The fields are independent:
  - Clearing delegation keeps the assignee.
  - Changing the assignee keeps the delegation.
  - Ownerless delegated tasks are allowed. They count as "unassigned" in
    owner-based filters while sitting in agent kanban columns — expected
    behavior.
- **Auto-set-owner rule (server-side, canonical)**: when a mutation sets
  `delegatedToAgentId` to a non-null value and the task would have no
  `assigneeId`, and the same call did not explicitly pass `assigneeId`
  (including `assigneeId: null`, the escape hatch that keeps a task
  ownerless), the acting user becomes the owner. This applies to create,
  update, and bulk update, for web UI, MCP, and CLI callers alike.
- Public task reads return hydrated details for both fields:

```ts
assignee:
  | { type: "user"; userId; name; avatarUrl }
  | null;
delegatedToAgent:
  | { type: "projectAgent"; projectAgentId; name; appearance: { color }; isDeleted }
  | null;
```

- MCP task tools use the same split shape (`assigneeId` /
  `delegatedToAgentId` params, `assignee` / `delegatedToAgent` output) — see
  `mcp-server.md`.
- Delegating a task to a Project agent does not start an Agent execution.
  Delegation automation (OS-1094) can open a prefilled thread composer on
  interactive web-UI delegation, but nothing runs until the user sends — see
  `agent-automation.md`.
- Task create/update flows validate that a delegated Project agent exists, is
  not deleted, and belongs to the task's project.
- Removing or deleting a Project agent from future selection does not clear existing delegations.
- Existing stale Project-agent delegations follow the current user-assignee pattern:
  - normal selector option queries exclude removed/deleted agents
  - task reads preserve the stored delegation
  - task hydration returns the best available display metadata or a deleted-agent placeholder
- User assignees are the project's explicit members; an org owner/admin appears only if they hold a `projectMembers` row (OS-1536).

### Legacy typed assignee (removed)

- The previous model (OS-1037) stored a typed union on `tasks.assignee` plus a
  derived `assigneeKey`. Both were migrated onto the split fields
  (agent-assigned rows became ownerless delegated tasks) and removed from the
  schema; only stored activity rows still carry the old typed shape.

## Assignee Discovery and Filtering

- Task assignee selectors show users and Project agents in one combined
  control with `Agents` and `People` sections:
  - The searchable selector focuses its search field when opened and filters
    assignment actions, users, and Project agents by their visible labels.
  - `ArrowDown` and `ArrowUp` move through enabled results; `Enter` and `Space`
    select the focused result.
  - Picking a person sets the owner (`assigneeId`).
  - Picking an agent sets delegation (`delegatedToAgentId`); the owner is
    auto-set if empty and kept otherwise.
  - The selected agent can be deselected via a `Clear delegation (<name>)`
    row, or by clicking the selected agent again.
  - `No assignee` clears the owner only.
  - The current owner and the delegated agent both show a trailing check.
- Cell display: when both fields are set, avatars stack — the delegated
  agent in front (it executes), the owner small behind — with an
  executor-first display name of `Agent · Owner`.
- The selector does not create Project agents inline in v1.
- A task or project management surface may link to the Project agents management UI.
- Task assignee selector group headers include a compact add action when the
  surface can open project settings: `Agents` opens project settings on
  `Agents`, and `People` opens project settings on `Members`.
- The `Agents` selector group remains visible even when no Project agents
  exist; in that empty state, the first row is `Add an agent`.
- Task assignee selectors should not duplicate those group actions in a footer.
- Filtering distinguishes the two dimensions:
  - "My tasks" and user filter options match the OWNER (`assigneeId`) —
    delegated tasks still show for their owner, which is the point of the
    feature.
  - Agent filter options match the delegation (`delegatedToAgentId`).
  - "No assignee" means no owner; ownerless delegated tasks match it.
- The kanban Board groups by executor (`delegatedToAgent ?? assignee`), so
  delegated tasks sit under agent columns — see
  `task-kanban-status-columns.md`.
- MCP search and filtering use `filters.assigneeId` (owner) and
  `filters.delegatedToAgentId` (delegation) — see `mcp-server.md`.

## Task Activity

- `assignee_changed` activity is user-only: it records changes to the human
  owner.
- Delegation changes are recorded by a dedicated `delegation_changed` event
  with changeDetails
  `{ type: "delegation", oldAgentId?, oldAgentName?, newAgentId?, newAgentName? }`.
- Legacy stored agent-assignment activity rows (typed Project-agent assignee
  values) still validate and render.
- The user who performed the change remains recorded through the existing activity actor field in v1.
- Broader attribution changes for comments, artifacts, attachments, and activity actors are deferred.

## MCP

- MCP task create/update tools support the split assignment model with
  `assigneeId` (human owner) and `delegatedToAgentId` (executing agent); the
  legacy typed `assignee` object param is removed and rejected (see
  `mcp-server.md`).
- MCP project-agent discovery and management tools should exist when needed for non-UI workflows.
- MCP Project-agent v1 management includes `list_project_agents`,
  `create_project_agent`, and `update_project_agent`; delete, copy from
  organization Agent template, and execution-starting tools are out of scope.
- MCP support for starting Agent executions is out of scope for v1.
- MCP documentation must be updated with the split assignment shape and any new Project agent tools.

## CLI

- The one-shot CLI mirrors MCP Project-agent management with
  `project-agents list`, `project-agents create`, and
  `project-agents update <projectAgentId>`.
- Commands call the public Convex Project-agent APIs directly; they do not use
  MCP transport.
- CLI create/update supports name, description, prompt, category, appearance
  color, and assignment automation.
- Providing automation replaces the complete automation value, matching MCP.
  Explicit clear flags send `null` for nullable fields.
- Delete, template import, cross-project import, and execution-starting
  commands remain out of scope.

## UI Placement

- Organization Agent templates live in organization settings under Agents.
- Organization and Project agent create/edit headers include a `Back to agents`
  link to the owning settings list.
- Organization Agent templates render as list rows, not grid cards. Each row
  shows the agent name and description/preview on the left, category as a badge
  on the right, and a `...` actions menu with `Edit` and `Delete` for
  organization owners/admins. The row is a link to the detail/edit route, so
  middle-click and modifier-click open it in a new tab; the menu's `Edit` is the
  same link.
- Project agents live in project settings under AI Agents.
- Both lists carry the same category navigation as Prompts and Skills: a sidebar
  of the categories present in the list, hidden when every item is
  uncategorized (OS-1837).
- Project-agent rows link to edit from the editable row surface, and their row
  actions menu exposes `Edit` as the same link plus destructive deletion when
  permitted. Rows that open a dialog instead (template preview, import) stay
  buttons.
- Agent rows show template state on the right, ordered update icon, `vN` badge,
  category badge, then the actions menu. On clickable rows that group stays inside
  the row's edit target, like the category badge.
- The `vN` badge is neutral (`outline`) normally and red (`destructive`) once the
  copy is `locallyEdited`. Its tooltip and accessible name name the version
  without implying the template still sits there: `Organization template vN` on
  template rows, `Installed from organization template vN` on a clean copy,
  `Edited in this project since installing vN` on a diverged one. A copy with no
  recorded `installedVersion` reads as v1 and stays neutral — it may hold local
  work, but nothing establishes that it does. The badge appears in organization
  settings, the project agent list, the `From template` dialog, and the
  empty-state template list.
- Cross-project import rows show no badge: the import drops provenance, so the
  source's installed version says nothing about the copy.
- Project-agent rows shown to managers additionally show a small muted
  `CircleFadingArrowUp` icon when the source template is newer, with a tooltip
  naming the version: `New version N is available`. The row's `Update` action
  keeps the download-arrow icon — the fading arrow is the state, the download
  arrow the act of pulling the template in. Viewers see neither: the icon
  advertises an action they cannot take, and resolving it would mean
  subscribing them to the whole organization catalog.
- When an update is available, managers get an `Update` row action. A copy that
  may hold local work and is already current gets that action as `Reset` instead
  — the confirmation dialog carries the detail. Both are absent for clean
  up-to-date copies and for viewers. Both confirm first — see
  [Template Versions and Refresh](#template-versions-and-refresh-os-1759).
  Updating reports success as a toast naming the version the copy moved to; a
  reset says the copy was reset to its template.
- Task assignee controls list existing Project agents but do not contain a full Project-agent creation form.
- Project AI Agents can be copied from organization Agent templates through the
  project settings template dialog.
  - The dialog supports a single-template import action on each row.
  - The dialog stays open after a single-template install, so several templates
    can be installed one after another; each reports success as a toast.
  - An already-installed template keeps its row — dimmed and marked `Installed` —
    rather than disappearing: the dialog is the organization catalog, not a
    shrinking to-do list. It loses the install action, because a second copy
    under the same name would collide with the first, and gains an update button
    when its installed copy is behind. That button opens the same refresh
    confirmation the row action does.
  - A template counts as installed when a project agent carries it as
    `sourceAgentId`, or when one shares its normalized name.
  - Clicking a template's name previews it before installing: a second dialog
    with the template's rendered prompt, cut at a fixed height and expanding on
    click the way a long task comment does. An Agent is a single prompt, so there
    is no file list below it (unlike a Skill). The footer carries the same
    `Install` action, disabled as `Installed` for a template the project already
    has.
  - Managers can switch the dialog into multi-select mode from the search row.
  - In multi-select mode, row import buttons are replaced by checkboxes, the
    toggle reads `Cancel selection`, and a primary `Import` action appears to
    its right.
  - `Import` is disabled until at least one template is selected.
  - Multi-template import is front-end orchestration: the UI calls the existing
    copy-from-template mutation once per selected template, sequentially, and
    shows shared batch progress feedback.
  - Before multi-template import starts, the UI checks selected templates
    against the current project-agent list by normalized name. If any selected
    template already exists in the project, the dialog lists the conflicting
    names and asks the user to choose:
    - `Skip existing`: import only selected templates without conflicts.
    - `Create with new name`: copy conflicting templates with a generated
      timestamp suffix.
    - `Replace existing`: update matching project agents from the selected
      organization templates and import non-conflicting selections normally.
- Project AI Agents can be imported from another project through the project
  settings `From project` dialog.
  - The dialog lists source projects the user has access to (excluding the
    current project); projects from other organizations are labeled with the
    organization name.
  - Selecting a source project lists its Project agents with a checkbox
    multi-select and a primary `Import` action, disabled until at least one
    agent is selected.
  - Multi-agent import is front-end orchestration: the UI calls
    `copyFromProjectAgent` once per selected agent, sequentially, with shared
    batch progress feedback.
  - Name conflicts against the current project-agent list are detected by
    normalized name before import starts. The conflict dialog offers:
    - `Skip existing`: import only selected agents without conflicts.
    - `Create with new name`: copy conflicting agents with a generated
      timestamp suffix.
    - `Replace existing` is not offered for cross-project import in v1.
- When a project has no Project agents yet, the Project AI Agents empty state
  should help managers import from existing organization Agent templates without
  requiring the template dialog first.
  - If organization templates are available, show a small suggested list of
    organization templates in the empty state.
  - Managers can select one or more suggested templates and choose `Import` to
    copy them into the project.
  - Empty-state import uses the same project-agent copy behavior as the
    template dialog and imports selected templates sequentially.
  - The template dialog remains available for searching the full organization
    template catalog and for non-empty project-agent lists.
  - Both variants use the shared empty state
    (`docs/guidelines/frontend-development.md#empty-states`), centered in the
    section. The search and create toolbar is hidden while the project has no
    agents; the create group (**New agent** plus its From template and From
    project menu) moves into the empty state.
  - With suggestions, the header reads "Import organization agents" with a
    description, and the template list and **Import** button sit below it.
  - If no organization templates are available, the empty state is a plain
    "No project agents yet" with the create group as its action.

## Deferred

- Starting Agent executions when a task is delegated. (Delivered for web-UI
  delegation by assignment automation: OS-1094 opens a prefilled thread
  composer, OS-1131 auto-submit can skip it — see `agent-automation.md`. The
  created thread binds the agent and delivers its `prompt` to the CLI runtime,
  so prompt runtime delivery is no longer deferred — see
  `cli-thread-agents.md` (OS-1138). Agent-as-actor execution — running as the
  agent rather than the delegating user — remains deferred.)
- Scheduled, webhook, or automation-triggered Agent executions.
- Local CLI or cloud runner binding for a Project agent.
- Attribution model for agent-authored comments, artifacts, attachments, and activity logs.
- Agent execution progress visibility in task-associated threads.
- Automatic template sync (installed copies only refresh when a manager asks —
  see Template Versions and Refresh).
- Backfilling `agents.version` and `projectAgents.installedVersion`. Both stay
  optional and are defaulted on read, permanently: templates default to 1 at the
  serialization boundary, and a copy's missing `installedVersion` is the signal
  that its provenance is unknown, which the overwrite rule depends on. Narrowing
  either field to required would need that migration first.
- Project-agent promotion to organization Agent template.
