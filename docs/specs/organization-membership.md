# Organization Membership & Invitations Specification

This document specifies the business rules for organization membership, role management, and invitations. It serves as a reference for unit tests, user documentation, and QA testing.

## Overview

Organizations are the top-level container for projects and team collaboration. Users join organizations as members with specific roles that determine their permissions. New members are added via email invitations with magic link authentication.

---

## Quick Reference

### Role Hierarchy

| Role       | Level   | Description                                        |
| ---------- | ------- | -------------------------------------------------- |
| **Owner**  | Highest | Full control, can delete org, manage all members   |
| **Admin**  | Middle  | Can manage members and projects, cannot delete org |
| **Member** | Lowest  | Can create projects, limited member management     |

### Permission Matrix

| Permission                   | Owner | Admin | Member |
| ---------------------------- | :---: | :---: | :----: |
| Update organization settings |   ✓   |   ✓   |   -    |
| Delete organization          |   ✓   |   -   |   -    |
| Invite members               |   ✓   |   ✓   |   -    |
| Remove members               |   ✓   |   ✓   |   -    |
| Update member roles          |   ✓   |  ✓\*  |   -    |
| Create projects              |   ✓   |   ✓   |   ✓    |
| Delete projects              |   ✓   |   ✓   |   -    |

\*Admins have restrictions on role changes (see Role Management Rules)

---

## Roles

### Organization Roles

```typescript
type OrgRole = "owner" | "admin" | "member";
```

| Role     | Description                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `owner`  | Full organization control. At least one owner must exist at all times.                                                      |
| `admin`  | Can manage members and projects, cannot delete the organization, and has access to all projects in the org.                 |
| `member` | Basic membership with project creation rights. Members only have access to projects they create or are explicitly added to. |

### Invitation Roles

```typescript
type InvitationRole = "admin" | "member";
```

Users cannot be invited directly as owners. Ownership must be granted by an existing owner after the user joins.

---

## Invitations

### Invitation Lifecycle

```
┌─────────────┐
│   PENDING   │ ← Initial state when invitation is created
└──────┬──────┘
       │
       ├──── User clicks link + correct email ────► ACCEPTED
       │
       ├──── Admin revokes invitation ────────────► REVOKED
       │
       └──── 7 days pass ─────────────────────────► EXPIRED
```

### Invitation States

| Status     | Description                                     |
| ---------- | ----------------------------------------------- |
| `pending`  | Awaiting user action. Can be resent or revoked. |
| `accepted` | User successfully joined the organization.      |
| `revoked`  | Admin cancelled the invitation.                 |
| `expired`  | 7-day validity period elapsed.                  |

### Business Rules: Creating Invitations

| Rule                        | Behavior                                                   |
| --------------------------- | ---------------------------------------------------------- |
| **Permission required**     | `MEMBERS_INVITE` (Owner or Admin)                          |
| **Email normalization**     | Emails are lowercased and trimmed                          |
| **Existing member check**   | Cannot invite someone who is already a member              |
| **Duplicate pending check** | Cannot create duplicate pending invitations for same email |
| **Token generation**        | Unique UUID token generated for each invitation            |
| **Expiration**              | Invitations expire after 7 days                            |

### Business Rules: Accepting Invitations

| Rule                        | Behavior                                                                |
| --------------------------- | ----------------------------------------------------------------------- |
| **Authentication required** | User must be logged in to accept                                        |
| **Email verification**      | Logged-in user's email must match invitation email                      |
| **Invitation detail privacy** | Invitation details are only returned to an authenticated identity whose email matches the invitation email |
| **Token validation**        | Invalid tokens are rejected                                             |
| **Status validation**       | Only `pending` invitations can be accepted                              |
| **Expiration check**        | Expired invitations are rejected                                        |
| **Already member**          | If user is already a member, invitation is marked accepted (idempotent) |
| **Role assignment**         | User joins with the role specified in invitation                        |

### Business Rules: Resending Invitations

| Rule                    | Behavior                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| **Permission required** | `MEMBERS_INVITE` (Owner or Admin)                                                    |
| **Status requirement**  | Can only resend `pending` invitations                                                |
| **Expiration reset**    | Extends expiration by 7 days from now                                                |
| **Same token**          | Reuses existing token (previous link still works)                                    |
| **Template reuse**      | Uses the shared `org-invitation` template defined in `docs/specs/email-templates.md` |

### Business Rules: Revoking Invitations

| Rule                    | Behavior                                      |
| ----------------------- | --------------------------------------------- |
| **Permission required** | `MEMBERS_INVITE` (Owner or Admin)             |
| **Status requirement**  | Can only revoke `pending` invitations         |
| **Link invalidation**   | Token remains but invitation becomes unusable |

---

## Member Management

### Updating Roles

#### Permission Requirements

| Actor Role | Can Change           | To Role              |
| ---------- | -------------------- | -------------------- |
| Owner      | Owner, Admin, Member | Owner, Admin, Member |
| Admin      | Admin, Member        | Admin, Member        |
| Member     | -                    | -                    |

#### Business Rules

| Rule                           | Behavior                                                  |
| ------------------------------ | --------------------------------------------------------- |
| **Permission required**        | `MEMBERS_UPDATE_ROLE` (Owner or Admin)                    |
| **Admin → Owner restriction**  | Admins cannot promote anyone to Owner                     |
| **Admin vs Owner restriction** | Admins cannot change an Owner's role                      |
| **Self-demotion (Owner)**      | Owners can demote themselves only if another Owner exists |
| **Target must be member**      | Cannot update role for non-members                        |

#### Self-Demotion Flow

```
Owner wants to demote self to Admin:
  │
  ├── Check: Are there other owners?
  │      │
  │      ├── YES → Allow demotion
  │      │
  │      └── NO  → Reject: "Cannot demote yourself as the only owner.
  │                         Transfer ownership first."
```

### Removing Members

#### Permission Requirements

| Actor Role | Can Remove           |
| ---------- | -------------------- |
| Owner      | Owner, Admin, Member |
| Admin      | Admin, Member        |
| Member     | -                    |

#### Business Rules

| Rule                           | Behavior                                      |
| ------------------------------ | --------------------------------------------- |
| **Permission required**        | `MEMBERS_REMOVE` (Owner or Admin)             |
| **No self-removal**            | Cannot remove yourself (use "Leave" instead)  |
| **Admin vs Owner restriction** | Admins cannot remove Owners                   |
| **Target must be member**      | Cannot remove non-members                     |
| **Cascade deletion**           | Removes member from all organization projects |

### Leaving Organization

#### Business Rules

| Rule                       | Behavior                                       |
| -------------------------- | ---------------------------------------------- |
| **No permission required** | Any member can leave                           |
| **Owner restriction**      | Owners cannot leave if they are the only owner |
| **Cascade deletion**       | Removes user from all organization projects    |

#### Owner Leaving Flow

```
Owner wants to leave:
  │
  ├── Check: Are there other owners?
  │      │
  │      ├── YES → Allow leaving
  │      │
  │      └── NO  → Reject: "Cannot leave as the only owner.
  │                         Transfer ownership to another member first,
  │                         or delete the organization."
```

---

## Organization Settings

The route shell renders each section's title and its description
(`ORGANIZATION_SETTINGS_SECTION_DESCRIPTIONS`) through `SettingsPageHeader`.

Members and Projects share the catalog toolbar used by Prompts and Agents: a
search input on the left and the create button (`size="settings"`) on the
right, stacked on mobile. A search that matches nothing shows a dashed
"No … match this search." placeholder.

### Members UI

- Search matches member name or email. Pending invitations are not filtered.

- Pending invitation rows use the same `p-4` vertical density as organization
  member rows while preserving their existing horizontal alignment and actions.

### Projects UI

Settings → Projects lists **every** active project in the organization, gated on
`projects:manage_all` (owners and admins). It is the recovery path into a project
with no members, so it deliberately includes projects the caller is not a member
of and cannot open — which, since OS-1536 removed implicit access, is the normal
case rather than an edge one.

| Aspect | Behavior |
| --- | --- |
| **Nav visibility** | Shown to every org member; non-owners/admins see "Only organization owners and admins can manage projects." |
| **Layout** | Divided rows (`SettingsCatalogListFrame`), no section heading — the settings shell renders the title |
| **Row content** | Line 1: name, alias badge, archived badge. Line 2: `created by {name}, {n} days ago`. **No member count** — it would cost one membership read per row |
| **Search** | Matches project name or alias |
| **Create** | "New project" button in the toolbar; in the empty state, "Create project" inside it. Opens the shared `ProjectDialog`, gated on `project:create` |
| **Open** | A row navigates to `/o/{slug}/settings/projects/{projectId}`. Rows do not expand |
| **Row actions** | Trailing `⋯` menu: Manage (same as clicking the row) and Delete, the latter gated on `project:delete` with a confirm dialog |
| **Payload** | Metadata only; no task, list, or thread data (see [permissions-system.md](permissions-system.md)) |

#### Project edit subpage

`/o/{organizationSlug}/settings/projects/{projectId}` is a nested settings
**edit** page built from the same primitives as the prompt and agent editors:
`SettingsPageHeader` titled "Edit project" with a `Back to projects` link, then
`SettingsTwoColumnSection` + `SettingsFormGrid` for the form, and
`SettingsActions` for Delete / Cancel / Save.

| Section | Contents |
| --- | --- |
| **Details** | Project color + name, project key, description. Shows the resulting task-ref shape (`ABC-123`) and warns that changing the key affects existing references. Save sits at the end of the section, disabled until the form is dirty |
| **Members** | The project's own Members section (same component as project settings), full add / change-role / remove |

The page has **no Delete and no Cancel**. Delete belongs to the list row's `⋯`
menu — one destructive entry point per entity, not two. Cancel is redundant with
the `Back to projects` link already in the header. Saving stays on the page (a
toast confirms) rather than navigating away, since Members is edited here too.

Save calls `projects.core.update`, then `projects.core.updateAlias` **only when
the key actually changed** — alias updates carry their own uniqueness check and
task-reference impact, so an unchanged key must not trigger one. Both mutations
accept org-level authority (see
[permissions-system.md](permissions-system.md)), which is what lets an admin
edit a project they are not a member of.

Backed by `projects.core.getForOrganizationManagement`, which carries the same
authority and metadata-only contract as the list. It returns `null` for missing,
deleted, and unauthorized alike, so a caller without `projects:manage_all`
cannot learn whether a project exists; the page shows "Project not found".

"Add member" here means adding an existing org member to a project. Inviting a
new person to the organization by email stays in Settings → Members.

Adding a member sends the project-invitation email, including when an admin adds
themselves.

### Updating Organization

#### Permission Requirements

| Actor Role | Can Update |
| ---------- | ---------- |
| Owner      | Yes        |
| Admin      | Yes        |
| Member     | No         |

#### Business Rules

| Rule                    | Behavior                                        |
| ----------------------- | ----------------------------------------------- |
| **Permission required** | `ORG_UPDATE` (Owner or Admin)                   |
| **Name validation**     | Minimum 2 characters, whitespace trimmed        |
| **Slug validation**     | Lowercase alphanumeric + hyphens, 2-50 chars    |
| **Slug format**         | Cannot start or end with hyphen                 |
| **Slug uniqueness**     | Must be unique across non-deleted organizations |
| **Same slug allowed**   | No error when updating to current slug          |
| **Deleted org**         | Cannot update deleted organizations             |

#### Slug Format Rules

```
Valid:   my-org, myorg, my-org-123, a1
Invalid: -myorg, myorg-, my--org, MY-ORG (uppercase), my_org (underscore)
```

---

## Cascade Effects

When a member is removed or leaves an organization, the following cascades occur:

| Event                   | Cascade Effect                                     |
| ----------------------- | -------------------------------------------------- |
| Member removed from org | Removed from all projects in org                   |
| Member leaves org       | Removed from all projects in org                   |
| Organization deleted    | All memberships deleted (not covered in this spec) |

---

## API Reference

Organization modules live under `convex/organizations/` (`core.ts`, `members.ts`, `invitations.ts`) with domain-private helpers in `convex/organizations/lib/`. Transitional: the root modules `convex/organizations.ts`, `organizationMembers.ts`, `organizationInvitations.ts`, and `organizationsInternal.ts` are temporary re-export shims that keep the legacy API paths (old long function names included) working for stale browser bundles; remove them one deploy cycle after the rename ships.

### Invitations

| Function                                | Type     | Description                      |
| --------------------------------------- | -------- | -------------------------------- |
| `organizations.invitations.create`      | Mutation | Create invitation and send email |
| `organizations.invitations.accept`      | Mutation | Accept invitation via token      |
| `organizations.invitations.revoke`      | Mutation | Cancel pending invitation        |
| `organizations.invitations.resend`      | Mutation | Resend email, extend expiration  |
| `organizations.invitations.listPending` | Query    | List pending invitations for org |
| `organizations.invitations.getByToken`  | Query    | Get invitation access state by token; only matching authenticated invitees receive invitation details |

### Organization Members

| Function                           | Type     | Description                    |
| ---------------------------------- | -------- | ------------------------------ |
| `organizations.members.list`       | Query    | List members with user details |
| `organizations.members.updateRole` | Mutation | Change member's role           |
| `organizations.members.remove`     | Mutation | Remove member from org         |
| `organizations.members.leave`      | Mutation | Self-removal from org          |
| `organizations.members.getMyRole`  | Query    | Get current user's role        |

### Organizations

| Function                                      | Type           | Description                                                     |
| --------------------------------------------- | -------------- | --------------------------------------------------------------- |
| `organizations.core.listForUser`              | Query          | List user's organizations with roles                            |
| `organizations.core.getById`                  | Query          | Get org by ID (member-only)                                     |
| `organizations.core.getBySlug`                | Query          | Get org by slug (member-only, API-key aware)                    |
| `organizations.core.create`                   | Mutation       | Create org, creator becomes owner                               |
| `organizations.core.update`                   | Mutation       | Update org name, slug, or avatar                                |
| `organizations.core.checkSlugAvailability`    | Query          | Check if slug is available                                      |
| `internal.organizations.core.getByIdInternal` | Internal query | Get active org by ID without member check (server-side callers) |

---

## Error Messages

### Invitations

| Scenario                     | Error Message                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------ |
| User already member          | "User is already a member of this organization"                                |
| Duplicate pending invitation | "An invitation is already pending for this email"                              |
| Invalid token                | "Invalid invitation link"                                                      |
| Already accepted             | "This invitation has already been accepted"                                    |
| Revoked                      | "This invitation has been revoked"                                             |
| Expired                      | "This invitation has expired"                                                  |
| Wrong account                | "This invitation is not available for this account"                            |
| Only resend pending          | "Can only resend pending invitations"                                          |
| Only revoke pending          | "Can only revoke pending invitations"                                          |

### Member Management

| Scenario                  | Error Message                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Not a member              | "User is not a member of this organization"                                                               |
| Self-removal              | "Cannot remove yourself. Use 'Leave organization' instead."                                               |
| Admin removing owner      | "Only owners can remove other owners"                                                                     |
| Admin changing owner role | "Only owners can change another owner's role"                                                             |
| Admin promoting to owner  | "Only owners can promote to owner"                                                                        |
| Only owner demoting self  | "Cannot demote yourself as the only owner. Transfer ownership first."                                     |
| Only owner leaving        | "Cannot leave as the only owner. Transfer ownership to another member first, or delete the organization." |

### Organization Settings

| Scenario                            | Error Message                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Org not found                       | "Organization not found"                                                                                |
| Org deleted                         | "Organization has been deleted"                                                                         |
| Name too short                      | "Organization name must be at least 2 characters"                                                       |
| Invalid slug format                 | "Slug must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen" |
| Slug length outside 2-50 characters | "Slug must be between 2 and 50 characters"                                                              |
| Slug taken                          | "This URL is already taken"                                                                             |

---

## Data Model

### Organization Invitations Table

```typescript
organizationInvitations: {
  organizationId: Id<"organizations">;
  email: string; // Normalized (lowercase, trimmed)
  role: "admin" | "member";
  token: string; // UUID for magic link
  expiresAt: number; // Timestamp (7 days from creation)
  invitedBy: Id<"users">;
  createdAt: number;
  status: "pending" | "accepted" | "expired" | "revoked";
}
```

### Organization Members Table

```typescript
organizationMembers: {
  organizationId: Id<"organizations">;
  userId: Id<"users">;
  role: "owner" | "admin" | "member";
  joinedAt: number;
}
```

---

## Test Scenarios

### Invitation Tests

- [ ] Owner can invite new member
- [ ] Admin can invite new member
- [ ] Member cannot invite
- [ ] Cannot invite existing member
- [ ] Cannot create duplicate pending invitation
- [ ] User can accept valid invitation
- [ ] Acceptance fails with wrong email
- [ ] Acceptance fails with expired invitation
- [ ] Acceptance fails with revoked invitation
- [ ] Resending extends expiration
- [ ] Cannot resend non-pending invitation
- [ ] Revoking invalidates invitation
- [ ] Cannot revoke non-pending invitation
- [ ] Invitation email preview is available in `/playground/emails`

### Role Management Tests

- [ ] Owner can change any member's role
- [ ] Owner can promote member to owner
- [ ] Admin can change member to admin
- [ ] Admin cannot change owner's role
- [ ] Admin cannot promote to owner
- [ ] Member cannot change any roles
- [ ] Owner can demote self if other owner exists
- [ ] Owner cannot demote self if only owner

### Member Removal Tests

- [ ] Owner can remove any member
- [ ] Admin can remove member
- [ ] Admin cannot remove owner
- [ ] Member cannot remove anyone
- [ ] Cannot remove self (must use leave)
- [ ] Removal cascades to project memberships

### Leave Organization Tests

- [ ] Member can leave
- [ ] Admin can leave
- [ ] Owner can leave if other owner exists
- [ ] Owner cannot leave if only owner
- [ ] Leaving cascades to project memberships

### Organization Settings Tests

- [ ] Owner can update organization name
- [ ] Admin can update organization name
- [ ] Member cannot update organization
- [ ] Name must be at least 2 characters
- [ ] Name whitespace is trimmed
- [ ] Slug must be lowercase alphanumeric with hyphens
- [ ] Slug cannot start or end with hyphen
- [ ] Slug must be 2-50 characters
- [ ] Slug must be unique
- [ ] Same slug allowed (no-op)
- [ ] Cannot update deleted organization
- [ ] Avatar URL can be set
- [ ] updatedAt timestamp is updated

---

## Implementation Notes

- All mutations require authentication
- Email addresses are normalized before comparison
- Invitation tokens are UUIDs generated via `crypto.randomUUID()`
- Expiration is set to 7 days (604,800,000 milliseconds)
- Permission checks use the `requireOrgPermission` utility
- Organization owners and admins can manage organization Agent templates through
  `OrgPermission.AGENTS_MANAGE`; basic organization members cannot.
- Cascade deletions are performed synchronously within the same mutation
