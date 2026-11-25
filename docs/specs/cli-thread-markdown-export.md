# CLI Thread Markdown Export Specification (OS-1749)

Exporting a thread's conversation as a Markdown file, entirely client-side.

## Scope

- `apps/web/lib/threads/markdown-export.ts` — the document builder (pure).
- `apps/web/lib/threads/hooks/use-thread-markdown-export.ts` — drains history,
  drives the toast, hands the file to the browser.
- The **Export to Markdown** action in `ThreadActionMenuItems`
  (`thread-list-item.tsx`), rendered only where a handler is passed:
  `thread-workspace.tsx`, which owns the transcript.

## Trigger

- The action sits in the thread actions menu, so the thread header `...`, the
  mobile header menu and the thread tab's right-click menu all offer it from
  one prop (`cli-thread-header.md`).
- Thread-list rows do **not** offer it: the transcript only exists in the
  client for the open thread, and exporting from a row would mean a second,
  unpaginated read path for the whole thread.
- A viewer of a shared thread has no actions menu at all
  (`cli-thread-sharing.md`), so they cannot export. Nothing about the export
  writes; it is withheld only because the menu is.

## Progress and history loading

Message history is paginated (`cli-thread-message-pagination.md`), so the
export first drains what pagination can reach:

- While older chunks are fetchable, the export calls `loadOlderChunks()` once
  per settled round and shows the shared progress toast
  (`lib/batch-progress-toast.tsx`) with loaded/total messages of the envelope
  window. The user does not have to click "Show more" first.
- The visible-slice budget is irrelevant here: the export reads every **loaded**
  message, not the rows currently rendered.
- **Inactivity guard:** if no chunk arrives for `EXPORT_STALL_MS`, the export
  finishes with what it has rather than spinning forever. `hasOlderChunks` is
  reported by the backend and can outlive a usable cursor, in which case
  `loadOlderChunks()` is a no-op and no further state change would ever arrive.
- History older than the envelope window is unreachable by design
  (`hasOlderEnvelopes`, OS-1600). The export cannot include it and says so in
  the document instead of pretending the thread starts there.
- The done toast reports the exported message count.

### Forks

A fork's own rows start at the copied run; everything before it lives in its
ancestors (`cli-thread-fork.md`, Earlier parent messages). After the drain, the
export reads that history to the end with `readWholeForkPrefix`, the walk the
handoff uses (`cli-thread-handoff.md`, Forks), and puts it before the fork's
own rows. A page that stops making progress, or an ancestor that is gone, adds
the "outside the loaded window" note. While `forkedFrom.copiesInFlight > 0`
the menu leaves the entry out.

## Document format

Turn boundaries are **not** headings. A message body is Markdown the agent
wrote, so it carries its own `#` headings; a `##` turn header would be outranked
by them and the document outline would read as if the transcript were nested
inside a message. `---` plus a bold author line is unambiguous at any body depth
and needs no rewriting of the body.

```md
# Make the thread content printable

`OS-1748` · Claude Code · 24 messages · exported 2026-08-14 15:31 UTC

> Earlier messages are outside the loaded window and were not exported.

---

**You** · 2026-08-14 15:30

now i want the new button "Export to Markdown" …

Attachments: `screenshot.png` (214 KB)

---

**Claude Code** · 2026-08-14 15:31

Committed on `main` as `adfa1f173` …
```

- The metadata line carries only what is thread-wide: task ref (when the thread
  has one), CLI label, exported message count, export time.
- The `>` note appears only when `hasOlderEnvelopes` is true or a fork's
  ancestor walk ended early (see Forks).
- Author is `You`, `Another agent` (a message another thread's agent sent —
  `sentBy`, OS-1631), `GitHub` (a Pull request watch's message), or the CLI
  label for an assistant turn.
- Timestamps are UTC in `YYYY-MM-DD HH:mm` form. Local time would be friendlier
  but makes the document depend on the exporting machine's zone.
- Body text is the message's text parts, joined with a blank line, verbatim — it
  is already Markdown. **Tool calls, reasoning, run-diff cards, plan cards and
  interaction cards are excluded**: the export is the conversation, not the
  trace.
- A failed assistant turn renders its error as `_Run failed: <message>_`, so a
  turn that produced no text is not silently missing.
- A turn with no text, no attachments and no error is dropped (tool-only
  assistant turns, chunkless user envelopes).
- Steered user messages export as their own turn in timestamp order. On screen
  they are drawn inside the assistant stream at their injection point
  (`cli-steering.md`); a linear document has no such place to put them.

## File

- `thread-<title-slug>-<YYYY-MM-DD>.md`, slug from the thread title (`thread`
  when the title is empty), date from the export time.
- Handed to the browser through the existing `downloadArtifact` helper, so the
  save behavior is whatever the browser is configured to do — no custom picker.
  A failed hand-off shows an error toast.

## Non-goals

- No server-side export, no export of the trace (tools/reasoning), no PDF, no
  round-trip import. Printing covers the "looks like the app" output
  (`cli-thread-print.md`).
- No export from thread-list rows or the mini preview.

Related specs: `cli-thread-fork.md`, `cli-thread-handoff.md`, `cli-thread-header.md`, `cli-thread-message-pagination.md`,
`cli-thread-print.md`, `cli-thread-sharing.md`, `cli-steering.md`.
