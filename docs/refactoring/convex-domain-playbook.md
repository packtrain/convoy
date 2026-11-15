# Convex Domain Refactor Playbook

The repeatable, step-by-step recipe for migrating one legacy root domain (e.g. `convex/projects.ts` + `convex/projectMembers.ts`) into the domain-folder convention. Target state and rules live in `docs/guidelines/convex/backend-development.md`; migration order and per-domain risk notes live in `docs/refactoring/convex-backend.md`. Completed reference runs: appVersion (`convex-app-version-pilot.md`) and organizations (`convex-organizations.md`).

Each step ends with a verifiable gate. Don't move to the next step while a gate fails.

---

## Step 0 — Scope and safety audit (no code changes)

1. Read the domain's spec(s) under `docs/specs/` — behavior and error messages must survive the refactor verbatim (any intentional change goes into the spec in the same PR).
2. **Scheduler audit**: `rg "scheduler\.run" apps/web/convex` for references into the domain. Classify each as long-lived (needs an old-path shim until drained, e.g. 30-day deletes) or short-lived (shim for one deploy cycle). TypeScript cannot catch stale persisted function paths.
3. **Call-site inventory**: `rg "api\.<oldModule>|internal\.<oldModule>" apps -g '*.ts' -g '*.tsx' -g '!**/_generated/**'` — count app, MCP, CLI, and test references. Check `apps/cli` separately; if it calls the domain, CLI tests join the validation gate.
4. Inventory `.filter()` and `.collect().find()` patterns in the domain — each one becomes a new index in Step 1.
5. Decide the target module split (which functions go to `core.ts` vs. sub-entity/capability modules) and the function renames (drop redundant suffixes under nesting). Write the old→new table into the domain's refactoring doc before coding.

**Gate**: a `docs/refactoring/convex-<domain>.md` plan with the rename table, scheduler classification, and index list.

## Step 1 — Create folder structure and repos

1. Create `convex/<domain>/lib/` with one `<entity>Repo.ts` per owned table:
   - index-backed reads (by id/slug/token, lists, existence checks),
   - inserts that stamp system fields (`createdBy`/`createdAt`/`updatedAt`/`isDeleted: false`, `joinedAt`, `status`) so callers pass only user-supplied props,
   - updates that stamp `updatedAt` and own field-clearing mechanics,
   - cascading deletes,
   - **batch getters** (`get<Entities>ByIds`) — Step 5's `join` adoption depends on them.
2. Add `lib/validators.ts` for return shapes shared by multiple callable modules.
3. Add `errors.ts` (domain root): every user-facing message as an `as const` catalog entry, lifted verbatim from the existing code/spec.
4. Add the indexes identified in Step 0 to `schema.ts` (additive); note which old indexes become unused so they can be dropped once nothing references them.
5. If the domain reads a foreign table directly today, use that domain's `*Repo` instead — creating it with just the needed functions if it doesn't exist yet (the `users/lib/usersRepo.ts` pattern).

**Gate**: repos compile; no repo exports `query`/`mutation`/`action`; `rg "\.filter\(\(q\)" convex/<domain>` is empty.

## Step 2 — Move callable modules, keep compatibility

1. Create the callable modules at the domain root per the Step 0 split; implement them on top of the repos.
2. Replace each legacy root module with a re-export shim mapping old names to new functions (`export { create as createOrganizationInvitation } from "./organizations/invitations";`), with a removal note. File-plus-folder coexistence and re-export double registration are verified to work.
3. Run `pnpm exec convex codegen` (from `apps/web`).

**Gate**: codegen passes; both old and new paths exist in `_generated/api.d.ts`.

## Step 3 — Replace guard checks with `ensure`

1. Convert every guard-style `if (...) throw new ConvexError(...)` to an `ensure(...)` chain, using the **most specific check** (`.eq`/`.notEq` over `isTrue(a === b)`; `.active`/`.notDeleted` for soft-delete guards; `.gte`/`.between`/`.regex` for ranges and shapes — full table in the guideline).
2. Messages come from `errors.ts`, never inline strings.
3. Do **not** convert empty-result early returns in queries (`return null` / `return []`) — those are access semantics, not errors.
4. Preserve side effects that precede a throw (e.g. marking an invitation expired before throwing "expired").

**Gate**: `rg "throw new ConvexError" convex/<domain>` returns only `errors.ts`-sourced throws inside repos/helpers that intentionally keep them; domain tests still pass with unchanged error messages.

## Step 4 — Review: repo-only data access

1. `rg "ctx\.db\." convex/<domain>/*.ts` (callable modules only) must return nothing — every read/write goes through a repo function (own domain's, or a foreign domain's `*Repo`).
2. Anything that doesn't fit an existing repo function becomes a new repo function — don't leave "just this one" inline.
3. Tests are exempt (`t.run` direct DB setup is fine).

**Gate**: zero `ctx.db.` hits in callable modules; ESLint boundary rule passes.

## Step 5 — Review: `join` adoption

1. Find enrichment loops: `Promise.all(items.map(async (x) => { const doc = await get...; if (!doc) return null; ... }))` followed by a null-filter, and per-row lookups inside `.map`.
2. Replace with the fluent join from `convex/lib/shared/join.ts`:
   - `.select(...)` for inner joins (drop rows with missing related docs — the common "filter nulls" pattern),
   - `.selectAll(...)` for left joins (keep rows, `related` is `null` — the "inviter may be deleted" pattern).
3. The `.with()` loader is the repo batch getter from Step 1 (`(ids) => getUsersByIds(ctx, ids)`); add it if missing. `join` dedupes keys and calls the loader once.

**Gate**: no hand-rolled `Promise.all` + null-filter enrichment remains in the domain's callable modules.

## Step 6 — Update call sites and tests

1. Bulk-rename API references in app/MCP/frontend code (old→new table from Step 0). Re-grep for leftovers — **do not rely on tests**: Convex API proxy references compare deep-equal regardless of path, so stale `toHaveBeenCalledWith(api.old...)` assertions pass vacuously.
2. Move test files with their modules (`git mv` to preserve history), update API refs, fix relative imports and `vi.mock` paths (mock specifiers resolve from the test file's new location).
3. Fix component tests that hand-mock `@/convex/_generated/api` — their mock object shape must match the new nesting.
4. Add a `convex/<domain>/shims.test.ts` exercising one legacy path per shim module; mark it for deletion with the shims.

**Gate**: leftover-reference grep is empty outside shims and the shim test; full `pnpm web:test:once` passes.

## Step 7 — Documentation

1. Update the domain spec(s): API reference table (new paths/names), error-message tables, plus a transitional note about the shims.
2. Update `docs/specs/mcp-server.md` if the domain is MCP-reachable, and AGENTS/CLAUDE examples that name old paths.
3. Mark the domain done in `docs/refactoring/convex-backend.md` and record any new learnings; write an Outcome section in the domain's refactoring doc, including the shim-removal follow-up.
4. If a convention evolved during the migration, update `docs/guidelines/convex/backend-development.md` in the same PR.

## Step 8 — Validation gates (all must pass)

```bash
cd apps/web
pnpm exec convex codegen
pnpm exec vitest run convex/<domain>            # targeted
pnpm web:test:once                              # full suite (from repo root)
pnpm web:lint
npx tsc --noEmit
pnpm --filter @useconvoy/cli typecheck
rg "\.filter\(\(q\)" apps/web/convex/<domain>   # index-backed only
rg "ctx\.db\." apps/web/convex/<domain>/*.ts    # repo-only access in callable modules
rg "api\.<oldModule>|internal\.<oldModule>" apps -g '!**/_generated/**'   # only shims + shim test
```

## Step 9 — Post-deploy follow-up (separate change, one deploy cycle later)

1. Delete the root shim modules, `shims.test.ts`, and the transitional spec notes. The `AppVersionWatcher` refresh banner has moved stale browser bundles off the old paths by then; internal-only shims can go as soon as the deploy is live.
2. For long-lived scheduled references: only delete the old path after pending jobs have drained or been rescheduled.
3. Drop any schema indexes that became unused in Step 1 (re-verify with a grep first).

---

## Definition of done

- [ ] Callable modules at the domain root, helpers in `lib/`, one `<entity>Repo.ts` per owned table, `errors.ts` catalog
- [ ] No `ctx.db` access in callable modules; no `.filter()` anywhere in the domain
- [ ] All guard validations via `ensure` with catalog messages; behavior and messages match the spec
- [ ] Enrichment loops use `join` with repo batch getters
- [ ] Legacy paths shimmed (with shim test) and scheduled-function compatibility handled
- [ ] Call sites, tests, specs, and trackers updated; all Step 8 gates green
- [ ] Shim-removal follow-up recorded
