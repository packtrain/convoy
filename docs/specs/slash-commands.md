# Slash Commands

## Scope

This document defines Slash command management. The existing implementation
started with organization-scoped Slash commands; project-scoped Slash commands
extend the same entity and composer model.

Using Slash commands inside chat composer flows is part of the integration for
organization-scoped and project-scoped commands.

This spec covers **prompt-expansion** commands only (Convoy-owned stored prompts). Commands interpreted by the agent runtime itself (`/compact`, Claude Code custom commands/skills), which share the same composer autocomplete but are forwarded to the CLI verbatim, are specified in `docs/specs/cli-runtime-commands.md`. The composer's sibling `@` trigger (repo-file mentions) is specified in `docs/specs/cli-composer-file-mentions.md`.

## Terms

- **Slash command**: a reusable prompt entry selected by a slash-prefixed shortcut key in chat. Slash commands may be organization-scoped or project-scoped.
- **Slash command key**: the normalized key after the leading slash, such as `review` for `/review`.
- **Slash command content**: the markdown prompt body stored on a Slash command.
- **Auto-expand**: when enabled, using the Slash command inserts its content into the composer; when disabled, the composer may keep a compact command reference.
- **Autosubmit**: when enabled, selecting the Slash command as the only non-whitespace composer text immediately submits the message.

The canonical glossary is `CONTEXT.md`.

## Stored Fields

A Slash command stores:

- `scope`
- `organizationId`
- optional scope owner fields, such as `projectId` or a future `userId`
- `key`
- `description`
- `category`
- `content`
- `autoExpand`
- `autoSubmit`
- `createdBy`
- `updatedBy`
- `createdAt`
- `updatedAt`
- soft-delete fields

`content` is markdown authored through the shared MDX editor.

Saving strips trailing whitespace from every line of `content`, including the
`&#x20;` character references the markdown serializer emits in place of a space
next to a line ending. Auto-expand inserts `content` into the composer as plain
text without decoding character references, so an unstripped escape would be
visible in the message. Content that is only trailing whitespace or its escapes
is rejected as empty.

New Slash commands default `autoExpand` to `false`.

New Slash commands default `autoSubmit` to `false`. During the rollout,
legacy rows may omit the field and are read as `false` until the backfill is
verified and the schema is narrowed.

`description` is optional. When absent or blank, list rows derive preview text from `content`.

`category` is an optional string in v1. It is not a relational table, taxonomy object, or tag list.
Slash commands without a category render under `Uncategorized`.

## Scope Model

- Slash commands are one product entity with multiple possible scopes.
- Organization prompts use `scope="organization"` and are owned by an organization.
- Project prompts use `scope="project"` and are owned by a project.
- The backend should live under a Slash command subsystem, not under organization settings.
- Recommended Convex namespace: `convex/slashCommands/core.ts`, with supporting helpers under `convex/slashCommands/lib/`.
- Public functions should be scope-specific where behavior is scope-specific, for example `api.slashCommands.core.listByOrganization` and `api.slashCommands.core.listByProject`.
- New scopes must extend the Slash command subsystem rather than creating separate unrelated entities such as `organizationPrompts`, `projectPrompts`, or `personalPrompts`.
- Composer catalog resolution returns scoped command items and can merge multiple scopes in one canonical order.
- Project-route composer catalogs return project commands and organization commands for the current project.
- Bare-key resolution in a project context prefers project Slash commands, then organization Slash commands.
- Future personal scope may take precedence over project scope once designed.
- Composer syntax can explicitly select scope with reserved prefixes:
  - `/client-summary` resolves by precedence
  - `/project:client-summary` resolves a project Slash command
  - `/org:client-summary` resolves an organization Slash command
- Personal Slash command explicit syntax is deferred until personal command scope is designed.
- `project` and `org` are reserved only as the first composer scope selector.
- Stored keys may still start with `project:` or `org:`.
- If a stored key starts with a scope selector string, users can still disambiguate by typing another selector first; for example `/org:org:client-summary` selects an organization Slash command whose stored key is `org:client-summary`.

## Key Rules

- The stored `key` excludes the leading slash.
- The displayed command includes the leading slash, for example `/review`.
- Keys are normalized before duplicate checks and storage.
- Normalization lowercases the key and trims surrounding whitespace.
- Valid key characters are lowercase letters, numbers, hyphens, and colons.
- Keys must be 2 to 40 characters after normalization.
- Duplicate active keys are not allowed within the same scope owner: within one organization for organization commands and within one project for project commands.
- Duplicate checks are case-insensitive because keys are stored normalized.
- Soft-deleted Slash commands do not block reusing the same key.
- Project commands may use the same key as organization commands. The composer displays both with scope badges and bare typed keys resolve by precedence.
- Personal scope must define its own uniqueness and conflict-resolution rules before composer integration ships.
- Keys may contain colons, including leading `project:` and `org:` text. Composer parsing should peel off at most one leading explicit scope selector before resolving the remaining stored key.

## Required Fields

- `key` is required.
- `content` is required.
- `description` is optional.
- `category` is optional.

## Permissions

- Organization owners and admins can create, edit, and delete Slash commands.
- Organization members who are not admins can view Slash commands in organization settings but cannot create, edit, delete, or otherwise modify them.
- Read-only organization members can open Slash command detail pages and view full content with all controls disabled.
- Backend mutations use `OrgPermission.SLASH_COMMANDS_MANAGE` instead of inline role checks.
- Project prompt mutations use a separate project-level permission, `ProjectPermission.SLASH_COMMANDS_MANAGE` (display string `slash_commands:manage`), mirroring the org-level `OrgPermission.SLASH_COMMANDS_MANAGE` naming.
- Project admins and project members receive `ProjectPermission.SLASH_COMMANDS_MANAGE`; project viewers do not. Organization owners and admins need a `projectMembers` row granting it, like anyone else (OS-1536).

## Backend API

- The organization list query returns all active organization Slash commands for an organization.
- The project list query returns all active project Slash commands for a project.
- List queries are readable by members who can view the owning organization or project.
- The single-prompt read query returns `null` for a project Prompt the caller cannot reach, the same as for one that does not exist: a stale or cross-project URL belongs on the not-found card, not on the route error boundary. A project list query still throws, because that page needs the project itself.
- The list query returns full `content`, not only card summaries.
- A dedicated composer catalog query returns command items shaped for preloading:
  - `id`
  - `scope`
  - `key`
  - `canonicalKey`
  - `displayLabel`
  - `description`
  - `content`
  - `autoExpand`
  - `autoSubmit`
- Thread composer flows load the relevant Slash command catalog upfront so typing a command key can resolve without a follow-up lookup. Project-route composers load both project commands and organization commands.
- `createdBy` and `updatedBy` are stored but not displayed in v1.
- The backend module should keep scope-specific access control near the public functions, while sharing normalization, validation, preview derivation, and repository helpers across scopes.
- Legacy rows may temporarily contain a deprecated `title` field during rollout.
  Runtime reads and writes must not depend on it; the cleanup migration clears
  it before schema narrowing removes it completely.

## Organization Settings UI

- Prompts becomes a real organization settings route named `Prompts` in the existing organization settings navigation.
- Slash command management uses nested settings routes:
  - list: `/o/{organizationSlug}/settings/prompts`
  - create: `/o/{organizationSlug}/settings/prompts/new`
  - detail/edit: `/o/{organizationSlug}/settings/prompts/{promptId}`
- The page title is `Prompts`.
- The list surface shows Slash command rows:
  - displayed command key as the primary label
  - description or derived content preview
  - category badge on the right
  - `...` actions menu with `Edit` and `Delete` for managers
- The row is a link to the detail/edit route, so middle-click and modifier-click
  open the Prompt in a new tab; the menu's `Edit` is the same link. The Skills and
  Workflows lists share the row component and behave the same way.
- Categories render in a left-hand navigation column.
- The first category navigation item is `All`.
- The left category navigation includes one item per category after `All`.
- Slash commands with no category are grouped under `Uncategorized`.
- Prompt grouping/filtering by category happens client-side from the loaded organization Slash command list.
- Categories are sorted deterministically in the frontend.
- Rows sort by command key within the selected category or `All` view.
- Rows render the explicit description when present.
- Rows render a plain-text preview of `content` when description is absent.
- The list page includes client-side search.
- Search uses a shared search-input component with a leading search icon, following the Mozaiik `TableSearchInput` pattern.
- Search filters the already-loaded Slash command list on the client.
- Search matches displayed key, description, category, and derived content preview.
- Empty search returns all Slash commands in the selected category.
- When search has no matches, the page keeps category controls visible and renders an empty state that suggests adjusting the search.

## Project Settings UI

- Project settings include a `Prompts` section for project-scoped Slash commands.
- Project prompt management uses nested settings routes:
  - list: `/o/{organizationSlug}/{projectAlias}/settings/prompts`
  - create: `/o/{organizationSlug}/{projectAlias}/settings/prompts/new`
  - detail/edit: `/o/{organizationSlug}/{projectAlias}/settings/prompts/{promptId}`
- The project Prompts section uses the same list, create, edit, delete, category, search, and read-only detail patterns as organization Prompts.
- Users without `ProjectPermission.SLASH_COMMANDS_MANAGE` can view project prompts when they can view the project, but cannot create, edit, delete, or otherwise modify them.

## Create And Edit UI

- Create and edit use full-page routes, not modal dialogs.
- Create and edit headers include a `Back to prompts` link to the owning
  organization- or project-scoped Prompts list.
- Create and edit use explicit Save/Cancel controls.
- The command content field uses the shared MDX editor.
- The inline command content editor has a stable 420px height. Content that
  exceeds the available space scrolls inside the editor, while the wide editor
  remains available for longer prompts.
- The form includes:
  - key
  - optional description
  - optional category
  - auto-expand toggle
  - autosubmit toggle
  - content editor
- The key input carries a leading `/` addon, shared with the Skills name input
  (`docs/specs/skills.md#authoring`). The `/` is display only — it is never
  stored, and typing or pasting one is stripped.
- Validation errors should appear inline where possible.
- Duplicate-key conflicts should produce a user-facing error.
- Members with the scope's manage permission see editable fields on the detail/edit route.
- Members without the scope's manage permission see a rendered markdown preview on the detail route instead of a disabled editor.

## Delete UI

- Deleting a Slash command requires confirmation.
- The confirmation dialog shows the displayed key, for example `/review`.
- Confirming delete soft-deletes the Slash command.

## Headless Access (MCP and CLI)

- Prompts can be listed, created, and edited over the MCP server and the CLI.
  Deleting stays web-UI only.
- MCP tools are `list_prompts`, `create_prompt`, and `update_prompt`
  (`docs/specs/mcp-server.md`). CLI commands are `convoy prompts list`,
  `create`, and `update` (`docs/specs/cli-one-shot-commands.md`).
- One tool and one command cover both scopes rather than scope-specific
  variants, because scope is a stored field of the entity.
- MCP selects scope with `scope` (`project` by default) plus an optional
  `organization` slug or ID; the CLI uses `--scope` plus `--org`. When
  organization scope is requested without an explicit organization, the
  organization of the resolved project is used.
- Update and delete take a prompt ID only. Scope and permissions are derived
  from the stored prompt.
- Slash command queries and mutations accept an API key and authorize through
  the calling principal. Project access uses the shared project authorization
  path; organization access additionally requires the API key's organization
  scope to match the target organization, so a key scoped to one organization
  cannot reach another organization's prompts through its owner's memberships.
- **A key narrowed to specific projects cannot read or write organization
  prompts at all.** Organization prompts surface in the composer catalog of
  every project in the organization, so a key that can only reach one project
  must not reach them either — narrowing bounds both reads and writes, and the
  call fails with "API key is scoped to specific projects…". Only an unscoped
  key or one scoped to the organization with no project list qualifies.
- `organizations.core.getByRef` is the one key-aware way to name an
  organization from a headless surface (MCP's `organization` argument, the
  CLI's `--org`): it accepts a slug or an ID — the two are indistinguishable by
  shape — and resolves organizations that own no accessible project, which
  project-derived listings cannot.
- The composer catalog query stays UI-only and does not accept an API key.

## Composer Behavior

- Thread composers use a Tiptap-backed plain-text input for Slash command selection.
- The placeholder appears only when the composer document is empty. Empty
  paragraphs in populated drafts, including those left by pasted trailing
  newlines, never display it. Composer placeholder classes stay separate from
  global rich-text empty-paragraph styles (OS-2045).
- `Shift+Enter` inserts a hard line break and immediately keeps the new caret
  position inside the composer's visible scroll area.
- On touch-primary devices (`(pointer: coarse)`), plain `Enter` also inserts a
  hard line break, because on-screen keyboards have no `Shift+Enter`. The send
  button submits. Narrow desktop windows keep `Enter` to send (OS-2152).
- A hard line break counts as whitespace for the `/` trigger match, so typing
  `/` at the start of a `Shift+Enter` continuation line opens the suggestion
  menu exactly as it does on the first line. Command and file-mention pills
  count as non-whitespace content instead, so `/` directly after a pill stays
  plain text.
- Every project-route new-thread composer, including the task sidebar footer and
  task-row agent-thread popover, resolves the current project and organization
  and loads the same merged project-and-organization Slash command catalog as
  the full Threads page.
- Typed and pasted markdown stays literal text. Tiptap must not convert markdown syntax such as `#`, `**bold**`, or `[link](url)` into rich markdown nodes.
- Slash command rendering is separate from markdown parsing. Typing `/` opens a command suggestion menu, and selecting a non-auto-expand command inserts a custom command node.
- The command suggestion menu is compact: generic command icon, command name plus short secondary description text, and no chevron.
- Both suggestion menus (`/` commands and `@` file mentions) are dismissed by
  Escape and by the editor losing focus. The menu is portalled to the document
  body, and surfaces that cover the composer without unmounting it — the group
  strip's "+" opening an add-to-group draft, a panel tab overlaying the thread column
  — only make it inert, so a menu left open would float over the incoming
  surface detached from its own composer (OS-1679). Selecting an item does not
  count as losing focus.
- The secondary dropdown text uses the command description when present, otherwise a plain-text preview from the prompt content.
- A row's full line — label, argument hint, description — is its native hover
  `title`, because the row truncates and an argument hint is the first thing cut
  (OS-1806). A native title rather than the design-system tooltip: the menu can
  hold dozens of rows, and a long content preview is capped in the title.
- The command suggestion menu shows a scope badge for stored Convoy prompts, such as `Project` or `Organization`. Colliding project and organization commands appear as separate results with the same command label and different scope badges.
- Suggestion matches are ranked by how well the typed query matches the command
  key, best first (`matchComposerSlashCommands`, OS-1645):
  1. exact key
  2. key prefix — typing `/com` puts `/compact` above `/autocompact` and
     `/convex-create-component`
  3. prefix of a later `-`/`_`/`.` segment of the key, so `/com` reaches
     `/convex-create-component` before a match buried mid-word
  4. substring anywhere in the key
  5. substring of the scope-prefixed canonical key only
- Equal-rank matches sort by shorter key first, then catalog order, so a project
  and organization command with the same key stay in a stable order. An empty
  query (bare `/`) lists the whole catalog in catalog order.
- Matching is case-insensitive. A `project:`/`org:` query prefix restricts
  results to that scope and is stripped before the key is matched. Those two
  prefixes filter Prompts only; a Skill is matched by its own `skill:{name}`
  canonical key, so `/skill:` narrows the menu to Skills (`docs/specs/skills.md`).
- The visible command chip renders as `/command`.
- The stored command node keeps canonical identity:
  - `type="slash-command"`
  - command id
  - `scope`
  - stored `key`
  - scoped `canonicalKey`, for example `project:client-summary` or `org:client-summary`
  - `displayLabel`, for example `/client-summary`
- `autoExpand=true` replaces the typed or selected command with the Slash command content immediately in the composer as plain text.
- `autoExpand=false` preserves a compact command reference in the composer.
- `autoSubmit` is independent of `autoExpand`. When both are enabled, the
  expanded prompt content is submitted; when only `autoSubmit` is enabled,
  the trusted compact command reference is submitted and expanded by the
  existing backend processing path.
- Autosubmit is armed only when the user selects a stored Convoy prompt from
  the suggestion menu by click, Enter, or Tab. Merely typing an exact literal
  `/{key}` never submits, so a key may remain a prefix of a longer key.
- Autosubmit is eligible only when text outside the active suggestion range is
  whitespace. Existing text, another command reference, or an `@` file
  mention prevents autosubmit and leaves the selected command in the draft.
  Hard line breaks are whitespace here too, so an otherwise-empty multiline
  draft still autosubmits.
- Autosubmit uses the normal form submit path and must honor the visible Submit
  button's disabled state, including active submission and blocking attachment
  states. Ready attachments and an attached task are included because they are
  not composer text.
- Runtime-advertised agent commands autosubmit only for the no-argument
  built-ins allowlisted in `docs/specs/cli-runtime-commands.md` (currently
  `/compact`, OS-1614); every other agent command only inserts its text,
  because it still takes free-text arguments. Prompt configuration composers
  with sending controls hidden never autosubmit either.
- The shared behavior applies to sending composers on the Threads page, thread
  detail, task sidebar, and agent-assignment dialog. One
  command selection may cause at most one submission.
- Non-auto command refs serialize into user-visible display content as markdown links using the canonical command key:
  - `[{displayLabel}](convoy://command/{canonicalKey})`
  - example: `[/client-summary](convoy://command/org:client-summary)`
- Project Skills share the `/` trigger, the menu, and the pill; they serialize with their own `convoy://skill/{name}` scheme and resolve to a directive instead of expanding. See `docs/specs/skills.md` (Composer Mentions).
- On submit, the backend validates command refs against active Slash commands in the thread's project or organization.
- Saved command refs always carry the command id and a scope-prefixed `canonicalKey`; they resolve by id and never by key precedence. Bare-key precedence applies only to keys the user types in the composer.
- User-visible message chunks keep the display markdown link content, and thread message rendering displays only the command label as blue command text.
- The backend stores optional processed CLI content on the user message when command refs are present.
- Processed CLI content expands exact display markdown-link tokens for trusted command refs into Slash command content.
- Literal `/command` text is not expanded unless it is the selected command node's serialized markdown link.
- CLI worker reads use processed CLI content when present; normal UI message reads continue to use display chunks.
- Auto-expand does not execute an Agent, start a CLI thread, or send a message by itself; only the separate autosubmit setting can send.

## Deferred

- Personal Slash commands.
- Personal Slash command explicit prefix syntax.
- Server-side command preload caps and typeahead search for large command catalogs.
- Relational categories.
- Version history and audit UI.
- Import/export.
- Permission customization beyond the fixed role-permission mappings (org owner/admin for organization prompts; project admin/member for project prompts).
