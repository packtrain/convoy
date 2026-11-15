# CLI `sessions` Callable Convex Refactor Plan

Moves the second callable CLI module out of the Convex root into the `cli`
domain folder per `docs/guidelines/convex/backend-development.md`. This is step 2
of item #13 in `docs/refactoring/convex-backend.md` (Callable CLI Domain), done
one module per commit with the hub (`cliThreads`) last. Mirrors the first
callable-CLI step (`convex-cli-message-chunks.md`).

## Summary

- `convex/cliSessions.ts` → `convex/cli/sessions.ts`. The five callables
  (`register`, `heartbeat`, `disconnect` internal mutations; `listByProject`,
  `getById` queries) keep identical behavior; their paths change from
  `api.cliSessions.*` / `internal.cliSessions.*` to `api.cli.sessions.*` /
  `internal.cli.sessions.*`.
- The `cliSessions` **table** name is unchanged — only the callable module path
  moved.
- `convex/cliSessions.ts` was retained for one deploy cycle as a re-export shim
  for legacy public/internal paths, then removed on 2026-07-19.
- Test moved with `git mv` to `convex/cli/sessions.test.ts` (45 tests); appended
  a `cliSessions` block to `convex/cli/shims.test.ts` exercising one legacy
  `internal` + one legacy `api` path.

This is a **full domain refactor**, not just a relocation: the module also got
repo extraction, an `errors` catalog entry, a de-duplicated ownership guard,
`join`-based enrichment, and foreign-table writes routed through the profile
domain — matching the task-leaf treatment.

## Full-domain refactor (repo, errors, join, foreign writes)

- **Repo extraction:** all `cliSessions` table access moved to
  `convex/cli/lib/cliSessionsRepo.ts` (the second CLI repo). It exports the
  reads `getSessionById`, `getSessionByInstanceId`, `listActiveSessionsByProfile`,
  `listVisibleSessionsByProject` and the intent-named writes `insertSession`
  (stamps `startedAt`/`lastHeartbeatAt`), `updateSessionOnReconnect` (refreshes
  identity fields, stamps `lastHeartbeatAt`), `touchSessionHeartbeat`, and
  `deleteSession`. The callable module now has **zero `ctx.db.` access**
  (playbook Step 4).
- **errors catalog:** added `SESSION_CONFLICT` to `convex/cli/errors.ts` and
  sourced the `register` conflict message from it. The throw stays a structured
  `ConvexError({ code, message, activeSessionCount })` (the frontend reads
  `activeSessionCount`), so it was **not** converted to `ensure` — only the
  message string was lifted.
- **De-duplication:** `heartbeat` and `disconnect` shared an identical
  session-ownership block (denormalized `userId` check + live, owned, non-deleted
  profile check). Extracted to a private `resolveOwnedSession(ctx, sessionId,
  userId)` returning the session or `null`. `getById` keeps its own inline checks
  (principal-based `hasProjectAccess`, a required `projectId`, and a different
  shaped return).
- **`join` adoption:** `listByProject` replaced the
  `Promise.all(ids.map(get))` + Map-building enrichment with two `join` chains —
  an inner join on `profileId` (drops sessions whose profile is missing or
  deleted) followed by a left join on `userId` (`userName` falls back to
  `"Unknown"`).
- **Foreign-table writes through the owning domain:** `register` previously
  patched `cliProfiles` inline to sync reported paths. That merge-and-patch moved
  to `syncExistingProfilePaths` in `cli/lib/profiles/registry.ts` (the profile
  domain's helper home, which already owns `findOrCreateProfile`). The callable
  no longer touches the `cliProfiles` table directly.
- **Profile-path shaping centralized:** both the create-time path build and the
  reconnect-time merge defaulted a missing label to the basename. That rule now
  lives once in `registry.ts` — `buildInitialProfilePaths` (used by `register`
  for `findOrCreateProfile`) and `syncExistingProfilePaths` share a private
  `newProfilePathEntry`. `register` no longer imports `getBasename`; its handler
  is pure orchestration.
- **Foreign reads through domain getters:** profile reads now go through
  `getCliProfileById` / `getActiveCliProfilesByIds` (added to
  `profiles/registry.ts`); session-user reads use `getUsersByIds` from
  `convex/users/lib/usersRepo.ts` (allowed cross-domain `*Repo` import).
- **Access-deny semantics preserved:** `heartbeat`/`disconnect` still return
  `false` and `getById`/`listByProject` still return `null`/`[]` on
  missing/unauthorized — these stay early returns, not `ensure` throws (playbook
  Step 3.3).

When `cliProfiles` migrates next, the transitional profile getters /
`syncExistingProfilePaths` in `registry.ts` can be consolidated into a
`cliProfilesRepo.ts`.

## Import-specifier rewrites

The module moved from `convex/` (1 level) to `convex/cli/` (2 levels):

- `./_generated/*` → `../_generated/*`
- `./lib/access/{auth,permissions}` → `../lib/access/{auth,permissions}`
- `./lib/contracts/validators` → `../lib/contracts/validators`
- `./cli/lib/{constants,profiles/registry}` → `./lib/{constants,profiles/registry}`
  (now the domain's own `lib/`, so no eslint boundary carve-out needed). The
  `cli/lib/paths` (`getBasename`) import moved into `registry.ts` with the
  path-shaping logic, so the callable no longer imports it.
- `../lib/authz/permissions` (apps/web `lib/`, outside `convex/`) →
  `../../lib/authz/permissions`
- new: `../lib/shared/join`, `../users/lib/usersRepo`, `./errors`,
  `./lib/cliSessionsRepo`

Test file: `./_generated/{api,dataModel}` → `../_generated/{api,dataModel}`;
`../convex-testing` → `../../convex-testing`; `api.cliSessions.*` /
`internal.cliSessions.*` → `api.cli.sessions.*` / `internal.cli.sessions.*`.

## Call sites repointed

- `apps/web/convex/http.ts` — 3 `internal.cliSessions.{register,heartbeat,
  disconnect}` → `internal.cli.sessions.*`
- `apps/web/components/blocks/project/agent-thread-launcher.tsx` — 1
  `api.cliSessions.listByProject` → `api.cli.sessions.listByProject`
- `apps/web/convex/apiKeys/core.test.ts` — 1 `internal.cliSessions.register`
  → `internal.cli.sessions.register`

No `scheduler.run*` references target this module (the only `cliSessions`
heartbeat-related scheduler call, `cliProfiles.cleanupDeletedProfileSessions`,
lives in `cliProfiles`). The module's own outbound
`internal.cliThreads.reconcileClaimsForSessionDisconnect` calls stay on the
legacy path until the hub (`cliThreads`) migrates last. No scheduler shim
required.

## ESLint carve-out

Removed the `convex/cliSessions.ts` / `convex/cliSessions.test.ts` entries from
the transitional carve-out block in `apps/web/eslint.config.mjs`. The relocated
module lives inside the `cli` domain (its `./lib/*` imports are in-domain and
allowed); the root shim only re-exports. The remaining `cliProfiles` /
`cliMessages` / `cliThreads` root callables keep their carve-out entries until
they migrate; delete the whole block (plus the two cross-domain consumer
entries) when `cliThreads` lands.

## Validation (implemented 2026-06-18)

- `npx convex codegen` — succeeds; `api.d.ts` carries both `cli/sessions` and
  legacy `cliSessions` paths.
- `cd apps/web && npx tsc --noEmit` — clean.
- `pnpm --filter @useconvoy/cli typecheck` — clean (CLI consumes generated api).
- `pnpm web:lint` — 0 errors (pre-existing warnings only).
- `pnpm web:test:once` — 222 files / 2525 tests pass.
- Grep gates: `rg "ctx\.db\." convex/cli/sessions.ts` empty;
  `rg "\.filter\(\(q\)" convex/cli/` empty; no `"cliSessions:"` function-name
  mocks; `api.cliSessions` / `internal.cliSessions` only in the shim +
  `convex/cli/shims.test.ts`.

## Shim removal (completed 2026-07-19)

Deleted `convex/cliSessions.ts` and removed the legacy-path shim tests after the
compatibility window elapsed.
