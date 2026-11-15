# CLI Thread Assistant Message Actions Specification

This document defines the footer actions rendered under assistant messages in the thread detail view.

## Scope

- `apps/web/components/blocks/thread/assistant-cli-thread-message.tsx`
- Assistant messages in `/threads/[threadId]`

## Copy Response

- A finished reply with prose shows a `Copy response` icon button in the footer,
  before the overflow trigger (OS-2256).
- It copies the reply's text parts joined by a blank line, the prose the
  Markdown export reads (`cli-thread-markdown-export.md`). Reasoning and tool
  parts are left out.
- No button while the reply streams, or when it has no text parts.
- Success toasts `Response copied`. A missing Clipboard API or a failed write
  toasts an error.

## Branch Icon

- A forkable reply shows a `Branch from here` icon button after `Copy response`.
  It does what the menu's `In a new thread` does, under the same gate (Branch
  Behavior), and is hidden when that gate is closed.

## Overflow Trigger

- Assistant message secondary actions are exposed through a `MoreHorizontal` icon trigger in the footer row next to run details.
- The trigger must have an accessible label of `Message actions`.
- The previous standalone `Raw JSON` footer trigger is replaced by this overflow entry point.

## Menu Items

- The menu renders these entries in order:
  - `Raw data`
  - `Continue locally from here`
  - `Branch from here`, a submenu: `In a new thread`, `In a new tab`
  - `Handoff from here`, a submenu: `In a new thread` and `In a new tab` (`cli-thread-handoff.md`)
- Each item includes a leading icon.
- Menu items remain single-line; labels must not wrap in the dropdown.

## Raw Data Behavior

- `Raw data` opens the existing raw JSON dialog for that assistant message.
- The dialog contents remain:
  - `Composer parts`
  - `Normalized events`
- Raw JSON payload generation stays lazy and only resolves when the dialog opens.

## Continue Locally Behavior

- `Continue locally from here` is message-scoped, not thread-scoped.
- The command must use the selected assistant message’s `cliContext.continuationId`.
- Command construction uses the existing CLI-specific resume command builder.
- For `claude-code`, the copied command format is `claude --resume <continuationId>`.
- The action is disabled when:
  - the assistant message has no `cliContext.continuationId`, or
  - the CLI type has no supported local resume command.
- Successful copy shows the existing success toast: `Command copied to clipboard`.

## Branch Behavior

- `In a new thread` calls `cli.threads.core.fork` with the assistant message id and
  navigates to the new thread. Rules and the copied shape: `cli-thread-fork.md`.
- `In a new tab` makes the same call with `groupWithThreadId` set to the viewed
  thread, so the fork opens as a tab beside it (`cli-thread-fork.md`, In a new tab).
  It is disabled when the group is at its cap or the host is not the thread
  workspace.
- The submenu trigger is enabled only when the run is forkable for its runtime (`claude-code`; `codex`
  once the reply recorded `cliContext.turnId`, OS-2073), the message is finished
  (not `streaming`) with a `cliContext.continuationId`, and the viewer can write
  to the thread. A stopped reply with a session qualifies; a failed reply without one
  does not. Hidden on a fork while its copy is still landing
  (`forkedFrom.copiesInFlight > 0`, `cli-thread-fork.md`).
- A rejected fork shows the mutation's error text as a toast.

## Handoff Behavior

- `In a new thread` seeds a new-thread composer with the conversation through this
  reply's run as an attached Markdown file. `In a new tab` seeds the group's draft
  tab the same way and is disabled where "+" is (a group at its cap, a
  container). Rules, size cap and enablement: `cli-thread-handoff.md`.

## Non-Goals

- No changes to thread list item action menus.
