# Protected Link Previews

## Scope

Defines how protected Convoy app URLs behave when external systems fetch them
to generate link previews.

## Expected Behavior

- Known link-preview crawlers requesting protected app routes receive a generic
  Convoy HTML preview with status `200`.
- Generic preview metadata includes only the product name and app description.
- Generic preview metadata must not include organization, project, task, thread,
  user, or attachment data.
- Browser requests and unrecognized user agents still use the normal Clerk
  protection flow.
- Public auth routes remain public and are not replaced by the generic preview
  response.

## Regression Case

When Slack unfurls a protected app link, the preview should show generic
Convoy information instead of `404: This page could not be found.`
