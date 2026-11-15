# Permissions System Specification

This document describes the authorization and permission system used in the Convex backend.

## Overview

The application uses a **two-level permission model**:
1. **Organization-level permissions** - Control access to organization resources and member management
2. **Project-level permissions** - Control access to projects, tasks, and related resources

**Key Rule**: Project access is **explicit only**. A `projectMembers` row is the
sole grant, for every project and every role — an organization owner or admin
with no row has no access to that project (OS-1536).

## Roles

### Organization Roles

| Role | Description |
|------|-------------|
| `owner` | Full organization control, including deletion |
| `admin` | Administrative functions (no org deletion) |
| `member` | Basic org member, limited permissions |

### Project Roles

| Role | Description |
|------|-------------|
| `project-admin` | Full project control |
| `member` | Can view, create, update, delete tasks |
| `viewer` | Read-only access |

## Permission Enums

### Organization Permissions (`OrgPermission`)

| Permission | Description |
|------------|-------------|
| `org:update` | Update organization settings |
| `org:delete` | Delete the organization |
| `members:invite` | Invite new members |
| `members:remove` | Remove members |
| `members:update_role` | Change member roles |
| `project:create` | Create new projects |
| `project:delete` | Delete projects |
| `projects:manage_all` | List every project in the org and manage its members, including projects the holder is not a member of |
| `slash_commands:manage` | Create, update, and delete organization slash commands |
| `agents:manage` | Create, update, and delete organization Agent templates |
| `skills:manage` | Create, update, and delete organization Skills |

### Project Permissions (`ProjectPermission`)

| Permission | Description |
|------------|-------------|
| `project:view` | View project and its contents |
| `project:update` | Update project settings |
| `project:archive` | Archive/unarchive the project |
| `project_members:add` | Add members to project |
| `project_members:remove` | Remove members from project |
| `task:view` | View tasks |
| `task:create` | Create tasks |
| `task:update` | Update tasks |
| `task:delete` | Delete tasks |
| `slash_commands:manage` | Create, update, and delete project-scoped Slash commands (project prompts) |
| `project_skills:manage` | Create, update, and delete project Skills; install and refresh once those land |
| `list:manage` | Create, edit, archive, unarchive, and delete project Lists |
| `list:pin` | Pin/unpin project Lists to the sidebar (see [project-sidebar-pinned-lists.md](project-sidebar-pinned-lists.md)) |
| `comment:create` | Create comments |
| `comment:update_own` | Update own comments |
| `comment:delete_own` | Delete own comments |
| `comment:delete_any` | Delete any comment |

## Role-Permission Mappings

### Organization Role Permissions

| Permission | owner | admin | member |
|------------|:-----:|:-----:|:------:|
| `org:update` | X | X | |
| `org:delete` | X | | |
| `members:invite` | X | X | |
| `members:remove` | X | X | |
| `members:update_role` | X | X | |
| `project:create` | X | X | X |
| `project:delete` | X | X | |
| `projects:manage_all` | X | X | |
| `slash_commands:manage` | X | X | |
| `agents:manage` | X | X | |
| `skills:manage` | X | X | |

### Project Role Permissions

| Permission | project-admin | member | viewer |
|------------|:-------------:|:------:|:------:|
| `project:view` | X | X | X |
| `project:update` | X | | |
| `project:archive` | X | | |
| `project_members:add` | X | | |
| `project_members:remove` | X | | |
| `task:view` | X | X | X |
| `task:create` | X | X | |
| `task:update` | X | X | |
| `task:delete` | X | X | |
| `slash_commands:manage` | X | X | |
| `project_skills:manage` | X | X | |
| `list:manage` | X | X | |
| `list:pin` | X | | |
| `comment:create` | X | X | |
| `comment:update_own` | X | X | |
| `comment:delete_own` | X | X | |
| `comment:delete_any` | X | | |

How the web UI presents these roles (what a viewer sees hidden, disabled, or
read-only) is in [read-only-viewer-ux.md](read-only-viewer-ux.md). This spec
covers only the backend model.

## Explicit Access Rule

**Org role never substitutes for project membership.** For any project
permission:

- Org membership is still required — it scopes *which* projects are even
  considered, and a non-member of the org is denied before any project read.
- The caller's `projectMembers` row then decides the answer. No row, no access,
  whatever their org role.
- Nothing synthesizes a role: `projects.members.getMyRole` returns `null` for an
  owner with no row, and `projects.core.listAccessible` reports the project role
  rather than `org-owner`/`org-admin`.

The three former bypass sites in `convex/lib/access/permissions.ts`
(`getProjectAccessDecision`, `hasAuthorizedProjectPermission`,
`filterProjectsByAccess`) are gone, so all 31 calling modules — tasks, threads,
CLI, artifacts, comments, agents, costs, slash commands — inherit the rule.

`filterProjectsByAccess` still takes the caller's `orgMembership`: it is proof of
org membership already fetched by the caller, not a grant.

### What an org leader keeps

Removing the bypass does not make owners and admins powerless; their remaining
authority is org-level and deliberate:

| Capability | Gate | Why it is not project access |
| --- | --- | --- |
| List/open every project's management metadata | `projects:manage_all` | Metadata only — see [Listing projects vs. accessing them](#listing-projects-vs-accessing-them) |
| Add/remove/re-role members on any project | `projects:manage_all` | The recovery path into a memberless project |
| Edit project name, alias, description, color | `projects:manage_all` | Reached from org settings, not from inside the project |
| Delete a project | `project:delete` | See below |
| Create a project | `project:create` | Creator is inserted as `project-admin` |

`projects.core.remove` checks **only** `OrgPermission.PROJECT_DELETE`, with no
project-level check. An org admin who is not a project member can therefore
delete a project they cannot open. That is intentional: deletion is an
org-level capability, like creation. Do not "fix" it by adding a `project:view`
check — that would break admin cleanup of memberless projects, which is the one
case where deletion matters most.

A caller without `project:delete` gets a `ConvexError` with
`errors.PROJECT_DELETE_FORBIDDEN`, which the UI shows as a toast.

Because a project's last member may remove themselves, a project can end up with
no members at all. That is recoverable, not broken: an owner/admin adds someone
back through the org-settings Projects list. Only "last owner in the
organization" needs protecting, and `organizations.members` already does that.

### Org-level authority over project members

Everything reachable from the org-settings Projects section authorizes on org
authority, never on project membership. `convex/projects/lib/permissions.ts`
exports the pair every such entry point goes through:

| Helper | Use |
| --- | --- |
| `authorizeProjectAuthority(ctx, userId, projectId, permission)` | Queries — returns the project, or `null` when denied |
| `requireProjectAdministration(ctx, userId, projectId, permission)` | Mutations — returns the project, throws when denied |

Each accepts the project permission **or** org-level `projects:manage_all` as an
explicit alternative. Current callers: `projects.members.list`,
`listAssignable`, `listEligibleToAdd`, `add`, `updateRole`, `remove`, and
`projects.core.update`, `updateAlias`. The org-level alternative is what keeps
these surfaces working for a leader with no `projectMembers` row.

Any new function an org admin can reach for a project they are not a member of
must use these helpers rather than `requireAuthorizedProject` directly.

#### Authority over the member being changed

Org owners and admins are ordinary project members: their `projectMembers` row is
their only project role, and `listAssignable` lists them by it like anyone else.

So the caller check is not sufficient on its own: `PROJECT_MEMBERS_ADD` is a
project-scoped permission a `project-admin` holds regardless of org role.
Without a second check, a plain org member who is `project-admin` could add,
demote, or remove an org owner — and that row *is* the owner's access.
`requireAuthorityOverMember` closes that: when the **target** is an org owner or
admin, the caller must hold `projects:manage_all`. It guards `add`,
`updateRole`, and `remove`; `listEligibleToAdd` applies the same rule as a
filter so the UI never offers a target the caller cannot act on.

#### Backfilled explicit grants

`backfillOrgLeaderProjectMemberships` (`convex/migrations.ts`) inserted a
`project-admin` `projectMembers` row for every org owner/admin × active project,
so removing the implicit bypass revoked nobody (OS-1535). It ran on both
deployments before OS-1536 landed; a deployment that skips it revokes every
leader who has no explicit row.

Three rules the migration encodes:

- **Existing rows win.** An owner/admin already added as `viewer` or `member`
  keeps that role; `getMembership` makes the migration idempotent rather than an
  upsert, so re-running never promotes anyone.
- **Archived projects are included, soft-deleted ones are not.** An archived
  project can be unarchived, and unarchiving must not resurrect a project whose
  leaders have no grant.
- **The grant is permanent.** It converted the old *derived* breadth into
  *explicit* rows, so an owner demoted to org member keeps every project they
  were granted — the same as any hand-added member. That is the explicit-ACL
  model, not a leak. Leaving the org still revokes everything, via
  `removeMembershipWithProjectCleanup`.

`verifyOrgLeaderProjectMembershipBackfill` reports the first missing
(project, leader) pairs.

### Listing projects vs. accessing them

`projects.core.listAllForOrganization` and its single-project counterpart
`projects.core.getForOrganizationManagement` are the documented exceptions to
`filterProjectsByAccess`: gated on `projects:manage_all`, they resolve **every**
active project in the org, including ones the caller cannot open. This is the
recovery path into a project with no members, so it must reach them.

The payload is metadata only — name, alias, color, description, archived flag,
creation time, creator. Knowing a project exists is a management handle, not an
access grant; no task, list, thread, or settings data may be added to it. In
particular it carries no member count: that would cost one membership read per
project on every list render.

`getForOrganizationManagement` returns `null` for missing, deleted, and
unauthorized alike, so a caller without the permission cannot use it to probe
whether a project exists.

## Permission Helper Functions

Located in `convex/lib/access/permissions.ts`:

### Require Functions (Throw on Denial)

| Function | Use Case |
|----------|----------|
| `requireOrgPermission(ctx, userId, orgId, permission)` | Org mutations |
| `requireAuthorizedProject(ctx, principal, projectOrId, permission, options?)` | Project mutations and callsites that need the authorized project document |

### Conditional Check Functions (Return Boolean/Null)

| Function | Use Case |
|----------|----------|
| `hasOrgPermission(ctx, userId, orgId, permission)` | Org queries |
| `hasProjectAccess(ctx, principal, projectOrId, permission)` | Project queries that only need a boolean |
| `authorizeProjectAccess(ctx, principal, projectOrId, permission)` | Project queries and callsites that need authorized project/membership metadata |

`principal` may be either a raw `Id<"users">` or an authenticated access
context:

```typescript
{
  userId: Id<"users">;
  apiKeyScope:
    | null
    | { kind: "unscoped" }
    | {
        kind: "organization";
        organizationId: Id<"organizations">;
        projectIds: Id<"projects">[];
      };
}
```

API key auth helpers normalize missing key scope to `{ kind: "unscoped" }` and
return authenticated access metadata:

```typescript
getOptionalAuthenticatedAccess(ctx, apiKey?) =>
  | {
      user: Doc<"users">;
      principal: {
        userId: Id<"users">;
        apiKeyScope: ApiKeyScope | null;
      };
    }
  | null

internal.apiKeys.core.validateByKey({ apiKey }) =>
  | {
      userId: Id<"users">;
      apiKeyId: Id<"apiKeys">;
      apiKeyScope: ApiKeyScope;
    }
  | null
```

API key scope is stored as optional key metadata:

```typescript
scope?: {
  kind: "organization";
  organizationId: Id<"organizations">;
  projectIds: Id<"projects">[];
}
```

When `apiKeyScope` is present, project authorization first checks that the
project is inside the credential boundary, then applies the user's normal
project permission. An organization scope with an empty `projectIds` array
allows every user-accessible project in that organization.
Project discovery must apply the same boundary: a scoped API key can only list
projects that are both user-accessible and inside the credential boundary.
The boundary applies to every project-owned resource after its owning project is
known, including calls that start from raw task, comment, artifact, thread, or
session IDs rather than a project ID or task ref.
API keys are personal credentials. The owning user may create a key scoped to an
organization where they are a member, may add projects they can view inside that
organization, and may later change or clear that scope. Scope updates do not
grant permissions beyond the user's current access.
Scope updates take effect on the next request that uses the key. Existing MCP
clients and CLI sessions keep the same token, but all future project-owned
requests must be evaluated against the current stored scope. CLI heartbeat is a
liveness update for an already-created session and remains ownership-based to
avoid repeated project permission reads on the long-running heartbeat loop.
CLI claim heartbeat and stream chunk append are also treated as in-flight
claim/message lifecycle operations: they check ownership and claim state, while
project/scope enforcement stays on work discovery, claim, run start, and
terminal run mutations.
Thread creation and messaging are API-key reachable so agents can spawn threads
and talk to them over MCP and the CLI (OS-1162): `cli.threads.core.create`,
`cli.threads.groups.addThreadToGroup`, `cli.messages.send`, and
`cli.profiles.listByProject` accept an optional `apiKey` and pass `principal` to
project authorization. A key resolves to its owning user and grants nothing that
user does not already have — there is no service identity, so an agent can only
create threads for its own user, on its own profiles, from its own source
thread, and can only post to threads it owns. Every existing guard on those
functions applies to the API-key caller unchanged; opening the auth seam does
not relax ownership, container, or group cap checks. Adding `apiKey` to a
function whose handler authorizes a *second* project permission means threading
`principal` through that call too, not only the first — `cli.threads.core.create` and
`cli.messages.send` with a `taskId` authorize `task:view` on the task's project,
and a bare user id there would resolve the key's scope and then ignore it.
The three thread-attachment upload steps are key-reachable for the same reason
(OS-1632): `cli.messages.generateMessageAttachmentUploadUrl`,
`registerPendingUploadedAttachment`, and `deletePendingUploadedAttachment`. They
are `cli:thread`-gated on a `projectId` argument rather than on a thread, so the
`principal` swap needs no thread-ownership resolution; pending-upload ownership
stays on the key's owning user, which is what lets the same caller reclaim its
own abandoned blob.
Scope state has three distinct meanings:

- No organization scope means the key is unscoped.
- An organization scope with no selected projects means all user-accessible
  projects in that organization.
- An organization scope with selected projects means only those selected
  projects, as long as they still belong to the scoped organization and remain
  user-accessible.
The scope picker labels the unscoped option "All my organizations" and an empty
project selection "All my projects".
Editing a key's scope does not reveal, regenerate, or rotate the secret. Secret
rotation remains a separate delete/create flow.
API key management surfaces should make scope visible at a glance. Key rows show
a compact shield icon beside the key name only when the key is scoped.
Unscoped keys show no scope marker. The key name itself opens the metadata
popover containing created/expires dates and scope details, avoiding a separate
info icon.
Manual keys expire at a chosen date up to one year out, or never (OS-2029). A key
without `expiresAt` never expires; its expiry cell and popover show Never. Only
manual keys may omit expiry. CLI-login, MCP OAuth and worker keys always carry one.
Create/edit scope forms show the organization selector before project selection.
The project selector remains visible but disabled until an organization is
selected. Changing the selected organization clears any selected projects.

`projectOrId` may be either an `Id<"projects">` or an already loaded
`Doc<"projects">`. Passing a loaded project document avoids an extra project
read. `authorizeProjectAccess` and `requireAuthorizedProject` return
authorization metadata:

```typescript
{
  project: Doc<"projects">;
  orgMembership: Doc<"organizationMembers">;
  projectMembership: Doc<"projectMembers"> | null;
}
```

`authorizeProjectAccess` returns `null` when access is denied or the project is
deleted. `requireAuthorizedProject` throws with the same project access failure
messages and returns the same metadata shape on success.
When callers should not reveal whether a resource exists or authorization
failed, pass `{ convexErrorMessage: "..." }` to `requireAuthorizedProject`; the
required path will throw a user-facing `ConvexError` with that message instead
of the detailed access failure.

Use `hasAuthorizedProjectPermission(access, permission)` when a caller already
has an `AuthorizedProjectAccess` value and needs to check another permission
without re-reading the project or memberships.

### Utility Functions

| Function | Use Case |
|----------|----------|
| `getOrgMembership(ctx, userId, orgId)` | Look up org membership |
| `getProjectMembership(ctx, userId, projectId)` | Look up project membership |
| `hasAuthorizedProjectPermission(access, permission)` | Check an additional project permission from existing authorization metadata |
| `filterProjectsByAccess(ctx, userId, orgMembership, projects, permission)` | Efficiently filter projects list |
| `hasOrgPermission(ctx, userId, orgId, permission)` | Predicate-only org permission check |

## Usage Patterns

### Mutations

```typescript
export const update = mutation({
  args: { projectId: v.id("projects"), ... },
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    // Throws if user lacks permission
    const { project } = await requireAuthorizedProject(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.TASK_UPDATE
    );

    // Proceed with operation using the authorized project document
  },
});
```

### Queries

```typescript
export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) return [];

    // Returns null if denied (no throw)
    const access = await authorizeProjectAccess(
      ctx,
      user._id,
      args.projectId,
      ProjectPermission.TASK_VIEW
    );

    if (!access) return [];

    // Proceed with query using access.project if needed
  },
});
```

For predicate-only query paths, use `hasProjectAccess`:

```typescript
if (
  !(await hasProjectAccess(
    ctx,
    user._id,
    args.projectId,
    ProjectPermission.TASK_VIEW
  ))
) {
  return [];
}
```

## Source Files

| File | Purpose |
|------|---------|
| `lib/authz/permissions.ts` | Permission enums and role mappings (frontend + backend) |
| `lib/authz/roles.ts` | Role type definitions |
| `convex/lib/access/permissions.ts` | Backend permission helpers |
| `convex/lib/contracts/validators.ts` | Convex validators for roles |

## Anti-Patterns

### DON'T: Inline Membership Checks

```typescript
// BAD - bypasses permission framework
const membership = await ctx.db.query("organizationMembers")
  .withIndex("by_organization_and_user", ...)
  .unique();
if (!membership) throw new Error("Not authorized");
```

### DO: Use Permission Helpers

```typescript
// GOOD - consistent, maintainable
await requireAuthorizedProject(ctx, userId, projectId, ProjectPermission.TASK_UPDATE);
```

### DON'T: Check Only Org Membership for Project Resources

```typescript
// BAD - allows ALL org members to access project resources
const membership = await ctx.db.query("organizationMembers")...
if (!membership) return [];
// Missing project-level check!
```

### DO: Check Project Permission for Project Resources

```typescript
// GOOD - respects project membership
if (!(await hasProjectAccess(ctx, userId, projectId, ProjectPermission.TASK_VIEW))) {
  return [];
}
```

## CLI project creation (OS-1961)

`projects.core.create` accepts JWT or API-key authentication. API keys must be
unscoped or organization-wide for the target active organization. Project-ID
allowlists cannot create projects. The owner still needs `project:create`.
Creation preserves the alias checks, creator membership and default Inbox in
one transaction. No key scope changes implicitly.

`apiKeys.core.createProjectKey` requires a valid broad manual API key and project-admin
permission on the selected project. It issues a separate key restricted to that
one project. Expiry cannot exceed the source key's expiry or one year; a source
without expiry yields a one-year worker. These
keys are visible and revocable in API Keys; see [API key lifecycle](#api-key-lifecycle).
Deleting, expiring or narrowing a source invalidates workers it no longer covers.
JWT presence does not let a restricted source issue broader credentials.
CLI-login and MCP-only sources cannot issue worker credentials. The read-only
validateWorkerSetupKey query checks source eligibility and broad scope before
isolated project creation; issuance checks the target project permission again.

### API key lifecycle

A user may hold any number of API keys of any kind: manual, CLI-login, MCP OAuth
and project-worker. The per-user cap of 100 (OS-2026) was removed in OS-2243
because it blocked environments. One key per environment plus one worker per
isolated project reaches 100 at 5 machines × 20 projects. Key validation is a
hash lookup, so the count never affected authentication.

Minting inserts one key and reads none of the user's other keys. The only
exception is CLI login: a re-login from the same hostname deletes every key
with that kind and name, found through the `by_userId_and_kind_and_name` index.
Names are not unique, since a user can rename a key to collide, so mint deletes
all matches.

Cleanup runs outside mint:

- A daily cron (`apiKeys.core.sweepExpiredKeys`, 04:27 UTC) deletes expired CLI-login,
  MCP OAuth and worker keys in batches of 100 through `by_kind_and_expiresAt`,
  rescheduling itself until drained. Expired manual keys stay listed.
- Deleting a manual key schedules `apiKeys.core.deleteWorkersOfSource`, which
  deletes its workers through `by_sourceKeyId` in batches of 100.
- An expiring source fires no event. Its workers go anyway: a worker's expiry
  is clamped to its source's at issuance and no key's expiry changes later, so
  the workers have expired by then and the cron deletes them.

Until cleanup runs, authentication already rejects these keys.

API Keys lists the user's keys from `apiKeys.core.list`, paginated over
`by_user`, 100 per page, newest first, with a Load more control.

### Linked worker keys

New worker keys have kind project-worker and sourceKeyId. Authentication rejects
missing, expired, foreign-owner or non-manual sources, malformed worker scopes, and
source scopes that no longer include the worker project. This rule applies to
direct Convex authentication and both internal raw-key/hash validators. Checks
are live database reads, without an authorization cache. Already completed
operations are not undone; an agent process may continue local work after loss
of backend authorization.

Worker keys cannot delegate, change scope, or detach from their source. They can
be deleted in API Keys. Their kind, source name and source validity requirement
appear in the existing key-name popover, without a second line in the table row.
The expiry cell shows Inactive when the credential is invalid; the popover gives
the reason. Listing computes the same validity projection as authentication. It
loads each worker's source with a point read, since the source may be on another
page, and shows the source name only when the caller owns it. It does not expose
source IDs or secrets.

A user registers a worker per project per installation (host, VM or
devcontainer). Scope-narrowed workers are kept because restoring coverage can
reactivate them. Do not replace valid workers for the same source/project:
another installation may still depend on them.

Registration reuses a stored worker secret only after a backend query confirms
its hash, live source link and single-project scope against the supplied source
key. No plaintext secret is retrieved from the backend. Prepare the workspace
before minting so clone failures do not leave unused keys. Without a saved secret,
issuance may still require a new key; uncertain requests are not blindly replayed.
