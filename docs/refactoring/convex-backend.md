# Convex Backend Refactor

> The evergreen convention extracted from this plan lives in
> `docs/guidelines/convex/backend-development.md` (domain folders, repo files,
> error catalogs, `ensure` validation). The step-by-step recipe for migrating
> one domain is `docs/refactoring/convex-domain-playbook.md`. This document
> tracks overall migration order and per-domain risk.

## Summary

Refactor the Convex backend folder structure away from the current flat "bag of things" layout into domain folders where callable Convex modules are colocated at the domain root and implementation/support code lives under domain-local `lib/` folders.

The goal is to make the generated Convex API easier to navigate, prevent top-level files like `organizations.ts`, `projects.ts`, and `tasks.ts` from becoming god files, and move domain-private implementation helpers out of root `convex/lib/`.

The target end state is strict: the Convex root contains only framework/config modules and their tests. Every callable product/domain module, including small single-file domains, lives in a domain folder.

## Proposed Convention

Callable Convex modules live directly under a domain folder that matches the table/domain language:

```txt
convex/<domains>/*.ts       = callable Convex modules / generated API surface
convex/<domains>/lib/*.ts   = domain-private implementation helpers
convex/lib/*.ts             = truly shared cross-domain backend infrastructure
```

Use plural domain folders to stay aligned with table names and existing generated API language:

```txt
tasks/
projects/
organizations/
```

This keeps migrations mostly mechanical. For example, existing task references move from `api.tasks.*` toward `api.tasks.<module>.*` instead of changing both pluralization and module structure.

For singleton/camelCase domains that do not naturally pluralize, keep the existing domain name as the folder name:

```txt
appVersion/
userPreferences/
apiKeys/
```

Convex module paths must remain valid Convex paths: use camelCase/alphanumeric names and no hyphens.

## Domain Folder Examples

Example for projects:

```txt
convex/
  projects/
    core.ts              // api.projects.core.*, internal.projects.core.*
    members.ts           // api.projects.members.*
    settings.ts          // only when project settings become their own callable surface

    lib/
      projectsRepo.ts    // direct-import DB helpers
      validators.ts
      publicShape.ts
      permissions.ts     // only if project-specific
```

Example for organizations:

```txt
convex/
  organizations/
    core.ts
    members.ts
    invitations.ts

    lib/
      organizationsRepo.ts
      membersRepo.ts
      invitationsRepo.ts
      validators.ts
      publicShape.ts
```

Example for tasks:

```txt
convex/
  tasks/
    queries.ts
    mutations.ts
    comments.ts
    attachments.ts
    artifacts.ts
    lists.ts
    activity.ts

    lib/
      tasksRepo.ts
      validators.ts
      publicShape.ts
      refs.ts
      ranking.ts
      tree.ts
      lifecycle.ts
      normalization.ts
      enrichment.ts
      write.ts
      statusPolicy.ts
      artifacts/
      lists/
```

`core.ts` is acceptable for smaller domains, but avoid turning it into the new god file. For larger domains, split callable modules during the move by capability, such as `tasks/queries.ts`, `tasks/mutations.ts`, `tasks/comments.ts`, and `tasks/lists.ts`.

## What Belongs In Domain `lib/`

Domain `lib/` is not "everything else". It is for domain-private implementation helpers:

- repo helpers that read/write the domain's tables through direct imports
- validators and return-shape builders
- public shape mappers
- normalization and parsing helpers
- ranking, refs, lifecycle, and status-policy helpers
- implementation helpers used by multiple callable modules in the same domain

Plain helpers in `domain/lib/*.ts` should be direct imports and should not export `query`, `mutation`, or `action` unless the file is intentionally part of the generated Convex function surface.

Repo files are named after the entity they read/write, in plural-entity + `Repo` form (`organizationsRepo.ts`, `membersRepo.ts`, `invitationsRepo.ts`, `tasksRepo.ts`) — never a bare `repo.ts`. This keeps imports self-describing when a domain has several repo files and when repo helpers appear in cross-file search results.

If an action must call a query or mutation via `ctx.runQuery` / `ctx.runMutation`, expose a small internal function under the domain callable surface. For example:

```ts
internal.organizations.core.getById
```

If the logic is only used from another query or mutation in the same runtime boundary, prefer a direct helper in `organizations/lib/organizationsRepo.ts`.

## Cross-Domain Import Rule

Domain-private code must stay private. A domain may import:

- its own `lib/`
- root `convex/lib/` shared infrastructure
- another domain's callable Convex modules through generated `api` / `internal` references when a function boundary is required
- another domain's explicitly exported contracts, if those contracts are intentionally public to other domains

A domain must not import another domain's `lib/` directly. For example, `tasks/lib/*` should not import `projects/lib/*`.

If two domains need the same helper, promote that helper to root `convex/lib/` only when it is genuinely domain-neutral. Otherwise, expose a narrow callable function or explicit contract from the owning domain.

Enforce this convention with ESLint, such as `no-restricted-imports` patterns or `eslint-plugin-boundaries`, in the same change that documents the convention. Without lint enforcement, the folder structure will drift.

## Root `convex/lib/`

Root `convex/lib/` should remain for cross-domain/platform code only:

```txt
convex/lib/access/
convex/lib/contracts/
convex/lib/http/
convex/lib/shared/
```

Current root `convex/lib/` domain folders should move into the owning domain:

```txt
convex/lib/tasks/*                  -> convex/tasks/lib/*
convex/lib/taskArtifacts/*          -> convex/tasks/lib/artifacts/*
convex/lib/taskLists/*              -> convex/tasks/lib/lists/*
```

Adapter-private implementation code should also move out of root `convex/lib/` when that adapter is migrated:

```txt
convex/lib/mcp/*                    -> convex/mcp/lib/*
convex/lib/cli/*                    -> convex/cli/lib/*
```

## Top-Level Files That Stay Top-Level

Do not move framework/config root files as part of this refactor:

```txt
convex/schema.ts
convex/http.ts
convex/auth.config.ts
convex/convex.config.ts
convex/migrations.ts
```

Keep `convex/migrations.ts` at the root unless migration-state behavior has been verified. The project uses `@convex-dev/migrations`, and migration state may key off function names/paths; renaming this module could make completed migrations appear un-run.

Root tests may stay only when they test one of those root framework/config modules:

```txt
convex/schema.test.ts
convex/auth.test.ts
convex/migrations.test.ts
```

Do not leave product/domain callable modules at the Convex root just because they are currently small. That creates misleading precedent for future agents and developers.

## Runtime Compatibility: Scheduled Functions

Persisted scheduled-function references are the main runtime risk that TypeScript cannot catch.

Convex stores scheduled jobs by function path. If a module is renamed while old scheduled jobs still point at the old path, those jobs can fail later even though the deploy type-checks.

Before deleting or renaming any callable module, audit scheduler usage into that domain:

```bash
rg "scheduler\\.run" apps/web/convex
```

At the time of the migration, audited references included:

```txt
apps/web/convex/lib/tasks/write.ts
  internal.tasks.permanentlyDelete
  Long-lived: scheduled 30 days after soft delete.

apps/web/convex/cliThreads.ts
  CLI watchdog scheduling.
  Short-lived: keep compatibility for at least one deploy cycle.

apps/web/convex/cliMessages.ts
  stream watchdog scheduling.
  Short-lived: keep compatibility for at least one deploy cycle.

apps/web/convex/cliProfiles.ts
  internal.cliProfiles.cleanupDeletedProfileSessions
  Short-lived/immediate cleanup scheduling.

apps/web/convex/tasks/comments.ts
apps/web/convex/lib/tasks/activityLogger.ts
  internal.taskActivityLogs.logActivity
  Short-lived/immediate activity-log scheduling.
```

For long-lived scheduled jobs, keep a shim at the old path until all scheduled jobs have drained. For example, when moving `internal.tasks.permanentlyDelete`, retain a minimal `convex/tasks.ts` export named `permanentlyDelete` that delegates to the new implementation for at least 30 days after deploy, or write a one-off migration that reschedules pending jobs onto the new reference before deleting the shim.

For short-delay jobs, keep a shim through at least one deploy cycle unless pending scheduled jobs are known to be drained.

Add this as a required step for every domain migration:

1. Audit `ctx.scheduler.runAfter` / `ctx.scheduler.runAt` references involving the domain.
2. Classify each reference as long-lived or short-lived.
3. Keep a shim or explicitly drain/reschedule pending jobs.
4. Only delete the old callable module path after the compatibility window has passed.

## Current Repo Examples To Migrate

Current top-level callable modules should move toward domain folders.

Small callable domains:

```txt
convex/appVersion.ts               -> convex/appVersion/core.ts
convex/userPreferences.ts          -> convex/userPreferences/core.ts
convex/users.ts                    -> convex/users/core.ts
convex/apiKeys.ts                  -> convex/apiKeys/core.ts
```

Organizations:

```txt
convex/organizations.ts             -> convex/organizations/core.ts
convex/organizationMembers.ts       -> convex/organizations/members.ts
convex/organizationInvitations.ts   -> convex/organizations/invitations.ts
convex/organizationsInternal.ts     -> see decision rule below
```

Projects:

```txt
convex/projects.ts                  -> convex/projects/core.ts
convex/projectMembers.ts            -> convex/projects/members.ts
```

Tasks:

```txt
convex/tasks.ts                     -> split into convex/tasks/queries.ts, mutations.ts, and capability modules as appropriate
convex/taskComments.ts              -> convex/tasks/comments.ts
convex/taskAttachments.ts           -> convex/tasks/attachments.ts
convex/taskArtifacts.ts             -> convex/tasks/artifacts.ts
convex/taskLists.ts                 -> convex/tasks/lists.ts
convex/taskActivityLogs.ts          -> convex/tasks/activity.ts
```

Do not blindly move `tasks.ts` to `tasks/core.ts`. Since the migration already touches generated API references, split the god file during the move instead of forcing a second API-path rename later.

CLI:

```txt
convex/cliThreads.ts                -> convex/cli/threads.ts
convex/cliMessages.ts               -> convex/cli/messages.ts
convex/cliMessageChunks.ts          -> convex/cli/messageChunks.ts
convex/cliSessions.ts               -> convex/cli/sessions.ts
convex/cliProfiles.ts               -> convex/cli/profiles.ts
convex/lib/cli/*                    -> convex/cli/lib/*
```

The CLI domain has scheduler compatibility concerns, so migrate it after the domain convention and scheduler-shim process are proven.

MCP adapter code:

```txt
convex/lib/mcp/*                    -> convex/mcp/lib/*
```

Keep callable/route modules under `convex/mcp/` and adapter-private implementation under `convex/mcp/lib/`.

## `organizationsInternal.ts` Decision Rule

Do not leave the `organizationsInternal.ts` move as a vague "depends" item. Inspect each export:

- If it is invoked through `ctx.runQuery`, `ctx.runMutation`, `ctx.runAction`, or the scheduler, keep it as a callable Convex function under the domain surface, such as `internal.organizations.core.getById`.
- If it is only used through direct imports from other Convex code in the same runtime boundary, move the implementation into `organizations/lib/organizationsRepo.ts`.

For OS-933-style URL enrichment from an action/handler path, a small internal query under `organizations/core.ts` is appropriate because the caller needs a Convex function boundary.

## Tests

Tests should move with their modules:

```txt
convex/organizations.test.ts        -> convex/organizations/core.test.ts
convex/organizationMembers.test.ts  -> convex/organizations/members.test.ts
convex/projects.test.ts             -> convex/projects/core.test.ts
convex/projectMembers.test.ts       -> convex/projects/members.test.ts
```

The current Convex test harness already supports nested modules through recursive globs, so nested test files should not require harness changes.

## Suggested Migration Strategy

1. Document the convention and add import-boundary lint rules before moving large domains.
2. Start with a tiny callable domain, preferably `appVersion`, to prove generated API path migration with minimal risk.
3. Move the remaining small callable domains, such as `userPreferences` and `users`.
4. Move MCP private helpers from `convex/lib/mcp/*` to `convex/mcp/lib/*`.
5. For each callable domain, audit scheduled functions and add shims or drain/reschedule jobs before deleting old callable paths.
6. Move `organizations` and `projects` to establish the convention across multi-module domains.
7. Move `apiKeys` after the smaller generated API migrations, because it is central to auth/API-key access.
8. Update generated API references, tests, CLI/MCP callers, and specs as each domain moves.
9. Move domain-private helper folders from root `convex/lib/` into the owning domain.
10. Move task-related modules after the convention is proven, because `tasks` has the largest blast radius.
11. Split large modules during their move, especially `tasks.ts`.
12. Move CLI callable modules and CLI private helpers after the core domain migration path is proven.
13. Keep compatibility/transition concerns explicit in docs/specs so generated API path changes are not surprising.

## Migration Inventory By Complexity

Complexity is based on generated API call-site churn, number of callable exports, helper-folder moves, scheduler compatibility risk, and test surface.

### 1. Easiest Callable Pilot: App Version — DONE (2026-06-11)

```txt
convex/appVersion.ts       -> convex/appVersion/core.ts
convex/appVersion.test.ts  -> convex/appVersion/core.test.ts
```

Implemented with a temporary root re-export shim for stale browser bundles (see `convex-app-version-pilot.md`, including the shim-removal follow-up). The stale-bundle refresh prompt is handled by the existing Convex-independent `AppVersionWatcher` banner.

Why first:

- Smallest callable domain: 1 export, roughly 32 LOC, and only a few generated API references.
- No scheduled-function compatibility risk.
- Proves the generated API path change from `api.appVersion.get` to `api.appVersion.core.get`.
- Establishes that even small domains do not stay at the Convex root.

Validation:

```bash
pnpm --filter @convoy/web exec vitest run convex/appVersion/core.test.ts
cd apps/web && npx tsc --noEmit
```

### 2. Low Risk: User Preferences — DONE (2026-06-11)

```txt
convex/userPreferences.ts       -> convex/userPreferences/core.ts
convex/userPreferences.test.ts  -> convex/userPreferences/core.test.ts
```

Why next:

- Small callable domain: 2 exports, roughly 87 LOC, and limited generated API references.
- No known scheduled functions.
- Exercises a real user-scoped table without broad app behavior.

Implemented with `lib/userPreferencesRepo.ts` (callable module no longer
touches `ctx.db`), `buildPatch` for the upsert's optional fields, a root
re-export shim for stale browser bundles (covered by
`userPreferences/shims.test.ts`; delete together one deploy cycle later),
and the `use-user-preferences` hook rewritten to `api.userPreferences.core.*`.

**Superseded (2026-06-12)**: preferences are a users sub-entity, so the domain
relocated to `convex/users/preferences.ts` (`api.users.preferences.*`) with
`users/lib/preferencesRepo.ts`, matching the organizations core/members shape.
A transitional shim covers the legacy root path (`convex/userPreferences.ts`;
the short-lived
`api.userPreferences.core.*` path only ever existed on dev deployments and is
not shimmed); covered by `users/shims.test.ts` and
deleted one deploy cycle later .

### Structure conventions settled during the 2026-06-12 cleanup

- Adapter (`mcp/`) lib and handlers mirror the domain tree with entity
  subfolders (`mcp/lib/tasks/lists/…`, `mcp/handlers/tasks/lists.ts`, CRUD in
  `tasks/core.ts`) and a fixed role-file vocabulary: `parsers` (tool args in),
  `formatters` (results out), `resolution` (identifier → entity via the api),
  `guards` (runtime narrowing only where the validator is genuinely loose).
- `tasks/lib/lists` uses role files: `naming.ts` (ref/name/color grammar and
  validation), `resolution.ts` (identifier + default-List resolution, absorbed
  `defaultList.ts`), `invariants.ts` (lifecycle rules, ex-`guards.ts`),
  `validators.ts` (shapes). `defaultList.test.ts` moved to
  `tasks/listsDefault.test.ts` ahead of item 11.
- `lib/contracts/colors.ts` dissolved to its owners (project color validation
  in `projects/core.ts`, list color validation in `tasks/lib/lists/naming.ts`).
  `lib/contracts/validators.ts` stays: it is the schema's enum/shape mirror —
  anything `schema.ts` references must live at root; return-shape-only
  validators move out with their domains (apiKeys at item 9, cli* at item 13).

### 3. Low-Medium Risk: Users — DONE (2026-06-11)

```txt
convex/users.ts       -> convex/users/core.ts
convex/users.test.ts  -> convex/users/core.test.ts
```

Why after user preferences:

- Still small, but auth/onboarding paths are more central than preferences.
- No known scheduled functions.
- Generated API references are moderate and type-checkable.

Implemented with `usersRepo` extensions (`getUserByTokenIdentifier`,
`updateUserProfile`, and `upsertUserFromIdentity`, which dedupes the
identical identity-upsert blocks `store` and `onboard` carried).
`onboard`'s cross-domain writes now go through the organizations and
projects repos (`insertOrganization`, org/project `insertMembership`,
`insertProject`). Root re-export shim for stale browser bundles
(covered by `users/shims.test.ts`; delete one deploy cycle later).
The move also fixed a latent bug: `onboard`'s starter project now
creates the Inbox List and sets `defaultListId`, matching the
task-lists spec invariant that `projects.core.create` already upheld
(previously onboarded starter projects relied on the
`ensureProjectInbox` backfill).

### 4. Low-Medium Risk: MCP Private Helpers — DONE (2026-06-11)

```txt
convex/lib/mcp/* -> convex/mcp/lib/*
```

Why this is a good early structural cleanup:

- `convex/mcp/` already exists, so this avoids the file-plus-folder namespace question.
- This is mostly direct import rewriting from MCP handlers/tests.
- No public MCP tool contract should change.
- No scheduled-function compatibility risk.

Implemented as a pure `git mv` + import rewrite (no behavior change). Both
layouts sit two levels below `convex/`, so in-tree relative imports survived
unchanged; the only breakage was the two imports escaping into
`convex/lib/taskLists/*` (`resolve`, `publicShape`), which needed one extra
`../`. (Resolved in step 6: those pieces turned out to be contracts and moved
to `convex/lib/contracts/`, so no cross-domain `tasks/lib` import exists.)

Validation:

```bash
pnpm --filter @convoy/web exec vitest run convex/mcp/handler.test.ts convex/mcp/tools.test.ts
cd apps/web && npx tsc --noEmit
```

### 5. Low Risk: Task Artifact Private Helpers — DONE (2026-06-11)

```txt
convex/lib/taskArtifacts/* -> convex/tasks/lib/artifacts/*
```

Why this is still low risk:

- Only 4 helper files.
- The callable `taskArtifacts.ts` module can remain in place for this step.
- No generated API contract needs to change if only helper imports move.

Watch:

- This creates `convex/tasks/lib/*` while `convex/tasks.ts` still exists. **Verified by the appVersion pilot (2026-06-11)**: Convex codegen handles file-plus-folder coexistence — `convex/appVersion.ts` and `convex/appVersion/core.ts` register as `appVersion` and `appVersion/core`, and the generated types merge both into the `api.appVersion` namespace. A root-file shim can be a plain re-export (`export { get } from "./appVersion/core";`), which registers the same function under both paths.

Implemented as a pure move (4 files); the import-boundary consequences are
handled by the transitional ESLint carve-out described under step 6.

### 6. Low-Medium Risk: Task List Private Helpers — DONE (2026-06-11)

```txt
convex/lib/taskLists/* -> convex/tasks/lib/lists/*       (domain-private pieces)
convex/lib/taskLists/keys.ts        -> convex/lib/contracts/taskListKeys.ts
convex/lib/taskLists/publicShape.ts -> convex/lib/contracts/taskListShapes.ts
getTaskListIdentifierError          -> convex/lib/contracts/taskListIdentifier.ts
createInboxList                     -> convex/tasks/lib/taskListsRepo.ts
```

Why it is harder than task artifacts:

- More helper files.
- Used by `tasks.ts`, `taskLists.ts`, default-list tests, and migrations tests.
- Still no generated API change if only helpers move.

Implementation deviated from the plain move because the tree turned out to be
three different strata, and the import-boundary lint makes the distinction
load-bearing:

- **Contracts** (consumed by MCP, root `lib/tasks` validators, migrations,
  convex-testing): the listKey grammar (`keys.ts`), the public shape
  validators (`publicShape.ts`, including `mcpTaskListSummaryValidator`), and
  the list-identifier grammar. These promoted to root `convex/lib/contracts/`
  — they are cross-domain contract by nature, so domain-private placement was
  wrong, not merely inconvenient.
- **Domain-private logic** (`resolve.ts`, `guards.ts`, `refs.ts`,
  `defaultList.ts`) → `convex/tasks/lib/lists/`.
- **Repo-grade DB access**: `createInboxList` moved to
  `convex/tasks/lib/taskListsRepo.ts` so `projects.core.create` and
  `users.core.onboard` import it under the `*Repo` cross-domain exception.

A transitional ESLint carve-out (in `apps/web/eslint.config.mjs`, above the
boundary rule) lets the legacy tasks-domain modules still living outside
`convex/tasks/` (`tasks.ts`, `taskLists.ts`, `taskArtifacts.ts`,
`taskComments.ts`, their tests, and `convex/lib/tasks/**`) import
`convex/tasks/lib/*`; delete it when steps 11–12 move them. `migrations.ts`
keeps the exception permanently — backfills are cross-domain data surgery.

### 7. Best First Multi-Module Domain Migration: Organizations — DONE (2026-06-11)

```txt
convex/organizations.ts             -> convex/organizations/core.ts
convex/organizationMembers.ts       -> convex/organizations/members.ts
convex/organizationInvitations.ts   -> convex/organizations/invitations.ts
convex/organizationsInternal.ts     -> convex/organizations/core.ts or convex/organizations/lib/organizationsRepo.ts by decision rule
```

Why this is the best first generated-API migration:

- Coherent domain with clear module names.
- No known scheduled functions.
- Moderate size: 4 callable files, roughly 1.2k LOC, and about 144 generated API references.
- Exercises the real convention: callable modules at domain root plus domain-local support code if needed.

Expected API shape:

```txt
api.organizations.core.*
api.organizations.members.*
api.organizations.invitations.*
internal.organizations.core.getByIdInternal
```

Implemented per `convex-organizations.md` with temporary root re-export shims
(including old long invitation names) for stale browser bundles. The
cross-domain `convex/<domain>/lib/*` import boundary is now lint-enforced in
`apps/web/eslint.config.mjs`. Learning: component tests that hand-mock
`@/convex/_generated/api` (e.g. `task-types-section.test.tsx`) need their mock
shape updated with the API rename — vitest deep-equality on Convex API proxy
references passes vacuously, so stale function-reference assertions in tests
(e.g. `mcp/handler.test.ts`) do NOT fail on their own; grep for old refs
explicitly after each migration.

### 8. Medium Risk: Projects — DONE (2026-06-11)

```txt
convex/projects.ts       -> convex/projects/core.ts
convex/projectMembers.ts -> convex/projects/members.ts
```

Why after organizations:

- No known scheduled functions.
- Fewer callable files, but more broad app/CLI usage.
- `api.projects.listAccessible` is used heavily by CLI commands and project resolution.

Implemented API shape:

```txt
api.projects.core.*
api.projects.members.*    (listByProject renamed to members.list)
```

Implemented per `convex-projects.md` with temporary root re-export shims for
stale browser bundles (`projects/shims.test.ts` covers them; delete together
one deploy cycle later). Repos, `errors.ts` catalog, `ensure` guards, and
`join`-based user/org enrichment landed with the move; behavior and error
messages unchanged. The org-migration lesson repeated: a component test
hand-mocking `@/convex/_generated/api` (`project-member-row.test.tsx`) needed
its mock shape updated.

### 9. Medium-High Risk: API Keys — DONE (2026-06-12)

```txt
convex/apiKeys.ts       -> convex/apiKeys/core.ts
convex/apiKeys.test.ts  -> convex/apiKeys/core.test.ts
```

Why it is not an early pilot:

- 10 callable exports and roughly 492 LOC.
- High generated API/reference churn for its size.
- Central to API-key auth and access behavior, including internal validation and usage-recording functions.
- No known scheduled functions, but validation must include MCP/CLI flows that depend on API-key auth.

Implemented API shape (function names unchanged):

```txt
api.apiKeys.core.*        create | list | deleteKey | update
internal.apiKeys.core.*   validateByHash | validateByKey | recordUsage* variants
```

Implemented with `lib/apiKeysRepo.ts` (table access + `touchLastUsedAtIfStale`
staleness gating), `lib/scope.ts` (scope validation/formatting on the
organizations/projects repos with `ensure`; `projectsRepo` gained the
`getProjectsByIds` batch getter), `lib/validators.ts`
(`apiKeyListItemValidator` evicted from `lib/contracts/validators.ts` — it is
a return shape, not a schema mirror; the scope validators stay in contracts
because `schema.ts` and `cliSessions.ts` use them), and an `errors.ts`
catalog. `ensure` gained `.gt`. The API key table read inside
`lib/access/auth.ts` stays there per the access-infra layering precedent.
Root shim re-exports all ten functions (`apiKeys/shims.test.ts`; delete one
deploy cycle later). `http.ts`, `lib/http/agentAuth.ts`, the four settings UI
components, specs, and the many tests that mint keys in setup all rewritten
to `*.apiKeys.core.*`.

### 10. Medium Risk: CLI Private Helpers — DONE (2026-06-18)

```txt
convex/lib/cli/* -> convex/cli/lib/*   (DONE 2026-06-18, see convex-cli-helpers.md)
```

Whole 27-file helper tree (runtime registry, message/path/profile helpers,
chunk normalization, and 4 tests) moved with `git mv`; no callable
`api.*`/`internal.*` surface changed (generated `api.d.ts` diff is path renames
only), so no shim was required. The move turns `convex/cli/lib/` into a
**cli-domain private lib**, so the then-still-at-root callable cli modules plus
two cross-domain consumers (`lib/http/registerBody.ts`,
`lib/contracts/validators.ts`) needed a **transitional eslint carve-out**
(mirrors the tasks one) until item 13 moves the callable modules into
`convex/cli/`. As of item 13 (DONE 2026-06-19) the callable modules have all
moved, so the carve-out now covers only the two cross-domain consumers; delete it
when they are re-homed off `cli/lib/runtimes/*` (see `convex-cli-threads.md`
"Follow-up"). See `docs/refactoring/convex-cli-helpers.md`.

Why it was not first:

- Large helper tree: runtime registry, message helpers, path/profile helpers, and tests.
- No generated public API contract should change if only helper imports move.
- It is still broad enough that it should happen after one smaller helper move proves the process.

### 11. Medium-High Risk: Task Leaf Callable Modules — DONE (2026-06-18)

All five task leaves migrated; every old root `task*.ts` is now a one-deploy-cycle
re-export shim. Original guidance kept below for the record.

Move these after deciding how to handle `tasks.ts` plus `tasks/*` coexistence, or as part of the larger task-domain split:

```txt
convex/taskAttachments.ts   -> convex/tasks/attachments.ts  (DONE 2026-06-18, see convex-task-attachments.md)
convex/taskArtifacts.ts     -> convex/tasks/artifacts.ts  (DONE 2026-06-18, see convex-task-artifacts.md)
convex/taskComments.ts      -> convex/tasks/comments.ts  (DONE 2026-06-18, see convex-task-comments.md)
convex/taskLists.ts         -> convex/tasks/lists.ts   (DONE 2026-06-18, see convex-task-lists.md)
convex/taskActivityLogs.ts  -> convex/tasks/activity.ts  (DONE 2026-06-18, see convex-task-activity.md)
```

Relative order inside this group:

1. `taskAttachments.ts` is the smallest leaf, but calls `internal.taskActivityLogs.logActivity`. **DONE (2026-06-18)** — moved to `convex/tasks/attachments.ts` (`api.tasks.attachments.*`) with a one-deploy-cycle shim; the `internal.taskActivityLogs.logActivity` call site stays on the legacy internal path until `taskActivityLogs` migrates. See `docs/refactoring/convex-task-attachments.md`.
2. `taskArtifacts.ts` has helper files and MCP usage. **DONE (2026-06-18)** — moved to `convex/tasks/artifacts.ts` (`api.tasks.artifacts.*`) with a one-deploy-cycle shim; the `internal.taskActivityLogs.logActivity` schedules stay on the legacy internal path until `taskActivityLogs` migrates. See `docs/refactoring/convex-task-artifacts.md`.
3. `taskComments.ts` has attachment/upload behavior and schedules activity logging. **DONE (2026-06-18)** — moved to `convex/tasks/comments.ts` (`api.tasks.comments.*`) with a one-deploy-cycle shim; the `internal.taskActivityLogs.logActivity` schedule stays on the legacy internal path until `taskActivityLogs` migrates. See `docs/refactoring/convex-task-comments.md`.
4. `taskLists.ts` has broad UI/CLI usage and default-list behavior. **DONE (2026-06-18)** — moved to `convex/tasks/lists.ts` (`api.tasks.lists.*`) with a one-deploy-cycle shim; see `docs/refactoring/convex-task-lists.md`.
5. `taskActivityLogs.ts` is small, but old scheduled `internal.taskActivityLogs.logActivity` calls can exist, so it needs a short-lived shim. **DONE (2026-06-18)** — moved to `convex/tasks/activity.ts` (`api.tasks.activity.*`, `internal.tasks.activity.logActivity`) with a one-deploy-cycle shim. The shim re-exports `logActivity`/`listByTask` plus the `eventTypeValidator`/`changeDetailsValidator` (`schema.ts` now imports them from `./tasks/activity`), and all ~20 scheduler call sites (`lib/tasks/activityLogger.ts`, `tasks/{artifacts,attachments,comments}.ts`) were repointed to the new internal path in the same change. This was the last task leaf. See `docs/refactoring/convex-task-activity.md`.

The default-list test should move with the task-list domain:

```txt
convex/defaultList.test.ts -> convex/tasks/listsDefault.test.ts
```

### 12. High Risk: Core Tasks — DONE (2026-06-20)

```txt
convex/lib/tasks/*  -> convex/tasks/lib/*                       (DONE, see step 5 / convex-core-tasks.md)
convex/tasks.ts     -> convex/tasks/core.ts (api.tasks.core.*)  (DONE, capabilities under tasks/core/*)
```

Done as a `tasks/core` namespace, not a `queries.ts`/`mutations.ts` verb split.
The core entity's CRUD/reads live in `tasks/core.ts` (`api.tasks.core.*`); its
capabilities split into `tasks/core/{bulk,rank,move,search}.ts`
(`api.tasks.core.bulk.*`, etc.), symmetric with the sub-entities
(`api.tasks.lists.*`, `api.tasks.comments.*`). Full plan and rationale in
`docs/refactoring/convex-core-tasks.md`.

How the high-risk points were handled:

- Largest generated API surface (~25 callables, ~495 references) — extracted one
  capability per commit behind re-export shims, then swept callers in a single
  mechanical `api.tasks.X` → `api.tasks.core.X` commit (dual web/CLI typecheck +
  MCP string-mock updates gating each step).
- Largest test surface (`tasks.test.ts` ~4.8k lines) — `git mv`'d to
  `convex/tasks/core.test.ts`, with the bulk/rank/search suites extracted to
  `core/{bulk,rank,search}.test.ts` (colocated with their modules; `move` stays
  in `core.test.ts`, interwoven with the subtask/authorization suites).
- Long-lived scheduled `internal.tasks.permanentlyDelete` — the transitional
  `convex/tasks.ts` re-export shim keeps the old internal path resolvable while
  `tasksRepo` schedules `internal.tasks.core.permanentlyDelete`.

Phase C cleanup removed the public `api.tasks.*` shims and shrank the eslint
carve-out to migrations-only. The residual `internal.tasks.permanentlyDelete`
shim and its legacy-path test were removed on 2026-07-19 after the scheduled-job
compatibility window elapsed. See `convex-core-tasks.md`.

### 13. Highest Risk: Callable CLI Domain — DONE (2026-06-19)

Migrated one module per commit (hub `cliThreads` last). Progress:

```txt
convex/cliMessageChunks.ts  -> convex/cli/messageChunks.ts  (DONE 2026-06-18, api.cli.messageChunks.*, see convex-cli-message-chunks.md)
convex/cliSessions.ts       -> convex/cli/sessions.ts        (DONE 2026-06-18, api.cli.sessions.* / internal.cli.sessions.*, see convex-cli-sessions.md)
convex/cliProfiles.ts       -> convex/cli/profiles.ts        (DONE 2026-06-18, api.cli.profiles.* / internal.cli.profiles.*, see convex-cli-profiles.md)
convex/cliMessages.ts       -> convex/cli/messages.ts        (DONE 2026-06-19, api.cli.messages.*, see convex-cli-messages.md)
convex/cliThreads.ts        -> convex/cli/threads.ts         (DONE 2026-06-19, api.cli.threads.* / internal.cli.threads.*, see convex-cli-threads.md)
```

The five root CLI compatibility shims and their legacy-path tests were removed
on 2026-07-19 after the deploy-cycle compatibility window elapsed.

Why the hub was last (all handled):

- Large state-machine surface — moved behind the consolidated `cliThreadsRepo.ts` (all 40 `ctx.db.` sites now repo calls; the foreign seam `cli/messages.ts` created is folded in).
- Large tests — `cliThreads.test.ts` (3069 lines) moved via `git mv` to `convex/cli/threads.test.ts`.
- Multiple scheduled watchdog/cleanup functions — both `internal.cliThreads.{streamingWatchdogTick,reconcileClaimsForSessionDisconnect}` kept as one-deploy-cycle re-export shims; all three caller modules (`cli/messages.ts`, `cli/profiles.ts`/`cli/sessions.ts` via `cli/lib/disconnectSession.ts`) repointed to `internal.cli.threads.*`.
- The CLI app consumes generated API types — `apps/cli/src/agent/app/{runner,thread-processor}.ts` repointed; both web `tsc` and `pnpm --filter @useconvoy/cli typecheck` pass.

Remaining item-13 cleanup (separate change): re-home the two cross-domain
consumers (`lib/http/registerBody.ts`, `lib/contracts/validators.ts`) off
`convex/cli/lib/runtimes/*` and delete the last eslint carve-out block. See
`convex-cli-threads.md` ("Follow-up").

## Deliberately Not In The Migration

These root files should stay top-level:

```txt
convex/schema.ts
convex/http.ts
convex/auth.config.ts
convex/convex.config.ts
convex/migrations.ts
```

No product/domain callable modules should remain at the Convex root after this migration.

## Acceptance Criteria

- A documented Convex backend folder convention exists and is referenced by project docs/AGENTS or a spec.
- Import-boundary rules are lint-enforced.
- Organization modules use `convex/organizations/*` with callable modules at the root and support code under `convex/organizations/lib/*`.
- Project modules use `convex/projects/*` with callable modules at the root and support code under `convex/projects/lib/*`.
- Domain-private helpers are not left under root `convex/lib/` after their domain migrates.
- Scheduled-function references are audited before each callable module rename.
- Long-lived scheduled functions keep old-path shims until pending jobs drain or are rescheduled.
- Existing behavior and permissions remain unchanged.
- Generated Convex API references are updated in app, CLI, MCP handlers, tests, and docs.
- AGENTS.md and CLAUDE.md are updated in the same PRs so future agent guidance does not point at stale paths like `convex/tasks.ts`.
- After the full migration, the Convex root contains no product/domain callable modules; only framework/config modules remain.
- Validation passes for affected Convex tests, web lint, web TypeScript, CLI TypeScript, and relevant CLI tests.

## Validation

Run targeted tests for each migrated domain plus standard Convex/web validation:

```bash
pnpm --filter @convoy/web exec vitest run convex/appVersion/core.test.ts convex/userPreferences/core.test.ts convex/users/core.test.ts
pnpm --filter @convoy/web exec vitest run convex/organizations/core.test.ts convex/projects/core.test.ts
pnpm --filter @convoy/web exec vitest run convex/organizations/members.test.ts convex/projects/members.test.ts
pnpm --filter @convoy/web exec vitest run convex/mcp/handler.test.ts
pnpm web:lint
cd apps/web && npx tsc --noEmit
pnpm --filter @useconvoy/cli typecheck
```

For the later task-domain migration, include task-specific suites:

```bash
pnpm --filter @convoy/web exec vitest run convex/tasks/queries.test.ts convex/tasks/mutations.test.ts
pnpm --filter @convoy/web exec vitest run convex/tasks/lists.test.ts convex/tasks/artifacts.test.ts convex/tasks/comments.test.ts convex/tasks/attachments.test.ts convex/tasks/activity.test.ts
```

For CLI-domain migration, include CLI validation:

```bash
pnpm --filter @useconvoy/cli typecheck
pnpm --filter @useconvoy/cli test:once
```

Run scheduler-reference audits before and after each domain move:

```bash
rg "scheduler\\.run" apps/web/convex
rg "internal\\.tasks|internal\\.cliThreads|internal\\.cliMessages|internal\\.cliProfiles|internal\\.taskActivityLogs" apps/web/convex
```
