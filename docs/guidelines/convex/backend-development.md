# Convex Backend Development Guidelines

How to structure backend code under `apps/web/convex/`: how domains are split into files, what belongs in each file, and how to write guard validations with `ensure`. The `convex/organizations/` domain is the reference implementation for everything below.

For the migration plan that moves legacy root modules into this structure, see `docs/refactoring/convex-backend.md`. This document is the evergreen convention; the refactoring doc tracks how we get there.

---

## Domain Folder Layout

Every product domain lives in its own folder under `convex/`. The Convex root contains only framework/config modules (`schema.ts`, `http.ts`, `auth.config.ts`, `convex.config.ts`, `migrations.ts`) and, transitionally, backward-compatibility shims.

```txt
convex/
  organizations/                    # one folder per domain, plural, matching table language
    core.ts                         # callable: api.organizations.core.*
    members.ts                      # callable: api.organizations.members.*
    invitations.ts                  # callable: api.organizations.invitations.*
    errors.ts                       # domain error-message catalog (no functions)
    core.test.ts                    # tests colocate with the module they test
    members.test.ts
    invitations.test.ts

    lib/                            # domain-PRIVATE implementation
      organizationsRepo.ts          # DB access for the organizations table
      membersRepo.ts                # DB access for organizationMembers (+ cascades)
      invitationsRepo.ts            # DB access for organizationInvitations
      validators.ts                 # shared return-shape validators

  lib/                              # cross-domain infrastructure ONLY
    access/                         # auth + permission helpers
    contracts/                      # schema-mirror validators (roles, statuses) + cross-domain
                                    # grammar/shapes (taskListKeys, taskDescription) — anything
                                    # schema.ts or multiple domains/adapters must share
    shared/                         # generic utilities (ensure, join, patch, pagination, strings)
    notifications/                  # email sending
```

Naming rules:

- Domain folders are plural and match table language (`organizations/`, `projects/`, `tasks/`). Singleton/camelCase domains keep their name (`appVersion/`, `apiKeys/`).
- A sub-entity of an existing domain is a module *inside* that domain, not its own domain: user preferences live at `users/preferences.ts` (`api.users.preferences.*`), not in a `userPreferences/` folder.
- Convex module paths allow no hyphens — use camelCase file names everywhere under `convex/`. Folders are fine: prefer `tasks/lists.ts` over `taskLists.ts` for sub-entity modules.

## How To Split Files

### Callable modules (domain root)

Split the callable surface by sub-entity or capability, one file per cohesive group of functions. The file name becomes the API namespace: `organizations/members.ts` → `api.organizations.members.*`.

- `core.ts` — the domain's primary entity (CRUD, lookups). For a small domain this is enough. When the **core entity itself** grows too large, keep CRUD/reads in `core.ts` and split its *capabilities* (actions on the one entity, not new entities) into a `core/` subfolder, one namespace per capability: `tasks/core/bulk.ts` → `api.tasks.core.bulk.*`, `tasks/core/{rank,move,search}.ts` → `api.tasks.core.{rank,move,search}.*`. The core entity thus reads as `api.tasks.core.*`, symmetric with its sub-entities (`api.tasks.lists.*`, `api.tasks.comments.*`). Prefer this over a flat `queries.ts`/`mutations.ts` split — grouping by verb scatters one capability's logic across files.
- One file per sub-entity that has its own table or lifecycle (`members.ts`, `invitations.ts`).
- Internal functions live in the same module as their public siblings with an `Internal` suffix when the public name is taken (`core.getById` is the member-scoped public query; `core.getByIdInternal` is the internal unscoped variant).

### Module folders (`<domain>/<module>/`)

A module graduates from a single file to a folder when it **owns a table and has 3+ private helpers**. Convex merges a file and a same-named folder into one api namespace (`tasks/core.ts` + `tasks/core/` both feed `api.tasks.core.*`), so a folder can grow beside its file or replace it outright. Inside the folder, split by capability exactly as at the domain root, and give the module its own `lib/`:

```txt
cli/
  threads/                          # module folder: one callable file per capability
    core.ts                         # api.cli.threads.core.*
    lists.ts                        # api.cli.threads.lists.*
    lib/                            # module-PRIVATE: only cli/threads/* may import
      cliThreadsRepo.ts
  lib/                              # domain-private: shared across cli modules
```

This makes three privacy tiers:

| Tier | Who may import it |
|---|---|
| `convex/lib/` | every domain |
| `<domain>/lib/` | every module of that domain |
| `<domain>/<module>/lib/` | only that module's files |

`*Repo` files stay importable across tier boundaries — a repo is its table's data-access contract wherever it lives (see Cross-Domain Imports). Shipped examples: `tasks/core/{search,bulk,rank,move}.ts` (capability split of the core entity), `cli/threads/` (in progress). Rationale and rejected alternatives: `docs/adr/0009-module-folders-inside-convex-domains.md`.

Below the graduation bar, a sub-entity stays a single file with its helpers in the domain `lib/` — do not create a folder for a module that has no private helpers to hide.

Integrations get one module folder per provider: `integrations/github/` today, `integrations/slack/` when Slack ships. Its schema contracts go in `convex/lib/contracts/<provider>.ts`, and only validators every provider uses stay in `contracts/integrations.ts`. Code moves up into `integrations/lib/` in the commit that gives it a second provider, never before. Don't group providers by category (`codeHosts/`, `issueTrackers/`). See `docs/adr/0013-one-folder-per-integration-provider.md`.

Callable modules orchestrate: auth → permission checks → guard validations → repo calls → side effects. They contain no direct `ctx.db` access — reads and writes go through repo functions (their own domain's, or another domain's `*Repo` for foreign tables).

This convention is lint-enforced for production Convex modules. Direct `ctx.db`
access is allowed only in `*Repo` files, `convex/lib/access/auth.ts` (the
authentication boundary), `convex/migrations.ts` (one-time cross-domain
backfills), and tests/convex-testing setup that intentionally build edge states.

### Entities vs. embedded fields

A separate callable module — and the `api.*` namespace it creates — is for an **entity**: something with its own table or lifecycle. An **embedded field or value-object on an existing entity does not get its own module, namespace, `lib/` sub-folder, or adapter handler file.** Its mutations/queries live on the owning domain's core module, and its helpers live as a flat file in the domain's `lib/`.

- `taskComments`, `taskArtifacts`, `taskLists` each own a table → each is its own module/namespace, and `tasks/lib/` mirrors that with one sub-folder per entity (`comments/`, `artifacts/`, `lists/`).
- `externalLinks` is an embedded array field on `tasks`, not an entity → its mutation is `api.tasks.core.updateExternalLink` (on `tasks/core.ts`), **not** `api.tasks.links.*`; its normalizer is the flat file `tasks/lib/externalLinks.ts`, **not** a `tasks/lib/links/` folder.

Rule of thumb: **folders under `<domain>/lib/` map to entities; flat files are helpers and value-objects.** Adapters follow suit — an embedded field is handled in the domain's core handler (e.g. `mcp/handlers/tasks/core.ts`), never a dedicated `links.ts` handler.

### `errors.ts` (domain root)

One `as const` catalog of every user-facing error message the domain throws, named in SCREAMING_SNAKE per message, with functions for parameterized messages:

```ts
export const errors = {
  ORG_NOT_FOUND: "Organization not found",
  INVITATION_EXPIRED: "This invitation has expired",
  invitationEmailMismatch: (email: string) =>
    `This invitation was sent to ${email}. Please sign in with that email address.`,
} as const;
```

Why: messages are part of the domain's observable contract (specs and tests assert on them). A catalog keeps them greppable, deduplicated, and impossible to drift between the throw site and the spec. It exports no functions, so it adds nothing to the generated API.

### `lib/` (domain-private)

Implementation helpers that only this domain may import:

- **Repo files** — see below.
- **`validators.ts`** — return-shape validators shared by multiple callable modules (`organizationValidator`, `invitationSummaryValidator`), each exporting its inferred type alongside (`export type Project = Infer<typeof projectValidator>` — see Type Sources). Single-use validators can stay inline in the callable module; a validator any *other* module needs must live in a pure validators file, not in a callable.
- Other helpers as the domain needs them — split by **role**, not into a grab-bag `utils.ts`. Settled role names, each with live examples: `naming.ts` (grammar, input validation — `tasks/lib/lists/`), `normalize.ts` (value → storage form — `agents/lib/`), `resolution.ts` (identifier → entity — `tasks/lib/lists/`, `mcp/lib/*/`), `invariants.ts` (business rules asserted before a write — `tasks/lib/lists/`, `tasks/lib/`), `permissions.ts` (access checks — `cli/lib/`), `hydrate.ts` (docs → enriched read shape — `tasks/lib/`, `tasks/lib/comments/`), `lifecycle.ts` (multi-step write orchestration — `tasks/lib/`, `cli/lib/chunks/`), `constants.ts`, `parsers.ts` / `formatters.ts` (`mcp/lib/`). Avoid `guards.ts` for these — in this codebase "guards" means type guards.

  Grep for a sibling holding the same *kind* of thing before coining a name. A coined noun (`authority.ts`, `enrichment.ts`, `statusPolicy.ts`, `store.ts`, `data.ts`) hides that two roles share one file, and the name is unguessable from the outside. Naming a file after a *foreign domain* (`cli/lib/tasks.ts` for a task permission check) does the same. This is AGENTS.md hard rule 9; it binds everything under `convex/`.

  **Outside `convex/`** the rule is advisory, and the same vocabulary applies where it fits — `apps/cli/src/commands/*/` uses `parsers.ts`, `formatters.ts`, `resolve.ts`, `hydrate.ts`, `constants.ts`. One exception is deliberate: `apps/web/lib/utils.ts` is the shadcn/ui convention, and `cn` stays where every generated component expects it.

**Helper placement — decide by consumer count, not reflex.** A `lib/` full of one-line single-use files is its own kind of god module. Before adding a `lib/` helper:

- **1 consumer → inline it** in that capability's callable module (module-local function). It travels with the code that uses it.
- **2+ consumers → `lib/`** (shared). This is the bar for promoting to a domain-private file.
- **Writes to the domain's table → always the repo** (`*Repo.ts`), regardless of consumer count — that is the lint-enforced write chokepoint.

(e.g. `getByRefs`'s `allRefsError` is inlined in `tasks/core.ts` — one consumer; `buildTaskSearchText` lives in `tasks/lib/searchText.ts` — used by `core.ts`, `core/search.ts`, and `updateMutation.ts`.)

Nothing in `lib/` may export `query`/`mutation`/`action`. If an action needs a function boundary (`ctx.runQuery`), expose an internal function from a callable module instead.

## Repo Files

One repo file per table the domain owns, named plural-entity + `Repo` — `organizationsRepo.ts`, `membersRepo.ts`, `invitationsRepo.ts` — never a bare `repo.ts` (imports stay self-describing when several repos coexist).

Callable modules must not touch `ctx.db` directly — every read and write goes through a repo function. A domain can start as just a repo before it has callable modules (`users/lib/usersRepo.ts` exists so other domains stop hand-rolling user lookups).

**What goes in a repo:**

- Index-backed reads: lookups by id/slug/token/email, list queries, existence checks (`getOrganizationBySlug`, `getUserByEmail`, `findPendingInvitation`, `hasOtherOwner`).
- Inserts that stamp system fields so callers pass only user-supplied props: `insertOrganization(ctx, { name, slug, color }, createdBy)` sets `createdBy`/`createdAt`/`updatedAt`/`isDeleted: false`; `insertMembership` stamps `joinedAt`; `insertInvitation` stamps `createdAt`/`status`.
- Updates that maintain invariants: `updateOrganization` stamps `updatedAt` and handles field clearing (`color: null` → removed via `undefined` patch); deletes that cascade (`removeMembershipWithProjectCleanup`).
- ID normalization (`normalizeOrganizationId`).
- Tiny throwing conveniences built on the above (`requireActiveOrganization`).

**What stays out of a repo:**

- Business rules and permission checks — those belong in the callable module (or `lib/access` for shared permission logic).
- Email/notification side effects.
- `.filter()` on queries — if a repo needs to filter by a field, add an index for that access pattern.

**Layering rule:** a domain repo may import root `convex/lib/` (e.g. `membersRepo.getMembership` delegates to `lib/accessRepo.getOrgMembership` so permission checks and the domain share one DB implementation). Root `convex/lib/` must never import a domain's `lib/` — the dependency arrow always points domain → shared.

Import the membership lookups from `lib/accessRepo` directly, not through
`lib/access/permissions` — that module owns permission *decisions*, not table
reads, and re-exporting the reads gives one function two import paths.

Shared root infrastructure that owns cross-domain access checks should put its
DB reads in a root repo file such as `convex/lib/accessRepo.ts` rather than
importing domain-private repos back into `convex/lib/`.

## Cross-Domain Imports

A domain may import:

- its own `lib/` (everything),
- root `convex/lib/` shared infrastructure,
- another domain's **`*Repo` files** — repos are each domain's cross-domain data-access surface (e.g. `organizations/invitations.ts` imports `getUserByEmail` from `users/lib/usersRepo.ts` instead of querying the users table itself),
- another domain's **callable** functions via generated `api`/`internal` references when a function boundary is required.

The same rule applies one level down: a module folder's `lib/` (`cli/threads/lib/`) is private to that module. Sibling modules in the same domain import only its `*Repo` files; anything two modules share belongs in the domain's `lib/`.

Everything else in another domain's `lib/` (validators, shape mappers, internal helpers) stays private at **runtime**. Type-only imports are allowed everywhere (`allowTypeImports`): a domain's types are part of its contract; only its logic is private. This is lint-enforced in `apps/web/eslint.config.mjs` (`no-restricted-imports` patterns on `convex/*/lib/**` with a `*Repo` exception) — if the linter blocks you, go through the owning domain's repo or callable functions, or promote the helper to root `convex/lib/` (only if genuinely domain-neutral).

## Adapters (`mcp/`, eventually `cli/`)

Adapters are thin protocol layers over the domains: parse input, call the generated `api`, format output. Their handlers run in **actions**, so they cannot touch `ctx.db` — all stateful access crosses the function boundary, which keeps transactions and permission checks in the callables.

Structure mirrors the domain tree, with sub-entities as folders and a fixed role-file vocabulary (`convex/mcp/` is the reference):

```txt
mcp/
  handler.ts / router.ts / tools.ts   # protocol entry points
  handlers/
    projects.ts
    tasks/{core,lists,artifacts,comments,types}.ts   # CRUD in core.ts
  lib/
    should.ts                         # adapter-wide input validation (throws InvalidParamsError)
    protocol/                         # JSON-RPC / envelope parsers + guards
    projects/resolution.ts
    tasks/{parsers,formatters,resolution,resources}.ts
    tasks/{lists,artifacts,comments,types}/...
```

Role names mean one thing each: `parsers` = tool args in, `formatters` = results out, `resolution` = identifier → entity via the api.

Rules of thumb:

- **Domain validation belongs to the domain.** Adapters don't pre-validate what a callable validates (the router maps `ConvexError` → JSON-RPC invalid params, so domain errors surface cleanly); they only validate adapter-level concerns (arg presence/shape via `should`).
- **No result re-validation.** `ctx.runQuery` results are typed and server-validated; hand-rolled row guards are dead code. A type guard is legitimate only where a validator is deliberately loose.
- Types come from domain validators via `import type` — see Type Sources.

## Type Sources

Where a shape's TypeScript type comes from depends on which side of the deployment bundle you are on:

- **Inside `convex/`** (callables, domain libs, adapters like `mcp/`): types come from **validators**. Every shared validator exports its inferred type next to it in the domain's `validators.ts`:

  ```ts
  export const taskListPublicValidator = v.object({ /* ... */ });
  export type TaskListPublic = Infer<typeof taskListPublicValidator>;
  ```

  Consumers `import type { TaskListPublic } from ".../validators"` (type-only, boundary-legal). **Never derive from the generated api here** — every convex module is part of the `api` type, so `FunctionReturnType<typeof api...>` inside the bundle is self-referential (TS2456) and degrades to a silent any-cascade; the lint bans importing `FunctionReturnType` under `convex/`. Since every function declares a `returns` validator, the validator type and the function's return type are the same thing — the validator is just the non-circular path to it.

- **Outside `convex/`** (CLI, web frontend, `convex-testing`): derive from the callable surface with `FunctionReturnType<typeof api...>` — no cycle exists there, and external consumers should be coupled to the api, not to domain internals.

Shared validators must live in **pure validator modules** (no `_generated/api` import; `_generated/dataModel` is fine) — a validator defined inside a callable module drags the module's `api`/`internal` imports into every type consumer.

Corollary for runtime checks: `ctx.runQuery` results are typed by the generated api **and** runtime-validated by the query's `returns` validator. Do not re-validate them with hand-rolled type guards — a guard is only legitimate where the validator is deliberately loose (e.g. `getByRefs` returns the task as an untyped record, so `isTaskRecordWithId` is genuine narrowing).

## Guard Validations With `ensure`

All user-facing guard validations use the fluent `ensure` helper from `convex/lib/shared/ensure.ts`. It wraps a value or promise, chains checks, throws `ConvexError(message)` on the first failure, and awaiting yields the narrowed value.

```ts
import { ensure } from "../lib/shared/ensure";
import { errors } from "./errors";

// Lookup guards: wrap the repo call, await the chain
const invitation = await ensure(getInvitationByToken(ctx, args.token))
  .notNull(errors.INVITATION_LINK_INVALID);

const org = await ensure(getOrganizationById(ctx, args.id))
  .active(errors.ORG_NOT_FOUND, errors.ORG_DELETED);

await ensure(getMembership(ctx, args.organizationId, existingUser._id))
  .isNull(errors.USER_ALREADY_MEMBER);

// Value guards on immediate values throw synchronously — no await needed
ensure(invitation.status).eq(InvitationStatus.PENDING, errors.INVITATION_REVOKE_REQUIRES_PENDING);
ensure(currentUser._id).notEq(args.userId, errors.CANNOT_REMOVE_SELF);
ensure(invitationIsExpired).isFalse(errors.INVITATION_EXPIRED);
ensure(trimmedSlug).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, errors.ORG_SLUG_INVALID);
ensure(trimmedSlug.length).between(2, 50, errors.ORG_SLUG_LENGTH);
```

### Pick the most specific check

Always use the narrowest check that expresses the rule — never encode a comparison into a boolean just to call `isTrue`:

| Rule | Use | Not |
|---|---|---|
| Value present | `.notNull(msg)` | `.satisfies((v) => v !== null, msg)` |
| Value absent (uniqueness/duplicate guards) | `.isNull(msg)` | `.isTrue` on `=== null` |
| Doc exists and not soft-deleted, one message | `.notDeleted(msg)` | manual `!doc \|\| doc.isDeleted` |
| Doc exists and not soft-deleted, distinct messages | `.active(notFoundMsg, deletedMsg)` | two manual ifs |
| Slug free or only held by deleted doc | `.isNullOrDeleted(msg)` | predicate gymnastics |
| Equality / inequality | `.eq(expected, msg)` / `.notEq(expected, msg)` | `ensure(a === b).isTrue(msg)` |
| Boolean condition that is already a boolean | `.isTrue(msg)` / `.isFalse(msg)` | `.eq(true, msg)` |
| Number bounds | `.gte(min, msg)` / `.between(min, max, msg)` | comparison + `isTrue` |
| String shape | `.regex(pattern, msg)` | predicate + `satisfies` |
| Anything else | `.satisfies(predicate, msg)` — last resort | open-coded `if`/`throw` |

### Semantics to know

- **Immediate values throw synchronously**; promise-backed chains reject on await. Always `await` a chain whose input is a promise, or the failure becomes an unhandled rejection.
- Checks narrow types through the chain: `.notNull` yields `NonNullable<T>`, `.eq(expected)` narrows to the literal, `.isTrue`/`.isFalse` only accept booleans.
- Messages come from the domain's `errors.ts` catalog, not inline strings.
- `ensure` is for **error guards only**. Queries that respond to missing access with empty results (`return null`, `return []`) keep their early returns — those are not errors.

## Batch Joins With `join`

When a list query enriches rows with related documents (memberships → organizations, members → users, …), use the fluent `join` helper from `convex/lib/shared/join.ts` instead of hand-rolling `Promise.all(items.map(async ...))` + null filtering.

```ts
import { join } from "../lib/shared/join";

// Inner join — rows whose related doc is missing are dropped
const organizations = await join(memberships)
  .on((m) => m.organizationId)
  .with((ids) => getActiveOrganizationsByIds(ctx, ids))
  .select((membership, org) => ({ ...org, role: membership.role }));

// Left join — keeps every row; `related` is null when missing
const invitationsWithInviter = await join(invitations)
  .on((inv) => inv.invitedBy)
  .with((ids) => getUsersByIds(ctx, ids))
  .selectAll((inv, inviter) => ({ ...inv, inviterName: inviter?.name ?? null }));
```

Semantics to know:

- `.on(key)` extracts the foreign key per row; `null`/`undefined` keys mean "no match".
- `.with(load)` receives the **deduped** keys (first-seen order) and must return an array **aligned by index**, with `null`/`undefined` for misses. Batch repo helpers like `getActiveOrganizationsByIds` / `getUsersByIds` follow this contract — add one per table as needed (typically `Promise.all(ids.map((id) => getXById(ctx, id)))`).
- `.select(project)` is an **inner join**: rows with a missing related doc are dropped and the projection receives a non-null doc. `.selectAll(project)` is a **left join**: every row is kept and `related` may be `null`. Projections may be async.
- Duplicate keys cost one load; the original row order is preserved.
- A loader result whose length does not match the keys throws a plain `Error` (system bug, not `ConvexError`).
- Pick `.select` when missing related docs should drop the row (the old "filter nulls" pattern) and `.selectAll` when the row survives with a `null` related doc. Every repo should expose the `get<Entities>ByIds` batch getter `join` needs.

## Building Update Patches With `buildPatch`

Update mutations with optional args use `buildPatch` from `convex/lib/shared/patch.ts` instead of per-field `if (args.x !== undefined) patch.x = args.x` blocks. Convex patch semantics are why a plain object literal isn't enough: an absent key means "don't change", while a key explicitly set to `undefined` removes the field — `buildPatch` drops `undefined` values, and the `clearable` marker turns `null` into an explicitly-present `undefined` key.

```ts
import { buildPatch, clearable, mapDefined } from "../lib/shared/patch";

const patch = buildPatch<ProjectUpdatePatch>({
  name: args.name,                                     // plain copy: undefined → key dropped
  color: clearable(args.color, validateProjectColor), // tri-state: null clears, value validates+sets
  disabledStatuses: mapDefined(args.disabledStatuses, (disabledStatuses) => {
    const invalid = getInvalidRequiredDisabledStatuses(disabledStatuses);
    ensure(invalid.length).eq(0, errors.requiredStatusesCannotBeDisabled(invalid));
    return getDisabledTaskStatuses({ disabledStatuses }); // transform/validate: mapper runs only when defined
  }),
});

await updateProject(ctx, args.id, patch); // repo stamps updatedAt
```

Semantics to know:

- **Always pass the patch type explicitly** (`buildPatch<ProjectUpdatePatch>`) — that's what makes typos excess-property errors. Export the patch type from the repo next to its update function.
- `mapDefined(value, map)` for transform/validate fields; the mapper only runs for defined values, and `ensure` guards live inside it.
- `clearable(value, map?)` for tri-state fields where `null` means "clear": `undefined` skips, `null` clears, a value is mapped (if a mapper is given) and set.
- Values are computed eagerly and mappers are sync. Fields needing async validation (e.g. the org slug uniqueness check) stay as explicit code and assign onto the built patch afterward.
- Fields whose repo contract passes `null` through (e.g. `OrganizationUpdatePatch.color`) don't need `clearable` — `buildPatch` only drops `undefined`, never `null`.

## Schema Changes: Widen, Migrate, Narrow

A change that existing documents might not fit ships in two commits. The
widened commit accepts both shapes and adds a migration to `runAll` in
`convex/migrations.ts`. The narrowing commit removes the old shape once the
migration has finished. Narrowing means a field or union value removed, a
field made required, or a type made stricter.

Before the narrowing commit lands on `main`, tag the `main` commit it lands on
as an upgrade stop, and push the tag. Without it, a self-hosted install that
skips both commits cannot deploy:

```bash
git tag -a upgrade-stop-YYYY-MM-DD <commit> -m "Upgrade stop before <what narrows>"
git push origin upgrade-stop-YYYY-MM-DD
```

Naming, pruning `runAll`, and how `self-hosted/upgrade.sh` uses the tags:
[Automatic migrations → Upgrade stops](../../specs/automatic-migrations.md#upgrade-stops).
Writing the migration itself: `apps/docs/content/docs/operations/migrations.mdx`.

## Checklist For A New Domain

1. Create `convex/<domain>/` with callable modules split by sub-entity/capability.
2. Add `errors.ts` with the domain's message catalog.
3. Add `lib/<entity>Repo.ts` per owned table, plus `lib/validators.ts` if return shapes are shared — each shared validator exporting its named `Infer` type.
4. Use `ensure` + `errors` for every guard validation; permission checks go through `lib/access/permissions.ts` helpers.
5. Use `join` + repo batch getters for row enrichment — no hand-rolled `Promise.all` + null-filter loops.
6. Use `buildPatch`/`clearable`/`mapDefined` for optional-field update mutations.
7. Colocate `*.test.ts` with the modules; cover failure modes and error messages, not just happy paths.
8. Index-backed queries only — add indexes instead of `.filter()`.
9. Update or create the domain spec under `docs/specs/` (error-message tables included).
