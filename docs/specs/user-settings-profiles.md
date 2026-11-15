# User Settings Profiles Specification

This document defines the Profiles section in user settings and the
cross-project query that powers it.

## Query and Ownership

- `api.cli.profiles.listForUser` takes no user or project argument; it derives
  the authenticated user and returns all of that user's non-deleted CLI
  profiles across projects.
- The query is index-backed by user and soft-delete state. It fetches recent
  user sessions once and selects the freshest live session per profile.
- Live session runtime data wins over the profile's last-known snapshot.
- Project and organization metadata is returned only when the user still has
  view access. Profiles whose project was deleted or became inaccessible are
  retained with no project/organization metadata so the owner can remove them.
- Archived projects remain visible and are marked archived.
- The query returns all profiles without pagination because this settings
  surface is the canonical complete inventory for one user.

## Settings Navigation and Grouping

- User settings contains an enabled `CLI profiles` section after `Agents`.
- Profiles are grouped organization first, then project. Groups and profiles
  are sorted by display name in the client.
- Profiles without accessible project metadata appear in an `Unavailable
  project` group.
- Loading renders skeleton rows. An empty state explains that profiles appear
  after connecting the Convoy CLI; profiles cannot be created in the web app.

## Profile Rows

- Each collapsed row shows the status dot inline with the profile name, followed by a
  deliberately minimal subheader containing only the machine name and either
  `Connected … ago` or `Last seen … ago`.
- Available or last-detected agent runtimes and working directory/worktree
  details appear only in the expanded details area.
- Full paths are available from an inline expandable details area. Hostname,
  profile key, paths, and runtime detection are read-only because the CLI owns
  those values.
- The row options menu contains `Rename` and `Delete`. Rename and delete use
  the same mutations and dialogs as the thread working-directory selector.
- Deleting a profile requires destructive confirmation and removes it from
  active settings and selector queries without altering existing threads.

## Related Specs

- Thread selector hover card and actions:
  `docs/specs/cli-thread-context-selectors.md`
- Profile onboarding behavior: `docs/specs/cli-no-profiles-onboarding.md`
