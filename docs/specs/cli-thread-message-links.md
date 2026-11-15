# Task and artifact links in messages

OS-2149. Agents mention tasks and artifacts as plain markdown links. Convoy
renders those links as preview blocks and chips that open in the app, with no
"Open external link?" prompt.

## Link format

The href is a real task URL, so the link still works when copied anywhere
else. The markdown link title carries a snapshot of the task:

```md
[Add board rows](https://app.convoy.build/o/acme/WEB?task=WEB-12 "type=feature; status=In Review")
[Implementation plan](https://app.convoy.build/o/acme/WEB?task=WEB-12&artifact=<artifactId> "type=md")
```

- A task link is `/o/:org/:alias?task=<REF>` (optionally with `/kanban` and
  other query params). An `artifact` param makes it an artifact link.
- The title is `key=value` pairs split by `;`. Tasks use `type` (a task type
  key) and `status` (a task status). Artifacts use `type`, either `md` or
  `html`. Unknown keys and values are ignored.
- The link text is the task title or artifact name. It renders as plain text:
  inline markdown is not styled, and inline code keeps its backticks so the
  name matches the stored title (OS-2269).

## Snapshot, not live

The preview shows what the agent wrote and never queries Convex. A task whose
status changed after the reply still shows the old status. This keeps message
rendering free of per-link reads. To see the current state, open the task.

## Which links qualify

- The URL must be on the app origin (`NEXT_PUBLIC_APP_URL`) or be a relative
  `/o/...` path. Links to other origins keep the confirm dialog.
- A link that qualifies but has no title still renders as a preview, using
  only what the URL and link text give: the ref, plus the name when the text
  is not the bare URL or ref.
- While a reply streams, Streamdown marks an unfinished link with the
  `streamdown:incomplete-link` href. It renders as a plain link until the URL
  is complete.

## Layout

- A link that is a whole paragraph renders as a block.
  A task block shows the type glyph, ref, title, and status icon with its
  label. An artifact block shows the file icon, name, `md`/`html` badge, and
  the task ref.
- A list where every item is a lone task or artifact link renders as one
  bordered table with a divider between rows. Separate paragraphs are not
  merged. In a list where any item has other text, every item keeps its
  bullet and its links render as chips.
- A link inside a sentence renders as a compact chip. A task chip shows the
  glyph, ref, title, and a status icon (label for screen readers). An artifact
  chip shows the file icon, name, and badge.

## Navigation

- A plain left click on a task link to the current project opens the task in
  the host's sidebar (`onOpenTaskRef`, OS-1686). An artifact link opens the
  artifact the same way (`onOpenArtifact`).
- Without a host handler, or for a link to another project, the click navigates
  in the app to the URL.
- ⌘/ctrl-click, middle click, and "copy link address" behave as on any link.

## Teaching agents the format

When the MCP endpoint is scoped with `?project=org-slug/ALIAS`, the
`initialize` instructions describe the format with that project's URL prefix
(see [mcp-server.md](mcp-server.md#scoped-status-metadata)). Raw project-id
scoping skips the link instructions, since building the prefix would need
extra lookups.

Messages render the same way wherever `MessageResponse` is used, including
user messages and task comments.
