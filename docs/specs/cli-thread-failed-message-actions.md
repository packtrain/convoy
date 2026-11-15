# CLI Thread Failed Message Actions Specification

This document defines the inline actions shown for failed assistant messages in thread detail.

## Scope

- `apps/web/components/blocks/thread/workspace/thread-workspace.tsx`
- Failed assistant messages rendered in thread detail

## Failure Card

The failure and its actions share one framed row, not a loose line of text. It
is the shared `DangerCallout` (`components/custom/danger-callout.tsx`), the same
surface as the app-refresh banner — no thread-local red styling.

- The error text splits on the first newline: line one is the callout title, the
  remainder is the description (line breaks preserved). Empty error text falls
  back to `Message failed`.
- `Retry` is the primary action (`DANGER_CALLOUT_ACTION_CLASS`); `Continue` sits
  beside it as a plain outline button.

## Continue Behavior

- Failed `claude-code` assistant messages render a `Continue` button.
- Clicking `Continue` sends a normal new user message with content:
  - `continue`
- The follow-up message uses the active thread mode and active CLI model selection.
- Failed-message actions are only shown on the latest thread message.
- Once `Continue` is clicked, failed-message actions hide immediately and stay
  hidden after the follow-up message appears.
- Resume routing remains backend-owned:
  - the new user message is processed normally
  - CLI continuation lookup must prefer the newest assistant continuation, including failed turns

## Retry Behavior

- Failed assistant messages render a `Retry` button.
- Clicking `Retry` must not immediately call `cliMessages.retry`.
- A destructive confirmation dialog must open first.
- The confirmation copy must make clear that retry:
  - removes the failed assistant output from the thread
  - reruns the original messages from scratch
- Confirming the dialog calls `cliMessages.retry`.
- Cancelling the dialog performs no mutation.
- If retry fails, show the error toast and keep the dialog open so the user can
  retry again or cancel.

## Read-only viewers

Both handlers are optional on `ThreadMessageList`. A read-only viewer of a
shared thread (`cli-thread-sharing.md`) is passed neither, so no `Continue` and
no `Retry` render — but the failed message's **error text still shows**. A
viewer must be able to see that the run failed; they just can't act on it.

## Non-Goals

- No new backend resume mutation.
- No failed-message branching workflow. (Partially superseded by OS-1374:
  editing the last user message rewinds the failed turn and forks from the
  previous continuation — see `docs/specs/cli-thread-edit-last-message.md`.)
- No change to assistant overflow actions such as `Continue locally from here`.
