# Task, artifact, and pull request links in messages

OS-2149, OS-2604. Agents mention tasks, artifacts, and pull requests as plain
markdown links. Convoy renders those links as preview blocks and chips that
open in the app, with no "Open external link?" prompt.

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
- A pull request link is the PR reader URL,
  `/o/:org/:alias/pull-requests?repo=<owner/name>&pr=<number>`. `repo` is the
  GitHub `owner/name` (any case) or the repository ID the reader itself uses.
  The title holds `state`: `open`, `draft`, `merged`, or `closed`. The PR page
  resolves `owner/name` against the project's connections, which it already
  loads, so the format costs no extra read. A name that matches no connection
  shows the reader's no-access state.

  ```md
  [Add PR previews](https://app.convoy.build/o/acme/WEB/pull-requests?repo=contoso%2Fconvoy&pr=8 "state=open")
  ```

- The link text is the task title, artifact name, or PR title. It renders as plain text:
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
  only what the URL and link text give: the ref (`#8` for a PR), plus the
  name when the text is not the bare URL or ref.
- A bare `https://github.com/<owner>/<repo>/pull/<n>` link is not a preview.
  Recognizing it would need the organization's connected repositories on
  every message view; agents are taught the Convoy URL instead.
- While a reply streams, Streamdown marks an unfinished link with the
  `streamdown:incomplete-link` href. It renders as a plain link until the URL
  is complete.

## Layout

- A link that is a whole paragraph renders as a block.
  A task block shows the type glyph, ref, title, and status icon with its
  label. An artifact block shows the file icon, name, `md`/`html` badge, and
  the task ref. A PR block shows the state icon (a plain PR icon without a
  state), `#number`, title, and state label.
- A list where every item is a lone task, artifact, or PR link renders as one
  bordered table with a divider between rows. Separate paragraphs are not
  merged. In a list where any item has other text, every item keeps its
  bullet and its links render as chips.
- A link inside a sentence renders as a compact chip. A task chip shows the
  glyph, ref, title, and a status icon (label for screen readers). An artifact
  chip shows the file icon, name, and badge. A PR chip shows the state icon
  (label for screen readers), `#number`, and title.

## Navigation

- A plain left click on a task link to the current project opens the task in
  the host's sidebar (`onOpenTaskRef`, OS-1686). An artifact link opens the
  artifact the same way (`onOpenArtifact`).
- Without a host handler, or for a link to another project, the click navigates
  in the app to the URL.
- A left click on a PR link navigates in the app to the PR reader. There is
  no in-place handler.
- ⌘/ctrl-click, middle click, and "copy link address" behave as on any link.

## Teaching agents the format

When the MCP endpoint is scoped with `?project=org-slug/ALIAS`, the
`initialize` instructions describe the format with that project's URL prefix
(see [mcp-server.md](mcp-server.md#scoped-status-metadata)). Raw project-id
scoping skips the link instructions, since building the prefix would need
extra lookups. The instructions include the PR format with an
`OWNER%2FREPO` placeholder.

Agents can also get a PR's link from Convoy: `convoy threads attach-pr` prints
it, and `attach_pull_request_to_thread` returns it as `pullRequestReaderUrl`.
Both come from `api.cli.threads.core.attachPullRequest`, which returns `{ url }`.
The Convoy skill tells agents to link PRs this way.

Messages render the same way wherever `MessageResponse` is used, including
user messages and task comments.
