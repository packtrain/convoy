# Skills

## Scope

This document defines Skills: reusable, multi-file instruction bundles that an
agent loads on demand. Skills are organization-scoped or project-scoped.
Organization Skills are **not** available to a project until they are installed
into it.

This spec covers the Skill entity, its scope and install model, versioning and
refresh, the headless surfaces (MCP and CLI), and the settings UI.

Delivery is staged. **V1** exposes Skills to agents through Convoy MCP tools.
**V2** materializes installed Skills onto disk so runtimes read them natively.
The stored data model is identical in both; only delivery changes. See
[Agent Delivery](#agent-delivery).

Related specs: `docs/specs/agents.md` (the install/version/refresh pattern this
follows), `docs/specs/slash-commands.md` (the scope-discriminator pattern),
`docs/specs/mcp-server.md`, `docs/specs/permissions-system.md`,
`docs/specs/cli-init-command.md`.

## Terms

- **Skill**: a named bundle of one required `SKILL.md` plus optional additional
  files, addressed by relative path.
- **Skill file**: one file inside a Skill, stored as a `path` plus inline text
  `content`.
- **Organization Skill**: `scope="organization"`. A template. Not visible to any
  agent until installed into a project.
- **Project Skill**: `scope="project"`. Either installed from an organization
  Skill, installed from a Git source, or authored in the project.
- **Install**: copying an organization Skill into a project, producing an
  independent project-scoped row that records its origin.
- **Refresh**: overwriting a project copy from its source, discarding local
  edits.
- **Locally edited**: a project copy whose template-owned content diverged from
  the version it was installed at.

The canonical glossary is `CONTEXT.md`.

## Storage Model

Two tables.

`skills` holds one row per Skill, in either scope:

- `scope`: `"organization" | "project"`
- `organizationId` — always set
- `projectId` — set for project scope only
- `name`, `normalizedName`
- `description`
- `category` — optional string, not a relational table
- `version` — bumped by any save that changed something
- `sourceSkillId` — optional, set when installed from an organization Skill
- `installedVersion` — optional, the source's `version` at install/refresh time
- `locallyEdited` — optional boolean
- `source` — optional Git provenance, see [Git Sources](#git-sources)
- `createdBy`, `updatedBy`, `createdAt`, `updatedAt`
- soft-delete fields

`skillFiles` holds one row per file:

- `skillId`
- `path` — relative POSIX path, unique within the Skill
- `content` — inline text

Rationale for row-per-file rather than an inline array: a Skill's file set
changes wholesale on every update, and per-file rows keep each document small
and let a single file be fetched without loading the bundle.

`skillFiles` rows are addressed by `path`, never by `_id`. Ids are not stable: a
refresh from a source replaces the whole set rather than merging file by file.

`SKILL.md` is written through the Skill's own create/update mutation and stored
verbatim (see [Frontmatter](#frontmatter)); its path is reserved and rejected in
the additional-file set. One mutation writes a Skill's whole file set, so
renaming is a path change inside that set and adding a file to a Skill that does
not exist yet is the same call as creating it — there is no per-file mutation.

### Caps

Enforced at every write boundary, including Git install:

- 50 files per Skill
- 256 KB per file
- 1 MB total per Skill

The file cap also bounds the per-mutation write count, since a full replace
deletes and reinserts every row in one transaction.

The caps are checked against the **whole set** a save writes, `SKILL.md`
included, never against one file in isolation: otherwise a Skill can be filled to
the budget through one path and pushed over it through another.

Deleting a Skill is a soft delete with **no cascade** — its `skillFiles` rows stay
in place. Nothing reads them, because every read starts from an active `skills`
row.

## Name Rules

- Valid characters are lowercase letters, digits, and hyphens, plus a single
  colon separating an optional `namespace:` prefix from the rest of the name
  (`mp:grilling`). A leading colon, a trailing colon, `a::b`, and a second colon
  are rejected: the prefix is one namespace, not a path.
- The prefix exists because a Skill set ported from one author (OS-1640) has to
  keep its origin in the name a human types, not only in its category, and
  because a ported name routinely collides with a Skill the project already has
  (`code-review`, `tdd`, `research`). A colon is what every agent harness already
  uses for this, so it reads as a namespace rather than as part of the name. The
  `/` menu treats it as a segment separator, so `/grill` prefix-matches
  `mp:grilling`.
- A name is not a path segment. Delivery is over MCP, so nothing writes it to a
  filesystem; a future on-disk delivery has to map the colon itself, since
  Windows rejects it in a filename.
- Names are 2 to 64 characters after normalization.
- Normalization lowercases and trims.
- Duplicate active names are rejected within the same scope owner: within one
  organization for organization Skills, within one project for project Skills.
- Soft-deleted Skills do not block reusing a name.
- A project Skill may share a name with an organization Skill. The project row
  is what agents see, because organization Skills are never exposed directly.

## Path Rules

Paths are a trust boundary. V2 turns them into real filesystem writes, so a
traversal string accepted here becomes an arbitrary file write later.

- Relative POSIX paths only.
- Reject `..` segments, a leading `/`, backslashes, and empty segments.
- Reject paths over 200 characters.
- Unique within a Skill.
- `SKILL.md` is reserved. It always exists, is always the Skill's entry point,
  and is edited through the main editor rather than the file list.

## Frontmatter

`SKILL.md` is stored **verbatim**. Convoy never parses it and never rewrites it.
`name` and `description` live in their own columns, fed only by the create/update
arguments. Whether a Skill's body carries YAML frontmatter is the author's choice
and has no effect on either column.

Two-way sync was tried and removed. The editor is a rich-text markdown editor,
which does not round-trip a YAML `---` block: the fences are lost on the way
through, so the write-back pass no longer recognized the block and appended a
fresh one on every save, duplicating `name`/`description` lines in the body.
Storing the two fields once, in columns, is the only place they can't drift.

Installing from a Git source parses the upstream frontmatter and maps `name` and
`description` into the columns, rather than relying on the body to carry them.

## Scope And Install Model

Organization Skills are templates. They are never delivered to an agent. A
project sees a Skill only after it is installed.

Install **copies**, following `agents` -> `projectAgents`
(`docs/specs/agents.md`). It does not link:

- Install inserts a new `skills` row with `scope="project"`, sets
  `sourceSkillId` to the organization Skill, sets `installedVersion` to that
  Skill's `version`, and copies every `skillFiles` row.
- The copy is independent afterward. Editing it never affects the organization
  template, and vice versa.
- Deleting the organization Skill leaves project copies untouched.

## Versioning And Refresh

Mirrors Agents exactly (OS-1759).

- `skills.version` is bumped by any save that changed something. One save is at
  most one bump, however many files it wrote, and a save that stored nothing does
  not bump at all — a no-op must not advertise a phantom update to every
  installed copy. Rows written before `version` existed read as `1`.
- A project copy stores `installedVersion`. An update is available when
  `source.version > copy.installedVersion`.
- Editing a template-owned field on the copy — any file `content`, any file
  `path`, the file set, `name`, `description`, `category`, or `source` — sets
  `locallyEdited`.
- Refresh **overwrites**, in one mutation, so a failure cannot leave a half-written
  Skill: the copy's file set becomes the source's current set, `name`,
  `description`, `category` and `source` come from the source, `installedVersion`
  is updated, and `locallyEdited` is cleared. The set write is the same whole-set
  helper an ordinary save uses — insert what is new, patch what changed, delete
  what is gone — rather than a delete-all-then-reinsert path, and it bumps the
  copy's own `version` like any other save.
- Refresh always confirms first, clean copy or not: it replaces the copy's content
  wholesale and cannot be undone. The dialog names what it replaces, the target
  version when the template is ahead, and the loss of local edits when
  `locallyEdited` is set. The mutation enforces the dirty rule rather than trusting
  the caller's snapshot: a dirty copy needs an explicit `overwriteLocalEdits`, so a
  concurrent edit cannot be clobbered from a stale client read (OS-1759).
- The same mutation is the way back for a copy the project edited: a
  `locallyEdited` copy whose template is **not** ahead offers a reset, which
  reinstalls the template's current content over the local one. Same overwrite,
  same confirmation, no separate code path.
- Local edits are not merged. A three-way merge produces a Skill matching no
  known-good version, which is worse than reapplying a one-line tweak.

The version badge follows `AgentVersionBadge`: `v{n}`, `outline` normally,
`destructive` once diverged.

## Git Sources

A Skill copied out of a Git repository records `source`. **Every field is
optional**, in any combination:

- `repoUrl` — capped at 500 characters, no control characters
- `commitSha` — the resolved commit, not the moving ref. **This is the version**:
  it is what an upstream check compares against to answer "has the author
  released a new one" (OS-1834). Stored lowercase, 7 to 64 hex characters
- `ref` — branch or tag the copy came from, capped at 200 characters
- `subpath` — directory within the repository, held to the
  [path rules](#path-rules) because V2 joins it onto a real filesystem write

Nothing is required because partial provenance still beats none: someone who
knows the repository but not the commit should record the repository rather than
invent a commit or give up (OS-1834). A `source` whose fields are all blank is
**not stored at all** — it is dropped to no provenance rather than kept as an
empty object, so "copied from nowhere" and "copied from somewhere unrecorded" do
not both exist on the row.

Optional is not unchecked. A recorded field still has to be usable, so the
formats above are enforced on whatever is given: a branch name in `commitSha` is
rejected rather than silently becoming the version, and it belongs in `ref`.

Any authoring call may record it, not only the Git install below: `create` takes
it and `update` sets it or takes `null` to clear, in both scopes, from the web
editor's own inputs and through MCP (`create_skill`, `update_skill`). Copying a
Skill by hand out of a public repository is how most of them arrive, and that
copy is exactly the one whose upstream needs checking later — so a person who
pasted a `SKILL.md` into the editor has to be able to say where it came from
without leaving the page.

It is **template-owned**, like the columns beside it: install copies it to the
project copy, refresh overwrites it from the template, and changing it is a save
that bumps `version`. A new upstream commit is a real change, and a project that
installed the template should learn where its content came from.

The UI links to it, so the source is one click away — but a stored string is not
trusted as an `href`. `skillSourceHref` returns a target only for `http(s)`, so a
`javascript:` URL and an SSH remote (`git@host:owner/repo.git`) both render as
plain text with no link at all. A `github.com` URL is rewritten to the
commit-pinned tree (`/tree/{commitSha}/{subpath}`) so the link opens the version
that was copied, falling back to `ref` and then to the repository root as the
recorded fields run out. Every other host opens at the repository root, because
only GitHub's tree layout is known. Add a host when someone needs it.

Fetching is done by the **CLI**, not by a Convex action. The CLI runs
`git clone --depth 1` through the existing `runGit` spawn point
(`apps/cli/src/lib/git/exec.ts`), reads the files locally, and writes them
through the same mutation the web editor uses. Consequences:

- No new backend function, no tarball handling, no new dependency.
- Private repositories work through the user's existing Git credentials. Convoy
  stores no GitHub token.
- The commit SHA is available locally, and the preview costs nothing extra.
- Installing from a URL pasted into the web UI is **not** supported. Adding it
  later means a Convex action writing through the same mutation.

### Install Preview

Nothing is written to Convex until the user confirms. The fetch is read-only.

The CLI prints the resolved commit SHA, the Skill name and description, the file
count, the total size, and the file list, then prompts. `--yes` skips the prompt
for CI and makes the bypass explicit in logs.

This is a visibility control, not an authorization control. It does not stop
someone who reflexively confirms. The permission check applies independently.

### Updating From A Git Source

`convoy skills add` against a repository that already sources an existing Skill
updates it in place rather than erroring or duplicating. The preview shows a
change list instead of a file list.

Updates **replace the whole file set** — delete every `skillFiles` row, then
insert the new one, in a single mutation. The upstream file list may have
changed, so merging file-by-file would leave deleted files behind.

Updating an organization Skill bumps its `version`, which surfaces the "update
available" badge in every project that installed it. Upstream to organization to
project is one chain through one mechanism.

## Permissions

- `OrgPermission.SKILLS_MANAGE` (`skills:manage`) — organization owners and
  admins. Required to create, edit, delete, or install-from-Git an organization
  Skill.
- `ProjectPermission.SKILLS_MANAGE` (`project_skills:manage`) — project admins
  and members, not viewers. Required to create, edit, delete, install, refresh,
  or install-from-Git a project Skill.
- Installing an organization Skill into a project requires only the project
  permission, matching `copyFromAgent`. The organization Skill must belong to the
  project's organization.
- Reading requires organization membership for organization Skills, or
  `ProjectPermission.PROJECT_VIEW` for project Skills. Viewers see Skills with
  all controls disabled.
- Installing from a Git source requires no permission beyond authoring. A user
  who can write a Skill by hand can already paste the same content, so a stricter
  role would add friction without closing the hole. The preview is the control
  that does real work.
- Installs record `installedBy` alongside the source URL and commit SHA, so a bad
  Skill is traceable.
- An API key scoped to specific projects is denied every organization-scoped Skill
  **entry point** — list, read, create, edit, delete — matching the hardening in
  `slashCommands/core.ts`. Install is the one exception, and deliberately: it is a
  project write authorized by the project permission, so such a key can copy a
  template it cannot list, and read the copy back. That needs the template's ID,
  which the same key cannot enumerate, so it costs knowledge the caller's owner
  already has from the web UI (OS-1781).

## Agent Delivery

### V1 — MCP

Skills reach agents through two MCP tools:

- `load_skill(name)` returns `SKILL.md` plus the list of the Skill's other file
  paths.
- `read_skill_file(name, path)` returns one file's content.

Two tools rather than one bulk fetch: loading a whole bundle to answer one
question defeats the purpose of on-demand loading, and this matches how the
agent will behave in V2 once the files are on disk.

Both resolve a **name** within the connection's project, and only the project's
Skills: an organization template is never reachable from an agent, so its name
reads as missing. A name or a path that is not there returns `null` rather than
throwing — the agent asked about something absent, which is an answer, not a
failed tool call.

That covers a **malformed** name or path too, not only a well-formed miss. The
read path canonicalizes (trim, and lowercase for a name) and lets the lookup fail,
rather than reusing the write path's validators: an agent guessing `pdf tools` off
a catalog line, or joining a relative path itself, is asking a question, and
`-32602` is not an answer to it. The write path keeps every guard, the traversal
one included — a read writes nothing, so there is nothing there to protect.

Neither reads the whole bundle, though `api.skills.core.get` returns one: that
query serves the settings editor, which edits the file set locally and saves it in
one call. `read_skill_file` resolves one row by path instead.

**Discovery** happens through the tool schema, not through prompt injection. The
`tools/list` handler already resolves the project and builds definitions per
project (`convex/mcp/router.ts`), so it enumerates the project's Skills directly
into `load_skill`'s own description text: name and description, one per Skill,
sorted by name so an unchanged project produces an unchanged schema. File content
is never read for discovery.

A description is **flattened to one line and clamped** on the way into the schema.
It is stored verbatim and written by agent-facing tools, so a newline in one would
forge a second catalog entry — and this channel is persistent by design, so a
forged line would sit in every agent's context for every future session in that
project. Descriptions in the catalog are untrusted prose; only the names are
Convoy's own.

A connection with **no project** says so instead of enumerating an empty catalog:
"no Skills here" and "no project here" are different facts, and the second one
still leaves `projectId` as a way in.

This is chosen over appending to the agent prompt because:

- Tool schemas stay in context for the whole session and survive resume on every
  runtime. First-message injection is skipped on resume
  (`apps/cli/src/agent/runtimes/agent-instructions.ts`), so long threads would
  lose Skill awareness exactly where it matters most.
- It requires no change to `agent-instructions.ts` and no change to any of the
  runtimes.
- Freshness is equivalent. Every Convoy run spawns a fresh agent process, so
  `tools/list` re-runs on every user message.

Cost is roughly 30-60 tokens per Skill in the tool schema, plus one indexed read
of the project's Skill rows per `tools/list` call. It grows linearly with the
Skill count and is not capped: a project past a few dozen Skills pays for all of
them on every user message.

### V2 — Disk

Installed Skills are written into the workspace so runtimes read them natively,
reusing the existing writer (`apps/cli/src/commands/init/skill-service.ts` and
its per-target drivers). Stored `path` values are already relative and POSIX, so
they transfer unchanged. The `load_skill` description enumeration is removed at
that point; the filesystem does the work.

Executable files inside a Skill are inert text in V1. V2 is the point at which
they become runnable, and the security posture should be revisited then.

## Backend API

- The organization list query returns active organization Skills for an
  organization. The project list query returns active project Skills for a
  project. Neither leaks the other scope's rows.
- The settings list is one paginated query (`list`) for both scopes: it takes the
  organization, an optional project, and an optional category, and returns
  name-ordered pages. `category: null` means uncategorized; an omitted category
  means no filter. The filter runs on a per-scope
  `…isDeleted_and_category_and_normalizedName` index, not over fetched rows. The
  unpaginated per-scope queries remain for callers that need the whole set (MCP
  listing, the install-template catalog). The index is per scope,
  `…_isDeleted_and_category` with a trailing `normalizedName` for page order —
  the order field is not in the index name because of Convex's 64-character
  index-name cap.
- The category navigation reads a separate `listCategories` query — every
  category in scope with its count — because pages cannot know categories they
  have not loaded. Same access rules as `list`.
- Reading, updating, and deleting one Skill take a `skillId` and derive the scope
  from the stored row: organization membership or `PROJECT_VIEW` to read,
  `SKILLS_MANAGE` of the matching scope to write. Only the create and list
  entry points name a scope (`createInOrganization`, `createInProject`).
- The read query returns `null` for a project Skill the caller cannot reach, the
  same as for one that does not exist: a stale or cross-project URL belongs on
  the not-found card, not on the route error boundary. A project list query still
  throws, because that page needs the project itself. Prompts read the same way
  (`docs/specs/slash-commands.md`).
- List queries return metadata only: no file content, no file list, no
  denormalized file count. A row's file set is never part of a list subscription.
- Reading one Skill returns its columns, its `SKILL.md` content, and its other
  files with their content. That is the whole bundle, capped at 1 MB, and it is
  what a single-Skill editor or a Skill install needs anyway; a per-file query
  would only add a second subscription for the same bytes.
- Create and update take the **whole additional-file set** as one argument.
  Update diffs it against what is stored: paths only in the argument are
  inserted, changed content is patched, paths no longer present are deleted. An
  omitted file set means "leave the files alone", not "delete them all".
- The editor has no per-file mutation. A file the user added, renamed, or deleted
  in the editor reaches the backend when the Skill is saved, so one edit session
  is one save, one version bump, and one transaction that cannot half-apply.
- `update` also takes an ordered `edits` batch for callers that do not hold the
  whole set — see [Authoring](#authoring). It is not a second write path: the
  batch is applied to the read-back set and committed through the same
  normalization and caps, in the same write as the column patch. Hence its
  return: `ok: true` with the saved `version`, or the typed edit failure.
- Every callable takes the optional API key, not just list and create — the
  headless surface needs the same set, and a split makes the narrowing rules
  inconsistent.
- Scope-specific behavior lives near the public functions. Normalization,
  validation, path checks, and repository helpers are shared across scopes.
- Recommended namespace: `convex/skills/core.ts`, with helpers under
  `convex/skills/lib/` (`skillsRepo.ts`, `skillFilesRepo.ts`, `normalize.ts`,
  `validators.ts`).
- Install and refresh are two mutations next to the rest: install takes the
  project and the template's `skillId`, refresh takes the copy's `skillId` and
  derives the source from the stored row, so neither caller has to keep the pair
  in sync.
- New scopes extend this subsystem rather than creating separate entities such as
  `organizationSkills` or `projectSkills`.

## Organization Settings UI

- `Skills` is an organization settings route in the existing navigation.
- Routes: list `/o/{organizationSlug}/settings/skills`, create
  `/o/{organizationSlug}/settings/skills/new`, detail/edit
  `/o/{organizationSlug}/settings/skills/{skillId}`.
- The list, category navigation, client-side search, and read-only detail follow
  the Prompts patterns in `docs/specs/slash-commands.md`.
- The list loads 50 Skills at a time and ends in a `Load more` row while more
  remain (OS-1843). Picking a category swaps the query's filter, so each category
  paginates from its own start; the navigation and its counts come from the
  categories query and are always complete. Search stays client-side, so it only
  matches loaded rows — `Load more` extends what it can find.
- Rows show the Skill name as `/{name}`, its description, a `v{version}` badge,
  and a category badge — same order and same badge as the AI Agents rows. Search
  matches either name form. A Skill with no description shows an em dash, so rows
  stay the same height.
- A row whose Skill has a linkable `source` carries an external-link icon **right
  after the name**, opening the copied commit in a new tab. Checking upstream is the
  reason provenance is stored, so it should not cost an extra page load.
- That icon is why the row's click target is a layer rather than a wrapper: an
  absolutely-positioned link fills the row under the content, the content is
  `pointer-events-none` above it, and the source link and the `⋯` menu opt back in.
  A link nested inside another link is invalid HTML, so a row that carries both a
  whole-row target and an inline link cannot be one element. The click layer takes
  the row title as its accessible name.
- Rows are links, not click handlers, so middle-click and modifier-click open the
  Skill in a new tab. The `⋯` menu's `Edit` is the same link.

## Project Settings UI

- Project settings include a `Skills` section using the same routes and patterns
  under `/o/{organizationSlug}/{projectAlias}/settings/skills`. The section and
  the editor are the organization components with a `projectId`, not a second
  copy; the row, the delete dialog, and the filter are the shared
  settings-catalog primitives and know nothing about scope.
- A row's version badge reads `Skill v{n}` for a project Skill authored in the
  project and `Organization template v{n}` for a template: a Skill authored in the
  project versions only itself.
- Installing an organization Skill sits behind the section's `New skill` button
  group, following `project-agents-section.tsx`: an `Install org skill` dropdown
  item opens a dialog listing the organization Skills with their own search and a
  per-row Install action, and the empty state offers the same dialog in a matching
  button beside `Create skill`. The templates are not a second list on the page,
  and an organization with no Skills gets neither affordance.
- The dialog stays open after an install, so several Skills can be installed one
  after another. An already-installed template keeps its row — dimmed and marked
  `Installed` — rather than disappearing: the dialog is the organization catalog,
  not a shrinking to-do list. It loses the Install action, because a second copy
  under the same name would collide with the first, and gains an update button when
  its installed copy is behind.
- Clicking a template's name in that dialog previews it before installing: a
  second dialog with the Skill's rendered `SKILL.md` and, below it, the paths of
  its other files without their contents. Long markdown is cut at a fixed height
  and expands on click, the way a long task comment does. The footer carries the
  same `Install` action, disabled as `Installed` for a template the project
  already has.
- An installed copy badges the version it was **installed at**, not its own save
  count, and shows an update hint plus an `Update` row action when the template is
  ahead. A `locallyEdited` copy that is already current gets that action as `Reset`
  instead — the confirmation dialog carries the detail. Both confirm first — see
  [Versioning And Refresh](#versioning-and-refresh).

## Create And Edit UI

- Create and edit use full-page routes, not modal dialogs.
- `SKILL.md` is always the main editor on the page.
- `name` and `description` are inputs above it. They write their columns only;
  the body is never rewritten (see [Frontmatter](#frontmatter)).
- The name input carries a leading `/` addon and lists render `/{name}`, matching
  how a Skill is mentioned in the thread composer. The `/` is display only — it is
  never stored, and typing or pasting one is stripped.
- Other files render as a **flat list showing each `path`**. There is no tree
  view and no drag-and-drop in V1.
- The file set is part of the page's form, not a live subscription. Adding,
  editing, renaming, and deleting a file all change a local draft, and nothing is
  written until the page's Save. Cancel discards the file changes with the rest
  of the form.
- Consequences of that, and why it is the model: the create page can add files
  before the Skill exists, so authoring is one flow instead of "save, then come
  back for the files"; the editor holds no subscription that re-emits mid-edit;
  and a multi-file edit is one version bump rather than one per file.
- Clicking a file opens a dialog holding that file's draft — titled `Create file`
  or `Edit file` — with the only path input and the same markdown editor
  `SKILL.md` uses. The page itself never shows a path input. Saving the dialog
  returns the file to the local list; renaming edits the path; deleting removes
  it from the list after a confirmation.
- With no additional files the section is an empty state — description plus an
  **Add file** button — rather than a bare input.
- The dialog rejects a path with no file name (`references/`) and a path already
  used by another file in the draft; the backend rules stay the authority.
- Folders are implicit in the path string; `references/fields.md` needs no
  folder object.
- Path validation errors appear inline.
- A **Metadata** section below the file list carries the `source` as four inputs —
  repository URL and subpath, then ref and commit — always present, so a Skill
  pasted in by hand can record where it came from. It is part of the form draft like
  every other field: nothing is written until Save, and emptying the inputs on an
  existing Skill clears the stored provenance.
- Pasting a GitHub browse URL into the repository field **splits it across the
  section**: `github.com/{owner}/{repo}/tree/{ref}/{subpath}` fills all three, a
  40-hex `{ref}` fills `commitSha` instead of `ref`, and a `/blob/…/SKILL.md` link
  resolves to that file's directory, because a Skill is a directory. A plain
  repository URL fills only the repository and leaves the rest as typed. Nobody
  hand-splits a URL they just copied out of the address bar; the fields stay
  editable for the hosts the parser does not know, which is all of them but GitHub.
- No field requires another: a repository alone, a commit alone, or all four all
  save. The section validates only formats, so the error arrives before the save —
  a commit must be 7 to 64 hex characters, which is what refuses a branch name.
- The section is inputs only. The list row carries the link to the source, so
  repeating it under the fields adds a second place to maintain and a control that
  moves as you type.
- Users without the scope's manage permission see rendered content instead of
  editors, for every file: `SKILL.md` inline, and each additional path opens a
  read-only dialog rendering that file. Read access is per-file already, so the
  read-only view is not allowed to stop at the path list.
- The form re-seeds only when a different Skill loads. The Skill query can
  re-emit while the page is open — a save in another tab, an unrelated column
  patch — and re-seeding on that would discard unsaved work.

## Headless Access (MCP and CLI)

### Reading

Per [Agent Delivery](#agent-delivery): `load_skill`, `read_skill_file`.

### Authoring

Agents and the CLI can author Skills, not only read them. A Skill body is a
document an agent iterates on, so rewriting a whole file to change one word is
wasteful and error-prone.

Editing therefore follows the **task-artifact** pattern
(`replaceInTaskArtifact`, `convex/tasks/artifacts.ts`):

- `list_skills`, `get_skill` — metadata list, and one whole bundle
- `create_skill`, `update_skill`, `delete_skill`

There are **no per-file tools**. `update_skill` takes an ordered `edits` batch
alongside its columns and `content`, so one call renames the Skill, rewrites its
body, and patches three files. Each edit is one of:

- `write` — create `path`, or overwrite it if it exists
- `replace` — swap `oldString` for `newString` inside `path`, with optional
  `replaceAll`, defaulting to false, which requires exactly one match
- `move` — rename `path` to `newPath`
- `delete` — remove `path`

`write` is an **upsert**, not a create: a caller holding `get_skill` output does
not need a create/update distinction, and a split only adds a call that can fail
on a path the agent already knows the state of. The cost is that a `write` to a
misremembered path overwrites instead of erroring; `move` still refuses to land
on a live path, so a rename cannot silently drop a file.

`update_skill` returns a **typed result rather than throwing** for a partial edit
that cannot be placed, so the agent can recover without a failed tool call:
`ok: false` with a `code` of `old_string_not_found` or `multiple_matches`, plus
`occurrences` — the count that decides between a longer `oldString` and
`replaceAll` — and `index`, the position of the edit that stopped the save. This
mirrors `replaceInTaskArtifactResultValidator`. Success is `ok: true` with the
saved `version`. Everything else (a missing file, a bad path, a cap breach)
throws, because it is a mistake rather than a search that came up empty.

Edits apply **in order to one in-memory set**, so a later edit sees an earlier
one's result: rename a file, then partially edit it by its new path. `content`
and the whole-set `files` argument land first, so a full rewrite of `SKILL.md`
and a `replace` inside it compose in one call. Paths are normalized on the way
in, so an edit finds a file by its canonical path regardless of what the
preceding edit passed.

`SKILL.md` is reachable by `write` and `replace` — it is the file an agent
iterates on most — and is never renamed or deleted, nor added as a set member.
Editing it leaves `name` and `description` alone, exactly as a UI edit does;
those change only when passed explicitly. An additional file may be empty — a
placeholder, or a truncation — but `SKILL.md` must not be blank, matching the
editor.

Edits are subject to the same path rules and caps as full writes, and the caps
are checked against the whole set, so an edit that breaks one writes nothing. A
`replace` is sized **before** its result is built: growth is occurrence count
times `newString`, which is unbounded, so materializing first would turn a cap
breach into a resource error instead of the documented one.

This is the whole-set write path in [Backend API](#backend-api), not a second
one: the mutation reads the stored set, applies the batch, and writes the set
back. A Skill is 1 MB at most, so nothing is saved by giving the agent surface
its own per-file mutations. The whole call is one save: **at most one `version`
bump**, one transaction that cannot half-apply, and a rejected edit rolls back
every edit before it and the column patch with them. "At most" is exact — a
`write` of the content already stored, a `move` onto the same path, and a
`replace` whose `newString` equals its `oldString` all succeed without bumping,
because `version` is the drift signal installed copies key "update available"
off (see [Versioning And Refresh](#versioning-and-refresh)). An agent retrying a
call after a timeout hits this far more often than a human clicking Save.

`install_skill(skillId)` installs an organization Skill into the connection's
project: the same copy the settings UI makes, so an agent can install a Skill it
needs before loading it. Refresh is deliberately absent from MCP — discarding a
project's local edits is a person's decision, and the copy is reachable through
`update_skill` either way.

`list_skills` and `create_skill` take a `scope` of `project` or `organization`,
defaulting to **project** — MCP connections are per project, the same default as
`create_prompt`. Project scope takes `projectId`, or the connection's default
project; organization scope takes `organization` (slug or ID, defaulting to the
organization owning the resolved project) and needs an org-scoped API key.
`get_skill`, `update_skill`, and `delete_skill` take a `skillId` instead, so they
follow whichever scope the stored Skill has.

An `organization` passed **in project scope** is rejected rather than ignored.
Project scope never consults it, so dropping it would write to a different owner
under a different permission without saying so — the same contradiction the CLI
already refuses for `--org` without `--project`.

No MCP tool takes the whole file set: `edits` name the files they touch, and a
caller with a whole set in hand goes through the mutation directly (the web
editor, and the Git install in [Git Sources](#git-sources)). `create_skill` takes
`SKILL.md` only, so a new multi-file Skill is a create plus one `update_skill`.

### CLI

`convoy skills list | show | create | install | update | remove`, plus `add` for
Git sources.

- `list` and `create` take `--scope project|organization`, defaulting to the
  profile's project, and `--org <orgId|orgSlug>` for organization scope — the same
  flags the prompt commands take, resolved by the same helper. `show`, `update`,
  and `remove` take a Skill ID, which carries its own scope.
- `create` requires `--name` and `--content` or `--content-file`; `update` changes
  only the flags passed, with `--clear-description` and `--clear-category`.
- `install <name>` takes an organization Skill's **name**, looked up in the
  project's own organization — the same vocabulary the agent surface uses, and an
  install never crosses organizations anyway. The lookup is an organization read,
  so a key narrowed to projects cannot resolve the name even though it could
  install the resulting ID; it takes `--org` for the same reason `list` does, to
  disambiguate a project alias two organizations share.
- `show` prints the recorded Git source as `repoUrl/subpath@commitSha (ref)`.
- `add <owner/repo>` accepts an optional subpath and `--ref`.
- `add` on an already-sourced Skill updates it in place.
- `--yes` skips the install confirmation.

## Composer Mentions

A user can reference a Skill from the thread composer, the way they reference a
Prompt with `/` or a repo file with `@`.

Mentioning a Skill does **not** expand its body into the message. Expanding a
whole `SKILL.md` into every message defeats the on-demand loading the rest of
this spec is built around. The mention instead names the Skill and lets the
agent load it through `load_skill`.

- Only the project's Skills are mentionable. Organization Skills are not
  exposed, matching [Agent Delivery](#agent-delivery). The menu reads the
  project's Skills from the list query the settings section already
  subscribes to, so the catalog is loaded with the composer.
- Selection inserts an atomic pill, following the slash-command pill pattern in
  `docs/specs/slash-commands.md` (Composer Behavior). The pill serializes into
  display content as `[/{name}](convoy://skill/{name})` — its own URL scheme, so
  the rendered mention can carry the Skill accent.
- The composer document's refs are a union: a Skill ref carries the Skill's id
  and `type: "skill"`, and keeps the slash-command ref's field set so the pill
  stays one shape.
- On send, the pill resolves server-side into a short directive naming the
  Skill, written to `processedContent` — the same mechanism as
  `resolveSlashCommandComposerContent`. The raw `content` keeps the short
  display form. The directive is
  ``the `{name}` skill (load it with load_skill before acting)``.
  It is a **noun phrase, not a sentence**: the pill is replaced where it sat, so
  a sentence would splice a second verb and a stray period into the user's own
  wording, and repeat itself when a Skill is mentioned twice.
- Resolution re-validates that the Skill still exists in the thread's project, so
  a stale draft cannot reference a deleted or foreign Skill. A ref that fails
  that check rejects the send with `Skill not found` rather than sending the
  mention unresolved.
- The link the resolver searches for is rebuilt from the **stored** Skill, not
  from the ref: a ref is client-supplied, so a lying `displayLabel` would show one
  name to every reader of the thread while pointing the agent at another Skill.
  The same rule now covers Prompt refs.

### Trigger And Appearance

Skills share the **`/` trigger** with Prompts and runtime commands rather than
claiming a third character. `ComposerSlashCommandItem` is already a union of
stored and runtime items, so Skills join as a third kind and reuse the menu,
catalog query, pill, and draft serialization unchanged.

The distinction is carried visually, not by syntax:

- a **kind badge** in the suggestion menu row, alongside the existing scope
  badges
- a **distinct accent colour** on the menu row (icon, label, badge), the pill,
  and the rendered mention

Slash commands use `text-info`
(`docs/guidelines/frontend-development.md`). Skills use
`text-violet-600 dark:text-violet-400`, so a
Skill mention is distinguishable from a Prompt mention at a glance in a dense
thread. The accent is recorded in
`docs/guidelines/frontend-development.md`, since it is a reusable convention.

The menu row badge reads `Skill`, in the same slot the scope badges use — a
mentionable Skill is always project-scoped, so the two never compete.

The `project:`/`org:` prefixes filter **Prompts** by scope and exclude Skills.
`skill:` narrows to Skills instead, matching their scope-prefixed canonical key
(`skill:{name}`) the way `org:` matches a Prompt's. The menu's empty state reads
`No results found`, since a `/` query searches Prompts, agent commands, and
Skills together.

## Deferred

- Installing from a URL pasted into the web UI, which needs a Convex action.
- Comparing a recorded `commitSha` against upstream, and showing that a Skill's
  author has moved on. The provenance is recorded for it; nothing polls yet.
- `convoy skills create|update` flags for recording a Git source by hand. `add`
  records it, and MCP already accepts it.
- A tree view, drag-and-drop, or file upload in the Skill editor.
- Per-file merge on refresh.
- Version history and rollback.
- Binary files and files over the per-file cap.
- Disabling an installed Skill without uninstalling it.
- Personal-scope Skills.
