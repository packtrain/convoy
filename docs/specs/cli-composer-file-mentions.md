# Composer @-File Mentions Specification

Typing `@` in a thread composer opens a file autocomplete for the selected
working directory, served live by the connected CLI. Selecting a file inserts
an atomic pill that serializes as inline `@path` text — Claude Code / Codex
resolve `@path` natively, so no structured payload accompanies the message.

Ticket: OS-1144 (part of the OS-1141 epic). Modeled on t3code
(`docs/analysis/t3code-file-mentions.md`).

## Related Specs

- Slash commands (the sibling `/` trigger and pill pattern): `docs/specs/slash-commands.md`
- Worktree op channel: `docs/specs/cli-worktrees.md`
- Run diffs (the op kinds this shares infrastructure with): `docs/specs/cli-thread-run-diffs.md`

## User-visible behavior

- An `@` token at the caret (start of text or after whitespace, no `@` or
  whitespace inside: `/(?:^|\s)(@[^\s@]*)$/`) opens the suggestion menu at the
  caret, listing up to 50 matching repo files — basename emphasized, directory
  muted. A bare `@` lists the top files alphabetically.
- A `Shift+Enter` hard line break counts as whitespace for that match, so the
  trigger fires at the start of every continuation line, not just the first
  line of the composer. Slash-command and file-mention pills are the opposite:
  they count as non-whitespace content, so `@` directly after a pill stays
  plain text.
- The list searches the **selected working directory** of the composer
  (threads page, task sidebar, and existing-thread
  composers). No menu when no profile/path is resolved or the agent is
  **offline** — the trigger is simply inert; `@` stays plain text.
- Arrow keys navigate, Enter/Tab select, Escape dismisses — identical to the
  slash-command menu. Losing editor focus dismisses it too, on the same terms
  (`docs/specs/slash-commands.md` → Composer Behavior). While a newer query is
  loading, the previous results stay rendered; the empty state shows
  "Searching files…" / "No files found".
- Selection replaces the `@query` token with a blue pill (same accent as
  slash-command pills) displaying `@path`, plus a trailing space. The pill is
  atomic (deleted as a unit).
- The message text sent to the agent contains plain `@path` at the pill's
  position. Drafts persist pills via the stored editor JSON; a draft restored
  from plain text degrades to literal `@path` text, which serializes
  identically.
- The `/` trigger takes precedence when both could match (mutually exclusive
  tokens in practice).
- **Mention in reply (OS-1159)**: Changes-card file rows and diff-viewer
  section headers offer a mention action that appends the file's `@path`
  pill to the end of the composer draft (with a separating space) and
  focuses it. Imperative path: `ThreadComposerControllerApi.insertFileMention`
  → the textarea's `mentionApiRef` → the Tiptap `insertFileMention` command.
  It works regardless of agent online state (the pill is just text on send);
  it no-ops fail-soft when the composer is unmounted.

## Search pipeline

```
keystroke → @-token detect (client, sync) → 150 ms debounce
  → cliWorktreeOps.enqueue { kind: "searchFiles", pathId, query }
  → CLI: searchWorkspaceFiles(op.path, op.query) → complete { files }
  → web watches the op row → menu renders
```

- Op rows carry a typed optional `query` column and are TTL-pruned after 10
  minutes (`FILE_OP_TTL_MS`). Empty-string queries are valid; a missing query
  is rejected (`SEARCH_FILES_QUERY_MISSING`).
- One op per debounced keystroke; a newer enqueue replaces the watched op and
  stale results are never consumed. Accepted v1 caveat: each search
  round-trips web→Convex→CLI→Convex→web (~300–700 ms debounced). Upgrade path
  if sluggish: the CLI uploads a gzipped file index once per claim and the
  client filters locally.

## CLI file index (`apps/cli/src/lib/git/file-index.ts`)

- Listing: `git ls-files --cached --others --exclude-standard -z` (tracked +
  untracked-but-not-ignored). Non-git paths fall back to a recursive fs walk
  skipping `.git`, `node_modules`, `.next`, `.turbo`, `dist`, `build`, `out`,
  `.cache`, `.convex`. Capped at 25k entries.
- Cache: in-memory per-cwd promise cache, 15 s TTL, max 4 cwds (concurrent
  builds dedupe onto one promise).
- Search: query normalized (trim, strip leading `@`/`.`/`/`, lowercase),
  substring filter, t3code basename-first scoring (exact basename 0 → exact
  path 1 → basename prefix 2 → path prefix 3 → `/query` segment 4 →
  substring 5), sorted by score then path, top 50. Files only — no directory
  entries in v1.
- Version skew: a pre-0.19 CLI fails the op cleanly (fail-soft); the menu
  shows "No files found". Restarting the agent picks up the handler.

## Web pieces

- `components/blocks/thread/prompt-input-file-mention-extension.ts` — the
  `fileMention` Tiptap inline atom node (attrs `{ path }`), cloned from the
  slash-command extension; `renderText` → `@path`.
- `lib/threads/hooks/use-file-mention-search.ts` — debounce + enqueue + watch.
  Uses the raw Convex client (`useConvex`), not `useQuery`/`useMutation`, so
  the composer renders without a provider in unit tests; the hook is inert
  when the client, context, or query is absent.
- `prompt-input-tiptap-textarea.tsx` — dual-trigger `getSuggestionState`
  (`kind: "slash" | "file"`); file results arrive async and are mirrored into
  a ref for the keyboard handler; `serializeNode` maps `fileMention` nodes to
  `@path`.
- `thread-composer.tsx` — derives `FileMentionContext` (profileId, pathId,
  isProfileOnline) from the resolved context selectors and passes it down.
  The agent-automation config editor passes none (no live path) — mentions
  are unavailable there by design.

## QA checklist

- `@` in a new-thread composer with a connected agent lists repo files;
  typing narrows with basename matches first.
- Enter inserts a blue `@path` pill; the sent message contains plain `@path`.
- `@` with the agent offline does nothing (plain text).
- Slash commands still work; `/` and `@` menus never show simultaneously.
- Backspace deletes a pill atomically.

## Attachment mentions

`#` selects a current attachment locally; `@` continues to select repository paths.
Pasting files inserts references immediately, while picker and drop only attach.
See [attachment references](cli-message-attachments.md#attachment-references-in-the-composer)
for identity, upload states, naming, and restoration rules.
