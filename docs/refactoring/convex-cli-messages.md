# CLI `messages` Callable Convex Refactor Plan

Moves the fourth callable CLI module out of the Convex root into the `cli`
domain folder per `docs/guidelines/convex/backend-development.md`. This is step 4
of item #13 in `docs/refactoring/convex-backend.md` (Callable CLI Domain), done
one module per commit with the hub (`cliThreads`) last. Mirrors the prior
callable-CLI steps (`convex-cli-message-chunks.md`, `convex-cli-sessions.md`,
`convex-cli-profiles.md`).

## Summary

- `convex/cliMessages.ts` → `convex/cli/messages.ts`. The fourteen callables
  (`send`, `generateMessageAttachmentUploadUrl`,
  `registerPendingUploadedAttachment`, `deletePendingUploadedAttachment`,
  `listByThread`, `listEnvelopesByThread`, `backfillLegacyContentForThread`,
  `getLatestContinuationForThread`, `listUnprocessedUserMessages`,
  `startRunResponse`, `appendRunContent`, `complete`, `fail`, `retry`) keep
  identical behavior; their paths change from `api.cliMessages.*` to
  `api.cli.messages.*`.
- The `cliMessages` **table** name is unchanged — only the callable module path
  moved.
- `convex/cliMessages.ts` was retained for one deploy cycle as a re-export shim
  for legacy public paths, then removed on 2026-07-19.
- **No scheduler shim needed.** `cliMessages` schedules
  `internal.cliThreads.streamingWatchdogTick` (the hub, which migrates LAST), and
  self-schedules nothing — so the only inbound scheduled path stays valid without
  any internal-path shim of its own (confirmed at Step-0 with
  `rg "scheduler.run" convex/cliMessages.ts`).
- Test moved with `git mv` to `convex/cli/messages.test.ts`; appended a
  `cliMessages` block to `convex/cli/shims.test.ts` exercising one legacy `api`
  path (`send` + `listEnvelopesByThread`).

This is a **full domain refactor**, not just a relocation: the module also got
repo extraction (a primary repo plus two secondary-table repos and a foreign
threads-repo seam), error-catalog lifts, and `ensure` guards.

## Repos (one per owned table + a foreign seam)

`cliMessages` owns **three** tables; each got its own flat repo so the callable
has **zero `ctx.db.` access** (playbook Step 4):

- **`convex/cli/lib/cliMessagesRepo.ts` (primary).** All `cliMessages` table
  access. Reads: `getMessageById`, `getMessagesByIds` (index-aligned batch
  getter), `paginateThreadMessagesDesc`, `listThreadMessagesDesc`,
  `listThreadMessagesAsc`, `listMessagesByThread`, `listUnprocessedUserMessages`,
  `hasUnprocessedUserMessages` (indexed `.first()` per Chat invariant #4),
  `getLatestAssistantMessage`. Intent-named writes: `insertCliMessage`,
  `insertAssistantStreamingMessage` (stamps the streaming status / empty content
  / `nextChunkOrder: 0` / timestamps), `updateCliMessage(ctx, id, patch, now)`
  (stamps `updatedAt`; patch applied via `ctx.db.patch` so explicit `undefined`
  clears a field — the requeue/retry paths rely on this), `setMessageChunkOrder`
  (advances the chunk cursor without bumping `updatedAt`, matching the send
  path), `deleteCliMessage`.
- **`convex/cli/lib/cliMessagePendingUploadsRepo.ts` (secondary owned table).**
  `cliMessagePendingUploads` tracks user-uploaded storage blobs before they are
  referenced by a sent message:
  `listPendingUploadsByStorageId`, `insertPendingUpload`, `touchPendingUpload`,
  `deletePendingUpload`.
- **`convex/cli/lib/cliMessageAttachmentRefsRepo.ts` (secondary owned table).**
  `cliMessageAttachmentRefs` records which blobs are attached to a sent message:
  `getAttachmentRefByStorageId`, `insertAttachmentRef`. The shared helper
  `cli/lib/messages/attachments.ts` (also used by `cliThreads`) was repointed
  through these two repos for its inline pending-upload and attachment-ref DB
  access.
- **`convex/cli/lib/cliThreadsRepo.ts` (foreign-table seam, NEW).** `cliMessages`
  drives `cliThreads` state per the Chat Processing lifecycle invariants. Because
  `cliThreads` migrates LAST and has no repo yet, this step created a minimal
  foreign repo (the `users/lib/usersRepo.ts` pattern) holding only the reads/
  writes `cliMessages` needs, with **intent-named writes** (no generic
  `patchThread`): `getThreadById`, `markThreadPending` (the `send` path),
  `markThreadStreaming` (`startRunResponse`), `markThreadStreamEnded`
  (`complete`/`fail` — clears `activeAssistantMessageId` + `streamWatchdogId` so
  no stale streaming target survives, invariant #3), `requeueThreadForRetry`
  (`retry` — clears the active pointer only when it still points at the retried
  message). When `cliThreads` migrates last, fold these into its own
  `cliThreadsRepo.ts`.

## errors catalog

Lifted the inline `ConvexError` message strings the callable threw into
`convex/cli/errors.ts` (tests assert on several): `NOT_AUTHENTICATED`,
`NOT_AUTHORIZED`, `THREAD_NOT_FOUND`, `MESSAGE_NOT_FOUND`,
`CHAT_NOT_CLAIMED_BY_SESSION`, `MESSAGE_CONTENT_REQUIRED`,
`RUN_REQUIRES_USER_MESSAGE`, `SESSION_PROFILE_MISMATCH`,
`USER_MESSAGES_NOT_PENDING`, `USER_MESSAGE_MISSING_CHUNK_ORDER`,
`LEGACY_USER_CONTENT_UNSUPPORTED`, `CANNOT_RETRY_COMPLETED`. The shared helpers
`cli/lib/messages/ownership.ts` and `chunks/store.ts` (both also used by
`cliThreads`/`cli/messageChunks`) kept their own inline strings — they are not
this module's to refactor in this step.

## ensure guards

Guard-style throws became `ensure` chains with catalog messages, using the
most-specific check: `ensure(...).notDeleted(THREAD_NOT_FOUND)` for the repeated
thread lookups, `ensure(chat.profileId).eq(session.profileId, ...)`,
`ensure(args.userMessageIds.length).gte(1, ...)`,
`ensure(message.status).notEq("completed", CANNOT_RETRY_COMPLETED)`,
`ensure(message.nextChunkOrder).notNull(...)` (immediate value — `await`ed to
capture the narrowed `number`), `ensure(message.content.length).eq(0, ...)`, and
`assertChatClaimedBySession` became
`ensure(claimedBySession && !expired).isTrue(CHAT_NOT_CLAIMED_BY_SESSION)`.
`getOptionalAuthenticatedAccess`-returning-null stays a `throw new
ConvexError(errors.NOT_AUTHENTICATED)` (the value is already an explicit `null`
auth-failure short-circuit, not a guardable lookup). The empty-result early
returns in read queries (`return EMPTY_PAGE` / `return []` / `return null` on
missing thread or no `CLI_THREAD` access) stayed as **access semantics**, not
`ensure` throws (playbook Step 3.3).

## join enrichment

No `join` adoption. Despite §9.7's expectation of a two-`join` (author/session/
thread) shape, the read queries do **not** enrich message rows with foreign
docs — they emit `profileId`/`claimedBySessionId`/`threadId` as raw IDs. The only
enrichment is the optional `task` summary, resolved through the pre-existing
shared `resolveCliTaskSummaries` helper (used by `cliThreads` too), which already
batches + de-dupes task/project fetches and returns a `Map`-like lookup applied
per row (`taskSummaries.get(message.taskId)`). This is a precomputed best-of
lookup, not a per-row foreign-doc join, so `join` does not apply — same call as
the `cliProfiles` freshest-session Map (`convex-cli-profiles.md`).

## Secondary owned tables

Yes — `cliMessages` owns two secondary tables besides the primary
`cliMessages`: `cliMessagePendingUploads` and `cliMessageAttachmentRefs`. Each
got its own flat repo (above), mirroring the `taskComments` /
`taskCommentAttachments` precedent (handoff §5). The shared
`cli/lib/messages/attachments.ts` helper that writes them was routed through the
new repos rather than left with inline `ctx.db`.

## Shared helpers left in place

`cli/lib/messages/{ownership,attachments,data}.ts`, `cli/lib/tasks.ts`, and
`cli/lib/chunks/store.ts` are imported by **both** `cliMessages` and the
not-yet-migrated `cliThreads` (and `cli/messageChunks`), so they stay as shared
`cli/lib` helpers — not folded into the messages repos and not deleted. Their
import specifiers in the moved callable shortened from `./cli/lib/...` (1 level)
to `./lib/...` (2 levels).

## Import-specifier rewrites

The module moved from `convex/` (1 level) to `convex/cli/` (2 levels):

- `./_generated/*` → `../_generated/*`
- `./lib/access/{auth,permissions}` → `../lib/access/{auth,permissions}`
- `./lib/contracts/validators` → `../lib/contracts/validators`
- `./lib/shared/pagination` → `../lib/shared/pagination`
- `./cli/lib/...` → `./lib/...` (now the domain's own `lib/`)
- `../lib/authz/permissions` (apps/web `lib/`, outside `convex/`) →
  `../../lib/authz/permissions`
- `@/convex/cli/lib/runtimes/registry` → `./lib/runtimes/registry`
- new: `../lib/shared/ensure`, `./errors`, the four repos above

Test file: `./_generated/*` → `../_generated/*`; `../convex-testing` →
`../../convex-testing`; `api.cliMessages.*` → `api.cli.messages.*`.

## Call sites repointed

- `apps/web/lib/threads/hooks/use-thread-message-attachment-upload.ts` —
  `generateMessageAttachmentUploadUrl`, `deletePendingUploadedAttachment`,
  `registerPendingUploadedAttachment`
- `apps/web/lib/threads/hooks/use-cli-messages.ts` — `send`, `retry`,
  `backfillLegacyContentForThread`, `listEnvelopesByThread`
- `apps/web/components/blocks/thread/thread-list-item.tsx` —
  `getLatestContinuationForThread`
- `apps/cli/src/agent/app/thread-processor.ts` — **a real api consumer** (unlike
  the prior three modules, which only referenced `Id<"cli...">` table types):
  `listUnprocessedUserMessages`, `getLatestContinuationForThread`,
  `startRunResponse`, `appendRunContent`, `complete`, `fail`. The dual
  typecheck gate (`pnpm --filter @useconvoy/cli typecheck`) therefore mattered
  here and passed.
- Tests: `convex/cli/messages.test.ts` (moved), `convex/cliThreads.test.ts`,
  `convex/cli/sessions.test.ts`, `apps/web/lib/threads/hooks/use-cli-messages.test.tsx`
  (real `getFunctionName(api.cli.messages.*)` refs), and the
  string-literal function-name mocks in
  `use-thread-message-attachment-upload.test.tsx`
  (`"cliMessages:..."` → `"cli/messages:..."`, slash not dot — handoff §6.5).
  No hand-built `vi.mock("@/convex/_generated/api")` nesting referenced
  `cliMessages` (§9.7 trap absent here).

## ESLint carve-out

Removed the `convex/cliMessages.ts` / `convex/cliMessages.test.ts` entries from
the transitional carve-out block in `apps/web/eslint.config.mjs`. The remaining
`cliThreads` root callable keeps its carve-out entries until it migrates; delete
the whole block (plus the two cross-domain consumer entries `registerBody.ts`,
`contracts/validators.ts`) when `cliThreads` lands.

## Validation (implemented 2026-06-19)

- `npx convex codegen` — succeeds; `api.d.ts` carries both `cli/messages` and
  legacy `cliMessages` paths.
- `cd apps/web && npx tsc --noEmit` — clean.
- `pnpm --filter @useconvoy/cli typecheck` — clean (CLI consumes generated api).
- `pnpm web:lint` — 0 errors (pre-existing warnings only; one in the moved test
  pre-existed).
- `pnpm web:test:once` — 222 files / 2527 tests pass (+1 vs the cliProfiles
  baseline for the new `cliMessages` shim assertion).
- Grep gates: `rg "ctx\.db\." convex/cli/messages.ts` empty;
  `rg "\.filter\(\(q\)" convex/cli/` empty; no `"cliMessages:"` function-name
  mocks; `api.cliMessages` / `internal.cliMessages` only in the shim +
  `convex/cli/shims.test.ts`.

## Shim removal (completed 2026-07-19)

Deleted `convex/cliMessages.ts` and removed the legacy-path shim tests after the
compatibility window elapsed. The subsequent `cliThreads` migration had already
repointed scheduler references to `internal.cli.threads.*`.

## Notes for the cliThreads (hub) step

- **`cli/lib/cliThreadsRepo.ts` already exists** (created here as a foreign
  seam). When migrating the hub, consolidate its five functions into the canonical
  `cliThreadsRepo.ts` rather than duplicating them, and extend it for the hub's
  own table access. Both `cli/messages.ts` and `cliThreads.ts` will then share it.
- **The hub's `internal.cliThreads.{streamingWatchdogTick,
  reconcileClaimsForSessionDisconnect}` paths are scheduled from multiple modules**
  (`cli/messages.ts` schedules `streamingWatchdogTick`; `cli/profiles.ts` /
  `cli/sessions.ts` schedule `reconcileClaimsForSessionDisconnect` via
  `cli/lib/disconnectSession.ts`). Keep BOTH legacy internal paths shimmed for one
  deploy cycle (handoff §9 / §4) so in-flight scheduled jobs drain, and repoint all
  three caller modules to `internal.cli.threads.*` in the same change.
- The shared `cli/lib/messages/*`, `cli/lib/tasks.ts`, `cli/lib/chunks/store.ts`
  helpers are imported by the hub too; they stay shared `cli/lib` helpers.
