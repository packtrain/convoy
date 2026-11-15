# User Button Email Display

The sidebar user button identifies the signed-in account without exposing the email address in the persistent sidebar trigger.

## Behavior

- The user button trigger displays the signed-in user's avatar and name only.
- The trigger must not render the user's primary email.
- The trigger uses the compact default sidebar menu button size, not the large two-line layout.
- The trigger avatar is smaller than the dropdown account avatar.
- The account dropdown label displays the signed-in user's avatar, name, and full primary email.
- If no primary email is available, the dropdown email line remains empty.

## Non-Goals

- This does not change the editable user settings email field.
- This does not change organization or project member management screens, where explicit email review is required.
- This does not change backend-stored user email values.
- This does not mask the email in the account dropdown.

## Acceptance Checks

- Rendering the sidebar user trigger with `robin@example.com` does not expose `robin@example.com` in the trigger.
- The trigger button uses the compact default sidebar button size.
- The trigger avatar uses the smaller compact avatar size.
- The dropdown account label renders `robin@example.com`.
- Existing Settings and Log out menu actions continue to render.
