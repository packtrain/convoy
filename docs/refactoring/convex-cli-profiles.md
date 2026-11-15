# CLI `profiles` Callable Convex Refactor Plan

Moves the third callable CLI module out of the Convex root into the `cli` domain
folder per `docs/guidelines/convex/backend-development.md`. This is step 3 of
item #13 in `docs/refactoring/convex-backend.md` (Callable CLI Domain), done one
module per commit with the hub (`cliThreads`) last. Mirrors the prior
callable-CLI steps (`convex-cli-message-chunks.md`, `convex-cli-sessions.md`).

## Summary

- `convex/cliProfiles.ts` → `convex/cli/profiles.ts`. The seven callables
  (`findOrCreate`, `syncPaths`, `cleanupDeletedProfileSessions` internal
  mutations; `get`, `listByProject` queries; `rename`, `remove` mutations) keep
  identical behavior; their paths change from `api.cliProfiles.*` /
  `internal.cliProfiles.*` to `api.cli.profiles.*` / `internal.cli.profiles.*`.
- The `cliProfiles` **table** name is unchanged — only the callable module path
  moved.
- `convex/cliProfiles.ts` was retained for one deploy cycle as a re-export shim
  for legacy public paths and the scheduled cleanup path, then removed on
  2026-07-19 after the delay-0 jobs drained.
- Test moved with `git mv` to `convex/cli/profiles.test.ts` (29 tests); appended
  a `cliProfiles` block to `convex/cli/shims.test.ts` exercising one legacy
  `api` path AND the legacy `internal` scheduler path.

This is a **full domain refactor**, not just a relocation: the module also got
repo extraction (the first `cliProfilesRepo.ts`), an `errors` catalog, `ensure`
guards, de-duplicated session disconnect, and consolidation of the transitional
profile helpers the `cliSessions` step parked in `cli/lib/profiles/registry.ts`.

## Full-domain refactor (repo, errors, ensure, de-dup)

- **Repo extraction — `convex/cli/lib/cliProfilesRepo.ts` (the first CLI profile
  repo).** All `cliProfiles` table access moved here. Reads:
  `getCliProfileById`, `getActiveCliProfilesByIds` (returns `null` for missing OR
  soft-deleted — the inner-`join` loader contract), `listActiveProfilesByProject`,
  `getActiveProfileByIdentity`. Intent-named writes: `insertCliProfile` (stamps
  `createdAt`/`lastConnectedAt`/`isDeleted: false`), `touchProfileOnReconnect`
  (stamps `lastConnectedAt`), `setProfileName`, `setProfilePaths`,
  `softDeleteCliProfile` (stamps `deletedAt`/`deletedBy`). Path-shaping helpers:
  `buildInitialProfilePaths`, `mergeProfilePaths` (pure), `newProfilePathEntry`
  (private), `syncExistingProfilePaths`, and `findOrCreateProfile` (now routed
  entirely through the repo's own reads/writes — no inline `ctx.db`). The
  callable module now has **zero `ctx.db.` access** (playbook Step 4).
- **Absorbed `cli/lib/profiles/registry.ts`.** Because `cliProfiles` had no repo
  when `cliSessions` migrated, that step parked profile reads/writes in
  `registry.ts`. This step consolidated all of them into `cliProfilesRepo.ts`
  and **deleted** `cli/lib/profiles/registry.ts` (and its now-empty `profiles/`
  folder). The one external importer — `convex/cli/sessions.ts`, which imported
  `buildInitialProfilePaths`, `findOrCreateProfile`, `getActiveCliProfilesByIds`,
  `getCliProfileById`, `syncExistingProfilePaths` — was repointed to
  `./lib/cliProfilesRepo`.
- **errors catalog:** added `PROFILE_NOT_FOUND` (`"Profile not found"`),
  `PROFILE_NOT_AUTHORIZED` (`"Not authorized"`), and
  `PROFILE_RENAME_NO_FALLBACK` (`"Hostname and profile key unavailable. Enter a
  name."`) to `convex/cli/errors.ts`, lifted verbatim from the inline strings
  (tests assert on them).
- **ensure guards:** `requireOwnedActiveProfile` became
  `ensure(getCliProfileById(...)).notDeleted(PROFILE_NOT_FOUND)` +
  `ensure(profile.userId).eq(userId, PROFILE_NOT_AUTHORIZED)`. `syncPaths`'
  profile lookup became `ensure(...).notDeleted(PROFILE_NOT_FOUND)` (the legacy
  `syncPaths` threw a plain `Error("Profile not found")`; it now throws a
  `ConvexError` with the same message — a strictly cleaner user-facing error,
  and no test asserted on its error type). `rename`'s fallback-name guard became
  `ensure(fallbackName).notNull(PROFILE_RENAME_NO_FALLBACK)`.
- **De-duplication:** `remove` and `cleanupDeletedProfileSessions` shared an
  identical "reconcile thread claims + delete session" loop. Extracted to a
  private `disconnectSessions(ctx, sessions)` (the reconcile call stays on the
  legacy `internal.cliThreads.reconcileClaimsForSessionDisconnect` path until the
  hub migrates last).
- **No structured-throw conversion needed:** unlike `cliSessions.register`, no
  `cliProfiles` throw carries a `.data` payload the frontend reads, so all three
  throws became `ensure` chains.
- **No `join` adoption:** `listByProject`/`get` enrich profiles with their
  freshest online session via an index-backed lookup + a "first-per-profile
  wins" Map (the sessions query orders `desc` by `lastHeartbeatAt`). This is a
  single-key best-of lookup, not a per-row foreign-doc join, so `join` does not
  apply; the Map-building stays.

## Foreign-table access through `cliSessionsRepo`

`cliProfiles` reads and deletes the foreign `cliSessions` table for online
status and cleanup. All of it now goes through `convex/cli/lib/cliSessionsRepo.ts`
(same `cli` domain). Three getters were added there:

- `getLatestActiveSessionForProfile` — the freshest active session for a profile
  (used by `get`; replaces an inline `by_profile_lastHeartbeat` desc `.first()`).
- `listRecentSessionsByProject` — project sessions at/after a cutoff, ordered
  `desc` (used by `listByProject`; `listVisibleSessionsByProject` already existed
  but did not order, and the "first wins" Map needs `desc`).
- `paginateSessionsByProfile` — a page of sessions by `by_profile` for the
  batched cleanup (used by `cleanupDeletedProfileSessions`).

`listActiveSessionsByProfile` (pre-existing) is reused by `remove` to collect
the live sessions to disconnect. Deletes go through `deleteSession`.

## Scheduler shim (the first cli module to need one)

`cleanupDeletedProfileSessions` self-schedules
`ctx.scheduler.runAfter(0, internal.cliProfiles.cleanupDeletedProfileSessions,
...)`, and `remove` schedules the same. Both call sites were repointed to
`internal.cli.profiles.cleanupDeletedProfileSessions`. The legacy
`internal.cliProfiles.cleanupDeletedProfileSessions` path is kept resolvable by
the re-export shim so any delay-0 job queued against the old path before deploy
still drains (§4 treatment). `rg "scheduler.run" apps/web/convex` confirmed these
two were the only inbound scheduler references into the module.

## Import-specifier rewrites

The module moved from `convex/` (1 level) to `convex/cli/` (2 levels):

- `./_generated/*` → `../_generated/*`
- `./lib/access/{auth,permissions}` → `../lib/access/{auth,permissions}`
- `./lib/contracts/validators` → `../lib/contracts/validators`
- `./cli/lib/constants` → `./lib/constants` (now the domain's own `lib/`)
- `../lib/authz/permissions` (apps/web `lib/`, outside `convex/`) →
  `../../lib/authz/permissions`
- dropped the direct `./cli/lib/paths` (`getBasename`) import — the path-shaping
  logic lives in `cliProfilesRepo.ts`, which imports `getBasename`
- new: `../lib/shared/ensure`, `./errors`, `./lib/cliProfilesRepo`,
  `./lib/cliSessionsRepo`

Test file: `./_generated/api` → `../_generated/api`; `../convex-testing` →
`../../convex-testing`; `api.cliProfiles.*` / `internal.cliProfiles.*` →
`api.cli.profiles.*` / `internal.cli.profiles.*`.

## Call sites repointed

- `apps/web/lib/threads/hooks/use-cli-profiles.ts` — `api.cliProfiles.listByProject`
- `apps/web/app/o/[organizationSlug]/[projectAlias]/threads/[threadId]/thread-detail-page-client.tsx`
  — `api.cliProfiles.get`
- `apps/web/components/blocks/thread/working-directory-selector.tsx` —
  `api.cliProfiles.{rename,remove}`
- `apps/web/components/blocks/thread/working-directory-selector.test.tsx` — the
  `api.cli.profiles.rename` usage AND the **hand-rolled `vi.mock`
  `@/convex/_generated/api` shape**, which had to be re-nested from
  `{ cliProfiles: { rename, remove } }` to `{ cli: { profiles: { rename, remove } } }`.
  This mock-shape mismatch was the only thing that broke the full suite after
  every other gate was green (the `api.*` grep does not catch it — playbook
  Step 6.3 / handoff §6 territory).
- `apps/web/convex/cli/sessions.ts` — five named helper imports moved from
  `./lib/profiles/registry` to `./lib/cliProfilesRepo`.

No `apps/cli` references the api fns (only `Id<"cliProfiles">` table types,
unchanged); the dual typecheck gate found nothing, as for the prior two modules.

## ESLint carve-out

Removed the `convex/cliProfiles.ts` / `convex/cliProfiles.test.ts` entries from
the transitional carve-out block in `apps/web/eslint.config.mjs`. The relocated
module lives inside the `cli` domain (its `./lib/*` imports are in-domain and
allowed); the root shim only re-exports. The remaining `cliMessages` /
`cliThreads` root callables keep their carve-out entries until they migrate;
delete the whole block (plus the two cross-domain consumer entries
`registerBody.ts`, `contracts/validators.ts`) when `cliThreads` lands.

## Validation (implemented 2026-06-18)

- `npx convex codegen` — succeeds; `api.d.ts` carries both `cli/profiles` and
  legacy `cliProfiles` paths.
- `cd apps/web && npx tsc --noEmit` — clean.
- `pnpm --filter @useconvoy/cli typecheck` — clean (CLI consumes generated api).
- `pnpm web:lint` — 0 errors (pre-existing warnings only).
- `pnpm web:test:once` — 222 files / 2526 tests pass (+1 vs the cliSessions
  baseline for the new `cliProfiles` shim assertion).
- Grep gates: `rg "ctx\.db\." convex/cli/profiles.ts` empty;
  `rg "\.filter\(\(q\)" convex/cli/` empty; no `"cliProfiles:"` function-name
  mocks; `api.cliProfiles` / `internal.cliProfiles` only in the shim +
  `convex/cli/shims.test.ts` (fixture `.jsonl` transcript data excluded — not
  source).

## Shim removal (completed 2026-07-19)

Deleted `convex/cliProfiles.ts` and removed the legacy-path shim tests after the
compatibility window elapsed and delay-0 cleanup jobs had drained.
