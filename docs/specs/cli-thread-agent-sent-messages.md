# CLI Thread Agent-Sent Messages Specification

How a user message posted by another thread's agent is distinguished from one a
person typed, in thread detail (OS-1631).

## Scope

- `apps/web/components/blocks/thread/message-sent-by-badge.tsx`
- `apps/web/components/blocks/thread/thread-view/thread-message-list.tsx`

The data is pre-existing: `cliMessages.sentBy` is written only by MCP
`send_thread_message` and already reaches the client on
`listEnvelopesByThread`. See [mcp-server.md](mcp-server.md) for the write path
and its guards.

## The category is "not you", not "an agent"

Absent `sentBy` means a human sent it — the meaning it already had before the
field existed, which is why no backfill was needed. Present means another
thread's agent posted it.

The bubble treatment is deliberately framed as **"someone other than the
viewer"** rather than "an agent", because teammate-sent messages on a shared
thread will join the same category. Only the `sentBy.kind === "thread"` case is
implemented; a teammate case widens the predicate rather than reopening the
visual decision.

## Bubble background

- A human user message keeps `bg-secondary`, which reads as "what I said" and is
  the transcript's strongest visual anchor.
- An agent-sent user message renders `bg-thread-message-foreign` instead. It must
  not wear `bg-secondary`: two authors sharing one "this is me" background is the
  thing this feature exists to prevent.
- **This needs its own token, and reusing an existing one is a silent no-op.** In
  this grayscale palette `--secondary`, `--muted`, and `--accent` are *the same
  value* in light mode (`oklch(0.97 0 0)`), and `--secondary` equals `--muted` in
  dark mode too — so `bg-muted` on a user bubble renders no visible change at all.
- `--thread-message-foreign` is a **cool-tinted** surface, and the hue shift is
  what carries the signal rather than a lightness step: ≈1.12 (light) and ≈1.02
  (dark) luminance contrast against `--secondary`. Deliberately near-invisible as
  a brightness difference — the transcript stays quiet and the badge is the
  explicit answer to "who sent this". Text on it keeps ≥12:1 against
  `--foreground`. A stronger step was tried and rejected as too loud for an
  operational surface.
- Exact 8-bit sRGB hex, per
  [frontend-development.md](../guidelines/frontend-development.md) — these fill a
  bubble-sized surface, and `oklch()` values landing between two 8-bit steps band
  across GPU layers.
- Held (`opacity-60`) and editing states compose with the tint rather than
  replacing it. No border is added: the background carries the distinction.

## Badge

- An agent-sent message shows a `CornerDownLeft` icon at the **right end** of the
  message footer row, after the run-details trigger. The direction is the reason
  for the position: the arrow points back down-left into the bubble it belongs to,
  so at the left end it would point away from its own message.
- **Icon only**, with the accessible name and tooltip carrying the meaning
  ("Sent by another thread's agent. Click to open"). The tinted background already
  answers "not you", so a label would repeat it in a row that already holds the
  runtime glyph, the mode glyph, a timestamp, and sometimes Edit.
- `CornerDownRight` was rejected: it is the **Steer** action's glyph in the same
  view (`queued-messages-strip.tsx`), at the same size and color.
- The anchor takes `-m-1 p-1` so an icon-only target stays comfortable without
  growing the footer row's height.
- The badge links to the sending thread. `sentBy` is guaranteed same-project by
  the mutation's `SOURCE_THREAD_CROSS_PROJECT` guard, so the **current route's**
  organization and project slugs address it — no lookup, and no project id on
  the message.
- **The link is optimistic.** Its target is not verified before render: a
  deleted sender lands on the thread route's own not-found. Verifying would cost
  one read per agent-sent message on a query that stays subscribed for as long
  as the view is open, to prevent a rare bad click. A deleted sender is the
  realistic miss; a sender the viewer cannot read is possible on a shared thread
  (the sender carries no `sharedAt` of its own) and resolves the same way.
- The badge is omitted when the route slugs are unavailable, since a badge with
  no destination is worse than none.

## Not in scope

- **The sender's title.** Rendering it needs a read per distinct sender, and the
  icon plus link answers "take me to whoever sent this" without it.
- **Suppressing Edit.** The newest agent-sent message still offers Edit and
  resend, per [cli-thread-edit-last-message.md](cli-thread-edit-last-message.md)
  — editing another agent's words is odd but the thread is the viewer's own, and
  no rule against it exists yet.
- **Teammate-sent messages.** `cliMessages` has no author field; a human sender
  other than the thread's owner would widen `cliMessageSentByValidator`'s `kind`
  union, which is why that union has one member today.
