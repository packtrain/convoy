# CLI AskUserQuestion UI Specification

This document defines the UI behavior for inline `AskUserQuestion` tool prompts rendered in thread assistant messages.

## Scope

- Applies to `apps/web` thread message part rendering for `AskUserQuestion`.
- Covers questionnaire interactivity, submission locking, and multi-prompt behavior in a single thread.
- OpenCode `question.asked` requests reuse this flow: the CLI maps OpenCode's `QuestionInfo` shape to the same payload (`multiple` → `multiSelect`) and maps submitted answers back to OpenCode's ordered per-question label arrays (see `docs/specs/cli-opencode-runtime.md`).

## Rendering Contract

- `AskUserQuestion` tool prompts render inline as a questionnaire panel.
- Each question supports:
  - single-select options (`radio`)
  - multi-select options (`checkbox`)
  - optional freeform custom answer (`Other` input)
- Submitted prompts are locked and shown read-only.

## Option Layout (OS-1602)

Both renderers draw their options through
`components/blocks/thread/question-option-list.tsx`, so the two surfaces cannot
drift apart.

- Options render as a **vertical list of control rows**, not as chips: a radio
  group when `multiSelect` is false, checkboxes when it is true.
- Each row shows the option's `label` with its `description` on the line below,
  in muted text. The description is what makes a choice decidable, and a chip
  could only carry it in a `title` tooltip — invisible on touch and to anyone
  not hovering.
- The whole row is the hit target: the control and the label/description block
  live inside one `<label>`, and the row highlights (`bg-muted`) while selected.
- Single-select uses a screen-reader-only native `<input type="radio">` plus a
  painted indicator. The native input keeps arrow-key group navigation and
  "pick one" enforcement; the paint exists because a native radio cannot host
  the label + description block.
- Because it is a real radio group, a single-select answer is **switched**, not
  cleared, by clicking another option. Chips used to clear on re-click; rows do
  not.
- Multi-select rows carry no extra glyph beyond the checkbox — the checkbox is
  already the "pick any" signal that chips had to fake with a square icon.
- The `Other…` free-text answer is a row in the same list. Its input is revealed
  below the label, **inside** the row's selected surface but **outside** the
  `<label>`, indented to the label text. Both halves of that are load-bearing:
  inside the label, every click into the field re-toggles the row; outside the
  surface, the field hangs off the bottom of the highlighted box. So the
  selected/hover background belongs on the row wrapper, not on the label.
- The revealed input keeps the shared `Input` height. Do not re-declare `h-8` at
  the call site — a local height override here drifts from the primitive.
- DOM ids and the radio-group `name` come from `buildQuestionKey(promptId,
  questionIndex)` — see Multi-Prompt Isolation below.

## Tabbed Questions (OS-1456)

Applies to both renderers: the mid-run interaction card
(`components/blocks/thread/interaction-request-cards.tsx`) and the append-only
tool part (`message-parts/ask-user-question-part.tsx`).

- A request with more than one question shows **one question at a time** in a
  tab strip, never all questions stacked.
- Tab labels come from the question's `header`, falling back to
  `Question {n}` when the runtime supplies none. The full label is also the
  tab's `title` so a clipped label stays discoverable.
- Each tab shows a checkmark that is dimmed until that question is answered.
  The card header shows an `N of M answered` count.
- The primary action is `Next` on every tab except the last, and
  `Send answers` on the last tab. `Send answers` stays disabled until **every**
  question has an answer, not just the visible one.
- Because the last tab's primary action is `Send`, an unanswered earlier
  question would be a dead end: the last tab also offers a
  `Go to unanswered` action that jumps to the first unanswered question.
- A request with exactly one question renders **without** a tab strip and
  without `Next` — the strip would carry no information. The plain prompt plus
  `Send answers` is the whole card.
- Overflow: the tab strip scrolls horizontally and does not wrap. Headers keep
  their full text, and the trailing edge is faded to signal that more tabs
  exist. This is required because the card also renders inside narrow mini
  previews, where it must shrink rather than widen its host (see
  `cli-thread-embeddable-view.md`).
- Vertical overflow: the interaction card's **question body is height-capped and
  scrolls internally**; the header, tab strip, and action row stay pinned
  outside the scroller. The card sits in an auto-height row *outside* the
  scrolling conversation, so nothing upstream bounds it — unbounded, a long
  option set grew the mini preview's fixed-height column past the viewport and
  clamped the composer (OS-1602). The cap mixes a `vh` and a `rem` term so it
  stays honest on short viewports. `Send answers` must never live inside the
  scroller: pushed offscreen, the question becomes unanswerable.
  The append-only tool part needs no such cap — it renders *inside* the
  conversation scroller.
- A capped body must signal that it scrolls, with **both** affordances:
  - **Peek.** The `rem` cap is a half-multiple of the option row pitch
    (3.75rem: a described row plus the list gap), so the cut always lands
    mid-row. A whole-number cap lands cleanly between rows and the list reads
    as finished — the failure mode users actually reported.
  - **Fade.** The edge fades via `mask-image`, the same language the tab strip
    uses on its trailing edge, rotated. In a narrow mini preview the peek alone
    is too weak: a cut row can pass for a cramped row.
  - The fade **follows scroll position**, fading only edges that still have
    content past them: bottom at the top of the list, both mid-scroll, top at
    the end, and **none when the content fits**. Every state is load-bearing —
    a fade left on at the end dims the final option for no reason and reads as
    a disabled row, and a fade on a short list advertises options that do not
    exist. Measured from `scrollTop`/`scrollHeight`/`clientHeight` with a 1px
    tolerance for sub-pixel rounding, remeasured by `ResizeObserver` for content
    changes (tab switch, `Other…` reveal, host resize). The scroll listener is
    passive and commits to state only when an edge flips, so scrolling does not
    rerender the card per frame — it already rerenders throughout a run.
  - Each fade variant must be a complete literal class. Tailwind only compiles
    arbitrary values present in the source, so a mask assembled by string
    interpolation silently produces no style.
- Answer state is keyed by question **index**, not question text. One request
  may contain two questions with identical text, and text keys would make them
  share a single answer slot.
- The control type carries the arity: radio rows for single-select, checkbox
  rows for multi-select, including the `Other…` row (see Option Layout).

## Interactivity Contract

- Single-select questions allow only one selected option unless a custom answer is entered.
- Entering a custom answer for single-select clears selected options.
- Selecting a single-select option clears a previously entered custom answer.
- Multi-select questions allow selected options and custom answer together.

## Multi-Prompt Isolation

- Multiple `AskUserQuestion` prompts in the same thread must remain independently interactive.
- DOM identifiers for question options and radio group names must be namespaced by prompt identity (`toolCallId` for the tool part, request id for the interaction card), not only by question index. Both go through `buildQuestionKey`.
- Clicking a later prompt option must never target controls in an earlier prompt. This is not cosmetic: same-named radios in two prompts form one browser radio group, so answering the second prompt would silently unset the first.

## Validation and Submit

- Submit is enabled only when every question has at least one answer source:
  - one or more selected options, or
  - non-whitespace custom answer
- Whitespace-only custom answers do not count as answered.

## Related

- Streaming and tool event normalization: `docs/specs/cli-message-chunks-storage.md`
- CLI runtime integration: `docs/specs/cli-sdk-integration.md`
