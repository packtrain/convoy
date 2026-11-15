# Question stack playground

## Scope

Design experiment for OS-1965 at `/playground/question-stack`, linked from
the playground index. Uses local sample data only. The user approved the deck
for production, with the pending count opening the picker and no Spread cards
button. Production behavior and provider responses are governed by
`cli-interactive-approvals.md`. The playground retains its tuning controls.

## Interaction

- One question is open above a mock thread composer. Up to three waiting
  cards peek out behind it.
- Hover spreads the waiting cards upward to expose their headings. Selecting
  a heading brings that card forward. The composer stays in place.
- An explicit spread/collapse button supports touch and keyboard use. A
  bounded request picker exposes every pending question, including queues
  larger than the visible deck.
- Draft choices and custom answers survive switching cards. Sending an answer
  removes that sample request and animates the next card forward. Answers
  appear in a local activity log. Reset restores the sample questions.
- Controls adjust resting spacing, hover spacing, animation feel, request
  count, and preview width. Adding a request preserves the active question.
- Reduced-motion preferences disable spatial animation. Question bodies and
  the full request picker scroll independently when needed.

## Review

Use the playground to compare overlap, spread distance, and selection motion.
The production deck adopts the default spacing and gentle motion. Additional
playground controls do not appear in production.
