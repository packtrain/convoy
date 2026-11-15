# Organization Convex Refactor Plan

## Summary

Refactor the organization backend into the domain-folder convention from `convex-backend.md` and simplify repeated DB access through split organization repo helpers. This is an intentional generated API rename with no root compatibility wrappers: root `organizations.ts`, `organizationMembers.ts`, `organizationInvitations.ts`, and `organizationsInternal.ts` are removed after all call sites are migrated.

**Prerequisite**: the appVersion pilot (`convex-app-version-pilot.md`) has landed and its learnings are incorporated. This is the first multi-module domain migration; do not start it until the pilot has proven the codegen/rename mechanics.

Verified preconditions:

- No `ctx.scheduler.run*` references touch any organization module — no scheduled-function shims or drain steps are needed.
- `apps/cli` does not call any organization APIs — blast radius is web app, MCP handlers, and tests. CLI typecheck still runs because the CLI consumes `_generated` types.

## Key Changes

- Move callable modules to:
  - `convex/organizations/core.ts`
  - `convex/organizations/members.ts`
  - `convex/organizations/invitations.ts`
- New API surface (this is both a **module-path** rename and, where noted, a **function-name** rename — call sites change for both reasons):
  - `api.organizations.core.listForUser | getById | getBySlug | checkSlugAvailability | create | update`
  - `api.organizations.members.list | getMyRole | updateRole | remove | leave`
  - `api.organizations.invitations.create | resend | revoke | accept | listPending | getByToken`
  - `internal.organizations.core.getByIdInternal`

### Explicit function moves and renames

| Current | New | Notes |
|---|---|---|
| `organizations.listForUser` | `organizations.core.listForUser` | path only |
| `organizations.getById` | `organizations.core.getById` | path only |
| `organizations.getBySlug` | `organizations.core.getBySlug` | path only |
| `organizations.checkSlugAvailability` | `organizations.core.checkSlugAvailability` | path only |
| `organizations.create` | `organizations.core.create` | path only |
| `organizations.update` | `organizations.core.update` | path only |
| `organizations.listMembers` | `organizations.members.list` | **consolidation**: member listing moves out of the core module into the members module |
| `organizationMembers.getMyRole` | `organizations.members.getMyRole` | path only |
| `organizationMembers.updateRole` | `organizations.members.updateRole` | path only |
| `organizationMembers.remove` | `organizations.members.remove` | path only |
| `organizationMembers.leave` | `organizations.members.leave` | path only |
| `organizationInvitations.createOrganizationInvitation` | `organizations.invitations.create` | **name rename** (drop redundant suffix under nesting) |
| `organizationInvitations.resendOrganizationInvitation` | `organizations.invitations.resend` | **name rename** |
| `organizationInvitations.revokeOrganizationInvitation` | `organizations.invitations.revoke` | **name rename** |
| `organizationInvitations.acceptOrganizationInvitation` | `organizations.invitations.accept` | **name rename** |
| `organizationInvitations.listPendingOrganizationInvitations` | `organizations.invitations.listPending` | **name rename** |
| `organizationInvitations.getOrganizationInvitationByToken` | `organizations.invitations.getByToken` | **name rename** |
| `organizationsInternal.getById` | `internal.organizations.core.getByIdInternal` | **name rename** — `core.ts` also exports the public `getById` query, so the internal variant needs a distinct export name |

- Update all app, MCP, tests, docs, AGENTS/CLAUDE references from old root APIs to the nested APIs.
- Regenerate Convex generated API files with `pnpm --filter @convoy/web exec convex codegen`.

## Repo Helpers, Layering, And Indexes

- Add `convex/organizations/lib/validators.ts` for shared return validators: organization, organization-with-role, member list item, invitation summary.
- Add split repo helpers (direct-import helpers only — they must not export Convex `query`/`mutation`/`action`):
  - `organizationsRepo.ts`: organization ID normalization, `getOrganizationById`, `getActiveOrganizationById`, `getOrganizationBySlug`, `getActiveOrganizationBySlug`, `getActiveOrganizationsByIds`, `requireActiveOrganization`.
  - `membersRepo.ts`: membership lookup/listing, owner lookup, membership deletion, project-membership cleanup for removed org members.
  - `invitationsRepo.ts`: invitation by id/token, pending invitation by org/email, pending list, invitation insert/status/expiration updates.

### `getOrgMembership` layering (direction matters)

Root `lib/access/permissions.ts` is shared cross-domain infrastructure and must **not** import from `organizations/lib/` — that would invert the convention's layering (domain `lib/` is domain-private; root `lib/` must stay domain-neutral). Instead:

- The membership-lookup implementation **stays** in `lib/access/permissions.ts` (it is access infrastructure used by permission checks across domains).
- `organizations/lib/membersRepo.ts` imports `getOrgMembership` from `lib/access` (domain lib importing root shared lib is allowed) and layers the org-specific helpers on top: owner lookup, membership deletion, cascade cleanup.
- Net effect: one DB implementation, dependency arrow pointing domain -> shared, never shared -> domain.

### ESLint import-boundary rule (required in this change)

`convex-backend.md` requires boundary enforcement to land with the first domain `lib/` — this migration creates it. Extend the existing `no-restricted-imports` configuration in `apps/web/eslint.config.mjs` (or add `eslint-plugin-boundaries`) so that:

- Code outside `convex/organizations/` cannot import from `convex/organizations/lib/*`.
- Write the pattern generically (`convex/*/lib/*` from outside the owning domain) so subsequent domain migrations inherit it without new rules.

### Index changes

- Add `organizationMembers.by_organization_and_role = ["organizationId", "role"]`.
  - Replaces the `.filter()` only-owner checks (`organizationMembers.ts` `updateRole`/`leave`): query `eq(organizationId).eq(role, "owner")` via the index, then exclude the current user in JS (owner count is tiny; `neq` cannot be index-backed).
- Add `organizationInvitations.by_org_and_email_and_status = ["organizationId", "email", "status"]`.
  - Replaces the pending-invitation `.collect().find()` pattern in invitation create.
- **Remove `organizationInvitations.by_org_and_email`**: its only caller is the pattern replaced above (verified — no other call sites). Do not keep a redundant prefix index; re-verify with `rg "by_org_and_email\b"` before dropping.
- Preserve current behavior and error messages, including existing slug semantics: create/check availability remain blocked by any existing slug; update keeps its current deleted-org conflict behavior.

## Tests And Docs

- Move tests with modules:
  - `organizations.test.ts -> organizations/core.test.ts`
  - `organizationMembers.test.ts -> organizations/members.test.ts`
  - `organizationInvitations.test.ts -> organizations/invitations.test.ts`
  - The `organizationsInternal.getById` describe block in `organizations.test.ts` follows `getByIdInternal` into `core.test.ts`.
  - Tests for `listMembers` move to `members.test.ts` with the function.
- Update tests for renamed API refs and add/keep coverage for:
  - public/internal get-by-ID behavior
  - slug lookup with API-key scope
  - member listing, role changes, only-owner protection, remove/leave project-membership cleanup
  - invitation create/resend/revoke/accept/list/get-by-token
  - MCP create-task org lookup using `internal.organizations.core.getByIdInternal`
- Update `docs/specs/organization-membership.md`, `docs/specs/mcp-server.md`, `docs/refactoring/convex-backend.md` (mark the organizations step done), plus stale AGENTS/CLAUDE examples.

## Risks

- **Stale browser bundles**: users on the old JS bundle would get "function not found" on every org operation (org switcher, org settings, member management, invites) after deploy until they refresh. The appVersion pilot established the mitigation: keep temporary root shim modules (`organizations.ts`, `organizationMembers.ts`, `organizationInvitations.ts`, `organizationsInternal.ts`) that re-export the moved functions under their old names (`export { createOrganizationInvitation } from "./organizations/invitations";`-style aliases for the renamed ones), and delete the shims one deploy cycle later once the `AppVersionWatcher` refresh banner has moved users off old bundles. File-plus-folder coexistence is verified to work.
- **File-plus-folder coexistence**: the root `organization*.ts` files must be deleted in the same change the `organizations/` folder is created.

## Validation

```bash
pnpm --filter @convoy/web exec convex codegen
pnpm --filter @convoy/web exec vitest run convex/organizations/core.test.ts convex/organizations/members.test.ts convex/organizations/invitations.test.ts convex/mcp/handler.test.ts
pnpm web:test:once
pnpm web:lint
cd apps/web && npx tsc --noEmit
pnpm --filter @useconvoy/cli typecheck
rg "\.filter\(" apps/web/convex/organizations          # repo helpers must be index-backed
rg "api\.organization|internal\.organization" apps -g '!**/_generated/**'   # only nested api.organizations.* refs remain
rg "by_org_and_email\b" apps/web/convex -g '!_generated'                    # confirm dropped index has no callers
```

## Outcome (implemented 2026-06-11)

Implemented as planned, **with temporary backward-compatibility shims kept** (the root modules re-export the moved functions under their legacy names, mirroring the appVersion pilot). Notes:

- `convex/organizations/shims.test.ts` covers one legacy path per shim module; delete it together with the shims one deploy cycle after this ships.
- `internal.organizationsInternal.getById` is internal-only, so its shim can be dropped as soon as the deploy is live (no stale-browser exposure).
- The generic `convex/<domain>/lib/*` import boundary landed in `apps/web/eslint.config.mjs` via relative-path `no-restricted-imports` patterns (cross-domain lib imports always name the foreign domain segment before `lib/`; own-lib and root-lib imports never do).
- Caught during validation: `task-types-section.test.tsx` hand-mocks the generated API and needed its mock shape updated; stale function-reference assertions in `mcp/handler.test.ts` passed vacuously (Convex API proxies compare deep-equal) and were fixed by grep, not by test failures.
- `members.list` reuses `getMembership` for the access check and `core.update` now uses the shared `getOrganizationBySlug` (`.unique()`) for the slug-uniqueness check where it previously used `.first()`; behavior is identical because `create` blocks duplicate slugs entirely.

Follow-up (separate change, one deploy cycle later): delete the four root shim modules, `shims.test.ts`, and the transitional notes in `docs/specs/organization-membership.md`.

## Assumptions

- No public root API shims are kept; this refactor prioritizes a clean Convex root over backward-compatible generated API paths (stale-bundle consequence accepted, see Risks).
- No scheduled org functions exist (verified — `rg "scheduler\.run"` has no hits into this domain), so no shims/drain steps are needed.
- The split repo files are implementation helpers only and must not export Convex `query`/`mutation`/`action` functions.
- `apps/cli` has no organization API call sites (verified); CLI typecheck is run only to confirm regenerated types stay consistent.
