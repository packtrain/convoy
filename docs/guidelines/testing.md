# Testing

Tests use `convex-test` with Vitest. Full documentation:
`apps/web/convex-testing/README.md`.

**Convex backend changes always require new or updated unit tests.** Verify with
`pnpm web:test:once`.

Fixing anything — bug, regression, review finding — is test-first (hard rule 8).
Write the failing test, run it, and read the output to confirm it fails for the
intended reason before fixing. Sequence:
[../agents/specs-first-workflow.md](../agents/specs-first-workflow.md#tdd-for-bug-fixes).

## Test context API

```typescript
import { createTestContext } from "../convex-testing";

const ctx = createTestContext();

// Setup helpers (return { user, asUser, t, ... })
const { user, asUser, t } = await ctx.setupUser();
const { user, org, asUser, t } = await ctx.setupOrg();
const { user, org, project, asUser, t } = await ctx.setupProject();

// Entity builders (for additional entities)
const user2 = await ctx.user();
await ctx.orgMember(org._id, user2._id, "admin");
await ctx.projectMember(project._id, user2._id, "member");
const asUser2 = ctx.asUser(user2);
```

Setup levels nest: `setupUser()` → `setupOrg()` → `setupProject()`.

## Critical patterns

```typescript
// ✅ Authenticated queries/mutations — use asUser
const tasks = await asUser.query(api.tasks.core.listByProject, { projectId });

// ✅ Unauthenticated queries — use t.query (no identity)
const tasks = await t.query(api.tasks.core.listByProject, { projectId, apiKey });

// ✅ Direct DB access — use t.run()
await t.run(async (runCtx) => {
  await runCtx.db.patch(id, { expiresAt: Date.now() - 1000 });
  const doc = await runCtx.db.get(id);
});

// ❌ These do not exist
await ctx.query(...)      // no ctx.query
await ctx.db.patch(...)   // no ctx.db
```

## Never use `setTimeout` in tests

Real delays are flaky and slow. Use proper async synchronization: fake timers,
condition polling, or promise resolution.

```typescript
// ❌ BAD
await new Promise((resolve) => setTimeout(resolve, 10));

// ✅ Fake timers
vi.useFakeTimers();
await vi.advanceTimersByTimeAsync(100);
vi.useRealTimers();

// ✅ Wait for a condition
await vi.waitFor(() => expect(result).toBe(expected));
```

### CLI TUI drivers

The Ink drivers in `apps/cli/src/commands/tui/__tests__/` run as subprocesses
from `app.test.ts` and `onboarding/runtime-access.test.ts`. Before sending the
next key, await `inputBound()` or `settle(ms)` from `test-helpers.ts`. A bare
sleep loses keys on a busy machine, because Ink rebinds `useInput` in an effect
after it writes the frame. A fixture driven through a real PTY by a Python
script calls `gateInput()` instead, so each key waits for `inputBound()` inside
the child. The test files run one scenario per driver under
`apps/cli/src/__tests__/loaded-machine.mjs`, which delays React's Scheduler
ticks. Run a new driver under it once:
`NODE_OPTIONS="--import $PWD/src/__tests__/loaded-machine.mjs" LOADED_TICK_MS=100 node --import tsx <driver> <scenario>`.

## Coverage expectations

Test failure modes and edge cases, not only happy paths.
