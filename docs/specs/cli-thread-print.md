# CLI Thread Printing Specification (OS-1748)

Defines what the browser's native print command (Cmd/Ctrl+P, or Save as PDF)
produces on a surface that renders the embeddable `ThreadView`.

## Scope

- Any surface hosting `ThreadMessageList` (thread detail page, workspace split
  panes, the task agent-work mini preview).
- Print output only. No in-app print button, no print-specific route.

## Output

- The printout contains the thread transcript and nothing else: app sidebar,
  thread list, thread header, workspace sidebar, queued-message strip,
  interaction cards, composer, toasts, dialogs and overlays are all dropped.
- The transcript paginates across as many pages as it needs. The app shell's
  fixed heights and nested scrollers must not clip it to the visible viewport.
- Content inside its own scroller (diffs, tool output, wide tables, code
  blocks) prints in full rather than at its on-screen scroll offset; code
  blocks wrap instead of overflowing the page width.
- A message row does not split across a page break when it fits on one.
- In dark mode the transcript prints with the light theme's colors, so text is
  legible on paper. Bubble and code-block backgrounds are printed (they carry
  who-said-what, and dark-theme syntax colors are only legible on the
  background they were highlighted for).

## Only loaded messages print

Message loading is paginated (`cli-thread-message-pagination.md`), so printing
covers the messages currently in the DOM. A thread with a "Show more" cut
prints from that cut down; the user expands it first to print earlier
messages.

## Implementation

The transcript is **copied out of the shell**, not restyled in place:

- `ThreadMessageList` marks the conversation content element
  `data-thread-print-root` and, on `beforeprint`, appends a deep clone of it to
  `<body>` inside a `data-thread-print-clone` host, flagging `<html>` with
  `data-printing-thread`. `afterprint` (which also fires on cancel) and unmount
  remove it. Split panes each print their own copy.
- The `@media print` block in `apps/web/app/globals.css` then hides
  `body > *:not([data-thread-print-clone])` — one rule for the whole app — and
  unclips `html`/`body`.

Restyling in place was tried first and rejected: the transcript sits under a
chain of fixed-height scroll ancestors (including inline styles from
`use-stick-to-bottom`), so printing it where it lives means unclipping every
ancestor, and any new wrapper with a height, `overflow` or containment
silently truncates the printout again. A body-level clone in normal flow
paginates regardless of what the shell does above it.

- Per-row `content-visibility: auto` (`data-thread-message-row`) is reset for
  print; offscreen rows would otherwise print blank.
- The clone is `display: none` on screen, so nothing shifts while the print
  dialog is open. Nothing is added to the DOM until a print starts.
- Rules are inert elsewhere in the app: they are all scoped by
  `[data-thread-print-clone]` / `html[data-printing-thread]`.

## Verification

- `beforeprint` puts a copy of the transcript, with its message rows, in
  `<body>`; `afterprint` and unmount remove it again.
- Printing a page with no transcript is unaffected.
