# CLI `threads` Callable Convex Refactor Plan

> **Historical.** Describes the module as it stood when this refactor shipped.
> The archive surface it inventories (`archive`/`unarchive` callables,
> `archiveThread`/`unarchiveThread` repo helpers, and the active/archived index
> pairs) was retired in OS-1561 — Done replaces Archived. See
> `docs/specs/cli-thread-list.md` for current behavior.

Moves the **fifth and final** callable CLI module — the scheduler **hub** — out
of the Convex root into the `cli` domain folder per
`docs/guidelines/convex/backend-development.md`. This is step 5 (last) of item
#13 in `docs/refactoring/convex-backend.md` (Callable CLI Domain), done one
module per commit with the hub last. Mirrors the prior callable-CLI steps
(`convex-cli-message-chunks.md`, `convex-cli-sessions.md`,
`convex-cli-profiles.md`, `convex-cli-messages.md`).

## Summary

- `convex/cliThreads.ts` → `convex/cli/threads.ts`. The eighteen callables
  (`create`, `get`, `listByProject`, `listByAssociatedTask`,
  `listPendingThreads`, `claimThread`, `heartbeatClaim`, `releaseClaim`,
  `updateTitle`, `markRead`, `markUnread`, `cancelProcessing`,
  `isClaimActiveForSession`, the internal `reconcileClaimsForSessionDisconnect`,
  `streamingWatchdogTick`, `remove`, `archive`, `unarchive`) keep identical
  behavior; public paths change from `api.cliThreads.*` to `api.cli.threads.*`
  and internal paths from `internal.cliThreads.*` to `internal.cli.threads.*`.
- **Dropped dead code:** the old module's internal `updateStatus` mutation (and
  its two tests) was deleted — it had zero production callers (internal-only, so
  not browser-reachable, and nothing scheduled or `runMutation`-ed it; its
  "called by message handlers" doc was stale — the handlers use
  `markThreadStreaming`/`markThreadStreamEnded`/`resetThreadClaim`). Not carried
  into the shim.
- The `cliThreads` **table** name is unchanged — only the callable module path
  moved.
- `convex/cliThreads.ts` was retained for one deploy cycle as a re-export shim
  for legacy public and scheduled internal paths, then removed on 2026-07-19.
- Test moved with `git mv` to `convex/cli/threads.test.ts` (3069 lines, 116
  tests); appended a `cliThreads` block to `convex/cli/shims.test.ts` exercising
  one legacy public path (`create` + `get`) and one legacy internal scheduler
  path (`streamingWatchdogTick`).

This is a **full domain refactor**, not just a relocation: the module also got
repo consolidation, error-catalog lifts, and `ensure` guards.

## Dual scheduler shims (the hub specialty)

The hub owns two internal mutations that are scheduled via persisted
`ctx.scheduler.runAfter` references TypeScript cannot catch, **from three
modules**:

- `internal.cliThreads.streamingWatchdogTick` — self-re-armed by the watchdog,
  and scheduled by `cli/messages.ts` (`startRunResponse`).
- `internal.cliThreads.reconcileClaimsForSessionDisconnect` — scheduled by
  `cli/profiles.ts` and `cli/sessions.ts` via `cli/lib/disconnectSession.ts`.

Both call sites were repointed to `internal.cli.threads.*` in the same change,
and **both** legacy internal paths remained resolvable through the re-export
shim until in-flight delay-0 jobs drained. The shim was removed on 2026-07-19.

## Repos (one owned table — consolidated foreign seam)

`cliThreads` owns one table. The transitional `convex/cli/lib/cliThreadsRepo.ts`
created by the `cliMessages` step (a foreign seam holding the
claim/queue/streaming writes `cli/messages.ts` needs) was **consolidated** into
the canonical threads repo rather than duplicated — `cli/threads.ts` and
`cli/messages.ts` now share it, and both callables have **zero `ctx.db.`
access** (playbook Step 4). The five pre-existing seam helpers (`getThreadById`,
`markThreadPending`, `markThreadStreaming`, `markThreadStreamEnded`,
`requeueThreadForRetry`) kept their names (still imported by `cli/messages.ts`);
the hub's own table access was added as intent-named writes (no generic
`patchThread`):

- Reads: `normalizeThreadId`, `paginateProjectThreads` (encapsulates the
  active/archived × created/lastActivity index selection),
  `listThreadsByAssociatedTask`, `listPendingThreadsByProfile`,
  `listThreadsClaimedBySession`.
- Writes: `insertCliThread` (stamps the creation-constant lifecycle fields),
  `applyThreadClaim` (`claimThread`), `extendThreadClaimLease`
  (`heartbeatClaim` — no activity stamp, matching the original),
  `resetThreadClaim` (the shared claim/stream teardown the `releaseClaim`
  non-streaming path, `failStreamingChat`, `requeueClaimedNonStreamingChat`, and
  `cancelProcessing` all reduce to — clears the claim lease trio + active
  assistant + watchdog id, `idle` processing state, stamps `lastActivityAt`),
  `setThreadTitle`, `markThreadRead`/`markThreadUnread`, `setThreadStatus`
  (internal `updateStatus`), `setThreadWatchdog` (set/clear the watchdog job id),
  `softDeleteThread`, `archiveThread`/`unarchiveThread`.

Foreign-table access goes through the owning domains' repos (no inline
`ctx.db`): `cli/lib/cliProfilesRepo` (`getCliProfileById` — enrichment uses raw
get to preserve display of soft-deleted profiles, NOT the inner-join
`getActiveCliProfilesByIds`), `cli/lib/cliMessagesRepo`
(`getMessageById`/`updateCliMessage`/`insertCliMessage`/
`listUnprocessedUserMessages`/`hasUnprocessedUserMessages` — the local
duplicate `hasUnprocessedUserMessages`/`listUnprocessedUserMessages` helpers in
the old module were dropped in favor of the repo's), `cli/lib/cliSessionsRepo`
(`getSessionById` — watchdog online check), and `tasks/lib/tasksRepo`
(`getActiveTaskById` — the `listByAssociatedTask` task guard, which subsumes the
old `!task || task.isDeleted` check).

## errors catalog

Lifted the inline `ConvexError` message strings the callable threw into
`convex/cli/errors.ts`: `TITLE_REQUIRED`, `titleTooLong(max)` (a function — the
length message interpolates `THREAD_TITLE_MAX_LENGTH`), `THREAD_PROFILE_NOT_OWNED`
("Cannot create chat for another user's profile"), `PATH_NOT_FOUND_IN_PROFILE`,
`THREAD_CLAIM_PROFILE_MISMATCH` ("Session cannot claim threads for a different
profile" — distinct from `cliMessages`' `SESSION_PROFILE_MISMATCH` "...process
threads..."). Reused existing entries: `PROFILE_NOT_FOUND`,
`MESSAGE_CONTENT_REQUIRED`, `NOT_AUTHENTICATED`, `THREAD_NOT_FOUND`,
`NOT_AUTHORIZED`. Strings owned by shared helpers (`requireAccessibleCliTask`'s
"Task not found", `assertValidMessageAttachments`'s attachment-limit message,
`requireAuthorizedProject`'s "Permission denied") were left in place — not this
module's to refactor.

## ensure guards

Guard-style throws became `ensure` chains with catalog messages, most-specific
check: `ensure(getCliProfileById(...)).notDeleted(PROFILE_NOT_FOUND)`,
`ensure(profile.userId).eq(user._id, THREAD_PROFILE_NOT_OWNED)`,
`ensure(profile.paths.find(...)).notNull(PATH_NOT_FOUND_IN_PROFILE)` (awaited to
capture the narrowed value), `ensure(getThreadById(...)).notDeleted(
THREAD_NOT_FOUND)` for the claim/heartbeat/release lookups,
and `ensure(chat.profileId).eq(session.profileId, THREAD_CLAIM_PROFILE_MISMATCH)`.
The `getOptionalAuthenticatedAccess`-returning-null auth short-circuits stayed
`throw new ConvexError(errors.NOT_AUTHENTICATED)` (explicit null, not a guardable
lookup). The `remove`/`archive`/`unarchive` idempotent `return null` on missing
thread and all the read-query empty-result early returns (`return null` /
`return []` / `return EMPTY_PAGE` on missing thread or no `CLI_THREAD` access)
stayed as access/idempotency semantics, NOT `ensure` throws (playbook Step 3.3).

## join enrichment

No `join` adoption — consistent with all four prior cli modules. The thread
read queries do not enrich rows with foreign docs via a per-row join:
`enrichThreadItems` resolves profiles with a `Promise.all` of `getCliProfileById`
into a `Map` (preserving the original behavior of displaying soft-deleted
profiles by name rather than dropping them, so the inner-join
`getActiveCliProfilesByIds` is deliberately NOT used), and the optional task
summary uses the shared `resolveCliTaskSummaries` best-of Map lookup. Neither is
a hand-rolled `Promise.all` + null-filter enrichment, so `join` does not apply.

## Import-specifier rewrites

The module moved from `convex/` (1 level) to `convex/cli/` (2 levels):

- `./_generated/*` → `../_generated/*`
- `./lib/access/{auth,permissions}`, `./lib/shared/pagination`,
  `./lib/contracts/validators` → `../lib/...`
- `./cli/lib/...` → `./lib/...` (now the domain's own `lib/`)
- `../lib/authz/permissions`, `../lib/threads/constants` (apps/web `lib/`,
  outside `convex/`) → `../../lib/...`
- new: `../lib/shared/ensure`, `./errors`, the consolidated `./lib/cliThreadsRepo`
  + foreign repos `./lib/cliProfilesRepo`, `./lib/cliMessagesRepo`,
  `./lib/cliSessionsRepo`, `../tasks/lib/tasksRepo`.

Test file: `./_generated/*` → `../_generated/*`; `../convex-testing` →
`../../convex-testing`; `api.cliThreads.*` → `api.cli.threads.*`;
`internal.cliThreads.*` → `internal.cli.threads.*`.

## Call sites repointed

- Frontend hooks `apps/web/lib/threads/hooks/{use-cli-threads,use-cli-thread,
  use-cli-messages}.ts`; pages `app/.../threads/page.tsx` +
  `.../threads/[threadId]/thread-detail-page-client.tsx`; components
  `components/blocks/project/agent-thread-launcher.tsx` and the three
  `task-detail-sidebar/task-threads-{field,footer,tab}.tsx`.
- `apps/cli/src/agent/app/{runner,thread-processor}.ts` — a **real api
  consumer** (`listPendingThreads`, `claimThread`, `heartbeatClaim`,
  `releaseClaim`, `isClaimActiveForSession`, and the
  `FunctionReturnType<typeof api.cli.threads.listPendingThreads>` type). The dual
  typecheck gate (`pnpm --filter @useconvoy/cli typecheck`) therefore mattered and
  passed.
- Scheduler call sites: `cli/messages.ts` (`streamingWatchdogTick`) and
  `cli/lib/disconnectSession.ts` (`reconcileClaimsForSessionDisconnect`) →
  `internal.cli.threads.*`.
- Tests: `convex/cli/threads.test.ts` (moved), and the sibling already-migrated
  tests `convex/cli/messages.test.ts` + `convex/cli/sessions.test.ts` which call
  `api.cliThreads.claimThread` as a real api ref → `api.cli.threads.claimThread`.
  No function-name string-literal mocks (`"cliThreads:..."`) and no hand-built
  `vi.mock("@/convex/_generated/api")` nesting referenced `cliThreads` (the §6.5
  / §9.7 traps were both absent here — verified by grep).

## ESLint carve-out

Removed the `convex/cliThreads.ts` / `convex/cliThreads.test.ts` entries — the
moved callable lives inside `convex/cli/` and may import `cli/lib/*` freely. The
carve-out block now covers only the two cross-domain consumers (see Follow-up).

## Validation (implemented 2026-06-19)

- `npx convex codegen` — succeeds; `api.d.ts` carries both `cli/threads` and
  legacy `cliThreads` paths (public + internal).
- `cd apps/web && npx tsc --noEmit` — clean.
- `pnpm --filter @useconvoy/cli typecheck` — clean (CLI consumes generated api).
- `pnpm web:lint` — 0 errors (pre-existing warnings only).
- `pnpm web:test:once` — 222 files / 2528 tests pass (+1 vs the cliMessages
  baseline for the new `cliThreads` shim assertion).
- Grep gates: `rg "ctx\.db\." convex/cli/threads.ts` empty;
  `rg "\.filter\(\(q\)" convex/cli/` empty; `api.cliThreads`/`internal.cliThreads`
  only in the shim + `convex/cli/shims.test.ts`.

## Follow-up

- **Shim removal completed 2026-07-19:** deleted `convex/cliThreads.ts` and the
  legacy-path shim tests after in-flight watchdog/reconcile jobs had drained.
- **Final item-13 cleanup (separate change):** re-home the two cross-domain
  consumers `convex/lib/http/registerBody.ts` and
  `convex/lib/contracts/validators.ts` off `convex/cli/lib/runtimes/*` (promote
  the runtime contracts/validators to root `convex/lib/` or expose them via a cli
  public surface), then delete the last transitional eslint carve-out block in
  `apps/web/eslint.config.mjs`.
- **OS-1033 (separate change, not behavior-preserving):** `cliThreads.remove`
  (and `archive`) is a bare soft-delete/patch that does NO streaming/claim
  teardown — it leaks the `streamWatchdogId` scheduled job, the claim lease, and
  the in-flight assistant message when a thread is deleted mid-stream. Now that
  the consolidated `failStreamingChat`/`resetThreadClaim` teardown lives in the
  threads domain, `remove` should reuse it. Kept OUT of this migration so the move
  stays behavior-preserving.
