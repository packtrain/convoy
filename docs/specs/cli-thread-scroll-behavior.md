# CLI Thread Scroll Behavior Specification

This document defines when the existing-thread conversation moves to the
newest content and when it preserves the user's manual scroll position.

## Scope

- Existing thread detail surfaces that render the embeddable `ThreadView`.
- User messages created from the follow-up composer and other message actions
  inside that view.

## Successful User Sends

- After the backend accepts a new user message, the conversation scrolls to
  the bottom so the newly sent message is visible.
- The behavior applies to every in-thread action that creates a user message,
  including normal follow-ups, ask-user-question responses, plan execution,
  and failed-session continuation.
- When a run is already streaming, successful sends use the same bottom-scroll
  behavior. The queued-message strip is a sibling below the conversation
  scroller and remains visible independently of that scroll.
- The scroll reuses the conversation's canonical stick-to-bottom controller.
  Thread views must not add a second scroll container or query message DOM
  nodes directly.

## Preserving User Position

- Empty submissions and failed sends do not change the conversation scroll
  position.
- Retry, steer, edit, delete, and stop actions are not new-message sends and do
  not trigger this behavior.
- Assistant streaming alone does not force a user who scrolled upward back to
  the bottom. Existing stick-to-bottom escape behavior remains authoritative
  until the user sends another message or explicitly uses the scroll button.

## Verification

- A successful in-thread send requests a conversation scroll after the send
  mutation resolves.
- A rejected or empty send does not request that scroll.
- Ordinary assistant-stream updates retain the existing user-controlled
  stick-to-bottom behavior.
