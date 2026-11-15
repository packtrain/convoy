# Playground Tiptap Composer

## Scope

- Applies only to `apps/web/app/playground/tiptap-composer`.
- Defines a playground-only prototype for composer-style `@mentions` and `/commands`.
- Does not change production thread-composer behavior.

## Goals

- Validate that a Tiptap-based composer can show inline visual chips for:
  - `@mentions`
  - `/commands`
- Keep the playground self-contained and hardcoded.
- Show the markdown string that would be persisted/transmitted.
- Show a rendered markdown preview of that output.

## Behavior

- Typing `@` at the end of the current token opens a hardcoded mention suggestion dropdown anchored near the caret.
- Typing `/` at the end of the current token opens a hardcoded slash-command dropdown anchored near the caret.
- Selecting a suggestion replaces the typed token with an inline atom chip plus a trailing space.
- Slash-command dropdown rows are compact: generic command icon, command label only, no subtitle, and no chevron.
- Chips serialize to markdown links with custom Convoy schemes.

## Serialization

- Mention example:
  - `[@riley](convoy://user/riley)`
- Command example:
  - `[/plan](convoy://command/plan)`

## Boundaries

- Suggestions are hardcoded in the playground.
- The playground originally validated markdown-link chip serialization. Production Slash command composer behavior is defined by `docs/specs/slash-commands.md`.
- The playground does not integrate with thread drafts, submission, backend storage, or production message rendering customizations.
