# CLI Thread Tool Parts Specification

This document defines the rendering rules for specialized tool-call parts inside assistant messages on thread detail pages.

## Overview

- Assistant messages may contain `dynamic-tool` parts.
- Known tool families render through dedicated components instead of the generic raw-JSON fallback.
- Tool-part accordions must never expand to an empty body for successful, recognized payloads.
- A `reasoning` part renders through the shared tool row (`CollapsibleToolPart`) with no leading icon. Blank text (redacted thinking, e.g. Claude models that omit thinking display) is a plain row with no chevron and no pointer cursor. Reasoning with text keeps its collapsed accordion.
- Parent sub-agent tools named `Task` or `Agent` must not render as detached generic tool rows when a grouped lifecycle card exists for the same `tool_use_id`.
- Child tool calls associated to a grouped sub-agent via `parentToolUseId` render inside that grouped card, preserving their stream order within the card instead of appearing as separate top-level timeline items.
- **Every tool row's leading icon carries the call state** (OS-1769), whatever the family: the tool's own icon once output is available, the shared spinner while the call is in flight, and a destructive-colored alert icon on failure whose **tooltip is the error message**. Neither state gets a body of its own — a box repeating "Waiting for result…" or the error text under a row that already shows both is noise — so a pending or failed call with nothing else to disclose is a plain, non-expandable row. Bodies that carry more than the state survive it: a terminal transcript, an attempted diff (`replace_in_task_artifact`, Codex apply-changes), the MCP Input section.
- Once an assistant message settles (`completed`/`failed`, which includes a user stop), tool calls that never received a result render as interrupted (`Interrupted` error text) instead of keeping their pending spinner (OS-1435). Interactive tools whose prompt UI is keyed to `output-error` (`AskUserQuestion`, `ExitPlanMode`) are exempt, so a stopped run never re-opens a live prompt.

## Shared Row Shell (OS-2256)

- Every expandable tool row uses `CollapsibleToolPart`, including Sleep
  (`codex-sleep.md`) and Reasoning. Its chevron shows on row hover or focus and
  stays visible, rotated, while the row is open. A row with no body has no
  chevron.
- The generic fallback for an unrecognized `dynamic-tool` shows labeled Input
  and Output sections, like the generic MCP chrome. Output shows only once it
  is available. `toolCallId` and `state` are not part of the body.
- Terminal transcripts (stdout, then stderr) and fallback Input and Output
  sections cap at 40 lines with a `Show all N lines` control.
- The terminal block uses theme tokens (`bg-muted/50`, `text-foreground`), so
  it follows light and dark mode.
- The debug action that copies the raw tool call JSON renders only under the
  `Threads: Tool call debug` developer setting
  (`user-settings-developer-section.md#tool-call-debug`).
- Tool approval cards and MCP elicitation cards show their input previews on
  the shared tool surface and use the same header row as the other
  interaction cards.

## Tool Groups

Consecutive tool calls inside one assistant message collapse into a single
accordion once they are done (OS-1440).

- **Membership.** A group is a maximal run of `dynamic-tool` parts. `reasoning`
  parts join a run already in progress — between tool calls and after the last
  one — and render in stream order inside the group (runtimes interleave
  thinking with tool calls, which would otherwise split every run). Reasoning
  that precedes a run's first tool call stays outside it. Assistant `text`
  parts, runtime notices, grouped sub-agent cards, the interactive tools
  (`AskUserQuestion`, `ExitPlanMode`), and **failed calls** (`output-error`,
  which includes the `Interrupted` calls OS-1435 settles) are never grouped and
  split the run around them — a failure folded into a neutral
  `Worked for …` row would need expanding to be noticed at all.
- **Threshold.** A run needs at least 2 tool calls to become a group; a lone
  tool call renders as its own row. A run of reasoning parts alone is never a
  group.
- **Live groups** render their parts individually, unwrapped, so an in-flight
  run stays watchable. A group is live while it is the trailing item of a
  streaming message, or while any of its tool calls has no result yet.
- **Finished groups** render one collapsible row, collapsed by default and
  re-collapsible, titled `Worked for <duration>` and nothing else — no
  tool-call count. Expanding renders every part of the group (no truncation, no
  secondary overflow row); parts stay unmounted while collapsed.
- **Duration** is the span from the group's first `tool-input` chunk to its last
  `tool-output`/`tool-error` chunk, derived client-side from
  `cliMessageChunks.timestamp` — there is no stored per-tool duration field.
  That timestamp is the agent's own emit time when the CLI sends one
  (stamped as the chunk enters the outgoing flush buffer, so batching does not
  skew it); the server falls back to its append time for chunks written before
  the field existed, for older CLIs, and for stamps more than an hour off the
  server clock. `createdAt` always stays on the server clock — it is the read
  cursor and index sort key. Formatting: `Worked for 12s`,
  `Worked for 1m 23s`, whole minutes and hours drop the trailing unit
  (`Worked for 2m`, `Worked for 1h`), and any non-zero span reads as at
  least `1s`.
- When the span cannot be derived (legacy chunks with no `toolCallId`, or a call
  with no result), the title falls back to `N tool calls` instead of showing a
  zero duration.

## Plan Tool (`ExitPlanMode`)

- Renders as a dedicated `Plan` panel in the thread — rendered markdown, with
  focus-mode / download / copy / raw-markdown toolbar actions — in **every**
  state that carries a non-empty `input.plan`, not only `output-error`
  (OS-1458). Streaming runtimes gate the plan through an approval request while
  the call is still `input-available`, which previously fell through to the raw
  JSON fallback.
- The panel's footer is the **single decision surface** for a plan: `Approve &
  continue in <mode label>` (primary, → `auto`) / `Approve, ask per tool`,
  with `Approve & continue in Act` in the primary button's dropdown.
  Keeping planning has no button — the user types their feedback instead
  (OS-1461). There is no separate approval card near the composer and no legacy
  `Execute plan` button. Approve options are filtered to the modes the runtime
  supports, so OpenCode uses Ask as primary with Act in the dropdown. Decisions and mode
  effects: `docs/specs/cli-interactive-approvals.md`.
- The footer renders on the last assistant message when a live plan request,
  orphaned Claude gate, or ready native proposal exists. A completed answer
  alone does not qualify. Applying the decision removes the controls and
  keeps the plan as history.

## File Change Tools

- `Read`, `Write`, and `Edit` are file-change tools.
- File-change tools render a collapsible row whose title includes the tool name and target filename.
- `Read` output is rendered with line numbers supplied by the viewer's gutter, so
  the agent's own line-number prefixes are stripped from plain-string output.
  Both prefix forms are recognized: the legacy `   12→` and the compact `12⇥`
  (tab) form Claude Code emits today. Leaving either in place shows the number
  twice, once in the gutter and once in the code text.
- Prefixes are stripped only when the numbered lines form one contiguous,
  strictly incrementing run. A file whose real first column is numeric (e.g. a
  TSV) keeps its content verbatim. Unnumbered lines surrounding the run — such
  as the `<system-reminder>` blocks Claude wraps around file contents — are
  preserved.

## Apply Changes Tool (Codex)

- Codex file changes surface as a `dynamic-tool` part named `Apply changes` whose input/output carries `changes: [{ path, kind, diff }]`.
- `kind` may be a plain string (app-server events) or an object `{ type, move_path }` (exec events); both forms are recognized.
- The part renders a collapsible row titled `Apply changes to <filename>` for a single file, or `Apply changes to <N> files` for multiple.
- Completed rows include the compact `+N -N` line-change summary derived from the diffs.
- The expanded body renders each change's diff through the standard unified diff component; hunk-only diffs get synthesized `---`/`+++` file headers (using `move_path` for the new-file side when present).
- `add`/`delete` diffs arrive as raw file content with no hunk markers; the UI synthesizes a whole-file hunk (all lines `+` for add, all `-` for delete) so the body is never empty and line counts stay accurate.
- With multiple files, each diff is preceded by a header showing the file path (and `old → new` for moves).
- Failed/declined calls keep the diffs from the tool input visible, so the attempted changes stay readable; the error message is on the row.

## Search Tools

- `Grep` and `Glob` render through dedicated search tool components instead of the generic raw-JSON fallback.
- The collapsed `Grep` row uses user-facing copy: `Search "<pattern>"`, with the target filename/path appended when available.
- The collapsed `Glob` row uses user-facing copy: `Find "<pattern>"`, with the target directory appended when available.
- If `Grep` has completed, the row includes a compact result count when it can be derived from output text or structured output.
- If `Glob` has completed, the row includes a compact file count when it can be derived from output text or structured output.
- Successful `Grep` output renders as monospace search results, preserving line numbers, context separators, and file paths from the tool output.
- Successful `Glob` output renders as monospace file paths, preserving line breaks from the tool output.
- Large search outputs are capped by default with a control to reveal the full result.
- Raw input/output remains available through the debug action (developer setting), not as the primary expanded body.

## Edit Tool Fallback Rules

- Preferred edit rendering uses structured diff hunks from tool output when they are available.
- If structured diff hunks are absent, the UI must fall back to edit input data before using a generic tool renderer.
- Supported fallback input fields are:
  - `old_string` or `oldString`
  - `new_string` or `newString`
- When recognized fallback fields are available, the expanded body renders a compact replacement diff.
- Synthetic replacement diffs may use placeholder line numbers because the event does not include the replacement's actual file offset.
- Completed edit rows may include a compact `+N -N` line-change summary derived from structured hunks or fallback replacement strings. Additions render green; removals render red/destructive.
- If the edit tool output is only a plain success string and no diffable fields are available, that message renders as muted status text.
- Raw edit input/output remains available through the debug action (developer setting), not as the primary expanded body.
- A successful `Edit` tool call with recognized fallback fields must not render an empty accordion body.

## MCP Tools

### Tool-Name Parsing

- MCP tool calls arrive under runtime-specific names and are parsed client-side into `{ server, tool }` (`lib/ai-tools/mcp-tool.ts`); no server-side normalization exists.
  - Claude Code: `mcp__<server>__<tool>` (raw pass-through).
  - Codex / Cursor: `<server>.<tool>` (synthesized by those runtimes).
  - OpenCode: `<server>_<tool>` (raw pass-through). A single underscore cannot be
    split on its own, so this form is matched against the Convoy tool catalog by
    suffix — no catalog name is a suffix of another, which a test enforces.
    OpenCode MCP calls to other servers therefore stay unparsed.
- Tool names that match no format are not MCP calls and fall through to other renderers.

### Convoy Detection (two-tier gate)

- The tool name alone is NEVER sufficient to claim Convoy identity: the MCP server prefix is user-configured (`convoy`/`convoy-dev` are only conventions), and other trackers may expose identically named tools (e.g. `jira.get_task`).
- **Tier 1 (implemented):** the call is Convoy only if the parsed server name matches `/convoy/i` AND the parsed tool is in the Convoy tool catalog (`convex/mcp/tools.ts`, mirrored as a compile-checked set in `lib/ai-tools/mcp-tool.ts`). Convoy-specific parsers must still return null on input/output shape mismatch, falling back to generic MCP chrome.
- **Tier 2 (deferred):** calls whose server does not match may be upgraded to Convoy rendering only after output arrives and shape-validates on Convoy-distinctive markers (`refId`, `taskUrl`, Convex-style `_id`). While input-only/streaming they render generic — identity is upgrade-only, never walked back.

### Convoy Task Readers (`get_task`, `get_tasks`, `list_tasks`, `search_tasks`)

- Tier-1-detected Convoy reader calls render compact task rows instead of JSON: status icon (when the status string matches a known status), ref link, task name, and list name.
- Ref links point at the project task URL (`?task=<REF>`), the same URL-driven pattern used by other thread task affordances; when route params are unavailable the ref renders as plain text.
- On a thread detail page a plain left click on a ref link **opens the task in the sidebar** instead of navigating (OS-1686), via the same in-place interception the artifact links use: the `href` stays the real page URL, so ⌘/ctrl-click, middle click and "copy link address" still leave the thread. Hosts that pass no handler (the mini preview) navigate normally. Refs are opened as `active`; the sidebar hook's URL correction fixes the archive filter once an archived task resolves.
- The collapsed row echoes the input inline: `Get task OS-1250`, `Get tasks OS-1, OS-2 +1`, `Search tasks “query”`, `List tasks <status>`; multi-result readers show a task count next to the server badge once output arrives.
- Output is unwrapped defensively (JSON string inside text content blocks, Codex `item.result` wrappers). Any unexpected output shape makes the parser return null → generic MCP chrome, so raw data is never hidden.
- `get_tasks` identifiers that fail to resolve render as muted "not found" lines alongside the resolved rows.
- Collapsed by default; pending and failed reads have no rows to disclose, so they render as plain state rows.

### Convoy Task Writers (`create_task`, `update_task`, `delete_task`, `move_task`, `move_tasks_to_list`, `update_task_link`)

- Tier-1-detected Convoy writer calls render as one-line action summaries built from the tool input: `Created task OS-1300 “<name>”`, `Updated OS-1250 → In Progress`, `Moved OS-1250 to top level`, `Moved 3 tasks to <list>`, `Deleted OS-1250 (keeping subtasks)`, `Updated link on OS-1269` / `Removed link from OS-1269`. The verb is past tense once output is available, base form otherwise.
- `create_task` shows the ref from the tool output (`refId`) once available; the input alone has no ref.
- **A writer row is a destination, not a disclosure** (OS-1686). It is *not* a collapsible: the summary row is itself the task link (whole row, icon and server badge included), and clicking it opens the task in the sidebar. Rows whose ref cannot be linked (no ref yet, a raw Convex id, no project route params) render the same layout as plain text — never a dead link, and never an expander.
- **A body renders only when it carries more than the row already says**, so the common writes are a single line with nothing under them. The row is the summary; a box repeating it is noise:
  - **No body:** every write except one. `create_task` (the row already has the ref and quoted name), `delete_task`, single-task `move_task`/`move_tasks_to_list`, a status-only `update_task` (the row's detail is `→ <status>`), and — inline on the row instead of under it (OS-1769) — `update_task_link`'s link and an `update_task`'s other changed fields.
  - **Body:** a multi-task `move_tasks_to_list` alone, whose moved refs are a list (one ref row per task).
  - **No body for pending or failed writes either** — the row's state icon says it (see Overview).
- Titles use present/past text only. The multi-move body's ref rows use the shared ref-link component, which only links identifiers that match the task-ref shape (raw Convex ids render as plain text) and requires project route params. Nothing beside the row repeats the row's own ref.
- `update_task_link` renders the written link **inline on the summary row**, not in a box under it (OS-1769): the same kind-colored icon + label component the task detail sidebar uses (`TaskExternalLinkLabel`), so a commit reads `83f69e1 <title>` with the amber commit icon. It links out to the link's URL when it has one, and takes the row's spare width (the summary stops flexing). A link input that lacks the fields its kind requires (`sha`, `name`, or `url`) renders no link at all — the row alone.
- `update_task` changed fields render **inline after the summary**, in the row's spare width, without per-field bordered chips: status and priority use the real task badge icons (`StatusIcon`/`PriorityIcon`), the label uses the real `TaskLabelChip` without a color dot (the project label color is not fetched here); the remaining fields (type, assignee, due date, tags, rename) join into **one muted line that truncates** — the row never wraps, since a second line holding only its right half reads as broken. Description payloads never appear — only a "Description updated" note.
- Failed calls (`output-error`) keep the attempted action in the title; the error message lives in the row icon's tooltip.
- If the input lacks the fields required to build the summary (e.g. no `name` for `create_task`, no `taskId`), the parser returns null → generic MCP chrome.
- When a body renders it is never an empty box: the surface itself is omitted rather than rendered blank, and the debug action stays on the row either way.

### Convoy Artifact Tools (`create_task_artifact`, `get_task_artifact`, `update_task_artifact`, `move_task_artifact`, `delete_task_artifact`, `list_task_artifacts`, `replace_in_task_artifact`)

- Header: action + artifact name + task ref, e.g. `Created artifact “Plan” on OS-1250`. Name/ref come from the input when it has them (create, list, update rename); `get_task_artifact` takes the name from the output. Past tense once output is available.
- The task ref segment (`on OS-1711`) is a link to the task, and a plain left
  click opens it in the thread sidebar (OS-1762) — same in-place interception as
  the reader/writer ref links, so ⌘/ctrl-click and middle click still navigate.
  Refs that are not ref-shaped (raw Convex ids) and hosts without project route
  params keep the segment as plain text.
- The `artifact “name”` segment of the header links to the artifact full page (`/o/<org>/<alias>/artifacts/<id>`) when the artifact id is known — from the input for id-based tools, from the output for `create_task_artifact`. Deletes never link (the target is gone); without project route params the segment stays plain text. `list_task_artifacts` rows are links to their artifacts under the same rules.
- Markdown `content` (input for create/update, output for get) renders as markdown behind the expand — never as an escaped JSON string. `html` content renders as plain preformatted text, not injected markup.
- `replace_in_task_artifact` renders a before/after replacement diff (same synthesized-patch component as Edit fallbacks) built from `oldString`/`newString`; the diff stays visible while pending and on failure, and a soft failure (`ok: false`) shows its message above the diff.
- `list_task_artifacts` renders compact name + content-type rows with an artifact count in the header.
- `move_task_artifact` reads `Moved artifact on OS-1711` (the target task from the input). Unlike a delete it keeps the artifact link — the artifact still exists — and, like a delete, it renders no body.
- **A body renders only when it carries more than the header already says.** A `delete_task_artifact` (and any completed call with no content, diff or rows) is a plain non-clickable header row — no expander, no box saying "Artifact deleted". Pending and failed states keep a body only for the replacement diff. The debug action stays on the row either way.
- Unrecognized input/output shapes fall back to generic MCP chrome; failed calls keep the attempted action in the title.

### Generic MCP Chrome

- Any recognized MCP call without a dedicated renderer uses the generic MCP part instead of the raw-JSON fallback.
- Collapsed row: plug icon, humanized tool name (`get_task` → `Get task`), and a server badge showing the parsed server name (so `convoy` vs `convoy-dev` is always visible).
- Expanded body: labeled Input and Output sections (pretty-printed JSON). Pending and failed calls show the Input section alone — the row carries the rest.
- Raw payload remains available through the existing debug action.

## Non-Goals

- This spec does not define syntax-highlighting behavior for fallback status text.
- This spec does not define full patch reconstruction or real line-number recovery when the upstream tool omits structured diff metadata.


## Native proposed plans

Codex `proposed-plan` events render through the same plan panel as
`ExitPlanMode`, with their own turn/item identity and streaming/completed
state. They are not tool calls. The completed text replaces its draft.
Only the latest proposal on the last assistant message can show approval
controls, and only when the thread has a ready proposal awaiting input.
See [Codex runtime](cli-codex-runtime.md#proposed-plans-os-1481).
