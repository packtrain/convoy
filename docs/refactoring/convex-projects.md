# Projects Convex Refactor

## Summary

Move the projects backend into the domain-folder convention from `convex-backend.md`, following the organizations migration (`convex-organizations.md`) as the playbook. Root `projects.ts` and `projectMembers.ts` become temporary re-export shims for stale browser bundles.

Verified preconditions:

- No `ctx.scheduler.run*` references touch any project module — no scheduled-function shims or drain steps are needed.
- `apps/cli` calls `api.projects.*` heavily (`listAccessible`, `getById`, project resolution), so CLI typecheck and CLI tests are part of validation.

## Key Changes

- Callable modules:
  - `convex/projects.ts` → `convex/projects/core.ts`
  - `convex/projectMembers.ts` → `convex/projects/members.ts`
- Domain support code:
  - `convex/projects/errors.ts` — user-facing message catalog
  - `convex/projects/lib/validators.ts` — shared `projectValidator`
  - `convex/projects/lib/projectsRepo.ts` — projects table access (alias lookups, insert/update/soft-delete with stamped system fields)
  - `convex/projects/lib/membersRepo.ts` — projectMembers table access; membership lookup delegates to `lib/access/permissions.getProjectMembership` (one DB implementation, dependency arrow domain → shared)

### Explicit function moves and renames

| Current | New | Notes |
|---|---|---|
| `projects.listByOrganization` | `projects.core.listByOrganization` | path only |
| `projects.getById` | `projects.core.getById` | path only |
| `projects.create` | `projects.core.create` | path only |
| `projects.update` | `projects.core.update` | path only |
| `projects.getByAlias` | `projects.core.getByAlias` | path only |
| `projects.updateAlias` | `projects.core.updateAlias` | path only |
| `projects.remove` | `projects.core.remove` | path only |
| `projects.listAccessible` | `projects.core.listAccessible` | path only |
| `projectMembers.listByProject` | `projects.members.list` | **name rename** (drop redundant suffix under nesting) |
| `projectMembers.getMyRole` | `projects.members.getMyRole` | path only |
| `projectMembers.listAssignable` | `projects.members.listAssignable` | path only |
| `projectMembers.listEligibleToAdd` | `projects.members.listEligibleToAdd` | path only |
| `projectMembers.add` | `projects.members.add` | path only |
| `projectMembers.updateRole` | `projects.members.updateRole` | path only |
| `projectMembers.remove` | `projects.members.remove` | path only |

### Internals modernized during the move (behavior unchanged)

- Guard validations use `ensure` + the `errors.ts` catalog (alias format/uniqueness, member add/update/remove guards). Error messages are byte-identical to the previous inline `ConvexError` strings.
- Doc-enrichment joins use the `join` helper (`lib/shared/join.ts`): `members.list`, `members.listAssignable` (previously sequential per-row `ctx.db.get` loops), `members.listEligibleToAdd`, and the org join inside `core.listAccessible`.
- Cross-domain table access goes through repos: `organizations/lib/organizationsRepo` (`getActiveOrganizationsByIds`, `requireActiveOrganization`), `organizations/lib/membersRepo` (`listMembershipsForUser`, `listMembershipsForOrganization`), `users/lib/usersRepo` (`getUserById`, `getUsersByIds`).
- `members.add` reuses `requireActiveOrganization`, which throws the same "Organization not found" message the inline check used.

## Outcome (implemented 2026-06-11)

Implemented as planned with temporary root shims:

- `convex/projects.ts` re-exports all core functions under their legacy names; `convex/projectMembers.ts` re-exports members functions including `list as listByProject`.
- `convex/projects/shims.test.ts` covers one legacy path per shim module; delete it together with the shims one deploy cycle after this ships.
- Tests moved: `projects.test.ts` → `projects/core.test.ts`, `projectMembers.test.ts` → `projects/members.test.ts` (mock path for `lib/notifications/email` adjusted for the new directory depth).
- Org-migration lesson confirmed again: `project-member-row.test.tsx` hand-mocks `@/convex/_generated/api` and needed its mock shape updated to `api.projects.members.*`; the failure surfaced in the full suite, but stale proxy-reference assertions would not — grep for old refs explicitly.
- Call sites rewritten: ~20 web files, ~16 CLI files, MCP handlers (`mcp/handlers/projects.ts`, `lib/mcp/projects/context.ts`), root-level Convex tests (`apiKeys.test.ts`, `auth.test.ts`, `defaultList.test.ts`), and `docs/specs/project-sidebar-sorting.md`.

Follow-up (separate change, one deploy cycle later): delete `convex/projects.ts`, `convex/projectMembers.ts`, and `convex/projects/shims.test.ts`.

## Validation (all green at implementation)

```bash
pnpm --filter @convoy/web exec convex codegen
pnpm web:test:once                                  # 2311 tests
pnpm web:lint
cd apps/web && npx tsc --noEmit
pnpm --filter @useconvoy/cli typecheck
pnpm --filter @useconvoy/cli test:once               # 282 tests
rg "scheduler\.run" apps/web/convex/projects        # no hits
rg "\.filter\(" apps/web/convex/projects/lib        # repo helpers index-backed, no hits
rg "api\.projectMembers\.|api\.projects\.(?!core|members)" apps --pcre2 -g '!**/_generated/**' -g '!**/dist/**'  # only shim comments remain
```
