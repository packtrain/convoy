# Convex Testing Utilities

Test utilities for Convex functions using `convex-test` with Vitest. Tests run in the `edge-runtime` environment.

More info: https://docs.convex.dev/testing/convex-test

## Test File Location

Tests live alongside Convex functions:
- `convex/tasks.ts` → `convex/tasks.test.ts`

## Quick Start

```typescript
import { expect, test, describe } from "vitest";
import { api } from "./_generated/api";
import { createTestContext, gen } from "convex-testing";

describe("tasks", () => {
  test("should create a task", async () => {
    const ctx = createTestContext();
    const { project, user, asUser } = await ctx.setupProject();

    const { taskId } = await asUser.mutation(api.tasks.core.create, {
      projectId: project._id,
      clientId: gen.clientId(),
      name: "My task",
      priority: "Medium",
      status: "To Do",
      tags: [],
      rank: gen.rank(),
    });

    const tasks = await asUser.query(api.tasks.core.listByProject, {
      projectId: project._id,
    });
    expect(tasks).toHaveLength(1);
  });
});
```

## Setup Levels

| Method | Creates | Use Case |
|--------|---------|----------|
| `ctx.setupUser()` | User only | Testing org creation |
| `ctx.setupOrg()` | User + Org + Membership | Testing project creation |
| `ctx.setupProject()` | User + Org + Membership + Project | Most common (task tests) |

```typescript
// Testing project operations
const { user, org, asUser } = await ctx.setupOrg();
const project1 = await ctx.project(org._id, user._id, { alias: "P01" });
const project2 = await ctx.project(org._id, user._id, { alias: "P02" });

// Testing org operations
const { user, asUser } = await ctx.setupUser();
const org1 = await ctx.organization(user._id, { name: "Org 1" });
```

## Creating Test Fixtures

Use `ctx.task()` and `ctx.tasks()` to create fixture data directly in the DB:

```typescript
const { project, user, asUser, t } = await ctx.setupProject();

// Create single task with overrides
const parent = await ctx.task(project._id, user._id, { name: "Parent" });

// Create subtask
const child = await ctx.task(project._id, user._id, {
  name: "Child",
  parentId: parent._id,
});

// Create multiple tasks at once
const [task1, task2, task3] = await ctx.tasks(project._id, user._id, 3);

// Create with specific properties
const urgent = await ctx.task(project._id, user._id, {
  priority: "Critical",
  status: "In Progress",
});
```

## Generators (`gen`)

| Generator | Output | Example |
|-----------|--------|---------|
| `gen.name("Task")` | `"Task 1"`, `"Task 2"`, ... | Auto-incrementing names |
| `gen.email()` | `"user-1@test.com"` | Unique emails |
| `gen.clientId()` | UUID string | For task clientId |
| `gen.rank()` | LexoRank string | For ordering |
| `gen.alias()` | `"T01"`, `"T02"`, ... | Project aliases |
| `gen.tokenIdentifier()` | `"test-user-1"` | Auth tokens |
| `gen.now()` | `Date.now()` | Timestamps |

## Direct DB Access

Use `t.run()` for direct DB operations (setup or assertions):

```typescript
// Mark as deleted directly (bypassing mutation)
await t.run(async (runCtx) => {
  await runCtx.db.patch(task._id, {
    isDeleted: true,
    deletedAt: Date.now(),
  });
});

// Verify DB state
await t.run(async (runCtx) => {
  const task = await runCtx.db.get(taskId);
  expect(task?.isDeleted).toBe(true);
});
```

## Key Patterns

| Pattern | Usage |
|---------|-------|
| `asUser.mutation(api.fn, args)` | Call mutations as authenticated user |
| `asUser.query(api.fn, args)` | Call queries as authenticated user |
| `t.query(api.fn, args)` | Call queries without auth |
| `t.query(internal.fn, args)` | Call internal functions |
| `t.run(async (ctx) => {...})` | Direct DB access |
| `ctx.task(projectId, userId, overrides)` | Create fixture task |
| `ctx.project(orgId, userId, overrides, options)` | Create additional project; seeds the creator as `project-admin` unless `{ withCreatorMembership: false }` |

## Testing Mutations vs Fixtures

- **Testing mutations**: Use `asUser.mutation()` to test the actual mutation logic
- **Creating fixtures**: Use `ctx.task()` to set up test data quickly

```typescript
// Testing the create mutation itself
const { taskId } = await asUser.mutation(api.tasks.core.create, { ... });

// Creating fixture data for other tests
const existingTask = await ctx.task(project._id, user._id, { name: "Existing" });
```
