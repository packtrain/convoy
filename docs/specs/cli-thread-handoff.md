# CLI Thread Handoff Specification

`Handoff from here` on an assistant reply opens a new-thread composer seeded with
the conversation so far as an attached Markdown file. The user can pick a
different CLI, profile, path or model before sending. The new thread starts a
fresh agent session that reads the file, so a handoff works between runtimes
(Codex to Claude Code and back), unlike `Branch from here`, which resumes the
same session (`cli-thread-fork.md`).

Related specs: `cli-thread-assistant-message-actions.md` (the menu),
`cli-thread-markdown-export.md` (the transcript builder),
`cli-thread-drafts.md` (draft seeding), `thread-groups.md` (the draft tab).

## Menu entry

- `Handoff from here` sits right after `Branch from here` in the assistant message
  menu. It is a submenu with `In a new thread` and `In a new tab`.
- It is enabled when the reply is finished (`completed` or `failed`, not
  `pending`, `claimed` or `streaming`) and the viewer owns the thread. The
  runtime, `cliContext.continuationId` and `turnId` do not matter. A reply
  Branch cannot fork can still be handed off.
- The parent thread is never modified.
- Only the thread workspace offers it, because the transcript is that page's
  loaded history and its draft provider is the one the new-thread composer
  reads. The popover preview has its own provider, so the item is disabled
  there. Replies shown from a fork's parent are disabled too: their history
  is the parent's.

## What the transcript covers

The run the picked reply belongs to, and everything before it. Messages
after that run are left out. Before building, the action drains message
history the way the Markdown export does (`loadOlderChunks` until done or
`EXPORT_STALL_MS` passes, same progress toast). History no pagination can
reach gets the export's "Earlier messages are outside the loaded window"
note.

### Forks

A fork's own rows start at the copied run; everything before it lives in its
ancestors (`cli-thread-fork.md`, Earlier parent messages). The handoff reads
that history to the end with `readWholeForkPrefix`, the same one-shot reads
"Show more" uses, parent first and then each ancestor up the chain, and puts
it before the fork's own rows. A page that stops making progress, or an
ancestor that is gone, ends the walk and adds the "outside the loaded window"
note. While `forkedFrom.copiesInFlight > 0` the entry is disabled, as Branch
is.

### Rendering

Each turn renders the way `buildThreadMarkdown` renders it: user messages,
messages other agents sent, assistant text parts, failed-run notes and
attachment names. Tool calls, tool output and reasoning are dropped. The new
agent reads files and diffs from disk.

## Size cap

`HANDOFF_BYTE_CAP` is 64,000 UTF-8 bytes, about 16k tokens. When the
transcript fits, it ships as one file. When it does not:

1. Every user message stays, including messages other agents sent. The first
   message carries the intent and later ones carry the corrections.
2. The first and the last assistant reply stay.
3. The other assistant replies are replaced with a stub, oldest first, until
   the file fits or none are left. A reply no larger than its stub is skipped:
   `_Reply omitted (12 KB). Search handoff-…-full.md for "message <id>"._`
4. If the file is still over the cap, it ships over the cap. Nothing kept by
   rules 1 and 2 is ever truncated.

Every author line in both files ends with `· message <id>`. When any reply
was omitted, a second file `…-full.md` is attached with every turn in full,
so the stub's search hits. The agent reads the capped file first and opens the full one
only for what it needs.

`list_thread_messages` cannot serve as the fallback. It returns at most the
20 most recent messages, cuts each at about 4000 characters and has no
pagination.

File names follow `threadMarkdownFileName`: `handoff-<slug>-<date>.md` and
`handoff-<slug>-<date>-full.md`.

## The seeded composer

Every setting starts as the source thread had it, and all of them can be
changed before sending: profile, path or worktree, CLI, model, effort, mode,
Project agent and attached task. These are the settings
`buildAddToGroupDraftSeed` already copies. The CLI is not switched for the
user.

The draft text is editable and reads:

```md
Continue the work from the attached handoff. It holds the conversation from
the thread "<title>" (<thread URL>), run by <CLI label>, through <reply time>.
Tool calls, tool output and reasoning are left out. Read the files you need
from the working directory.
```

When the full file is attached, a final sentence names it: "Some replies are
shortened to a stub; look them up in <full file name>." The time is UTC, as
in the transcript. The files go into `draft.attachments.uploaded`
as `text/markdown` through the composer's upload mutations, so they survive
reloads like any other draft attachment. A failed upload, or a registration
the backend refuses (`null`: oversized or already claimed), shows a toast and
no composer opens; the file that did upload is deleted.

### In a new thread

The action seeds the project's `new` draft and navigates to the new-thread
route, with the task carried by the `attachedTask` preselection the way
`Send comments to thread → New thread` carries it. The seed goes through the
mounted provider's `seedDraft`, which takes the pills and files as a patch
next to the text. Unsent text already in the `new`
draft stays above the handoff text. Its attachments stay too, up to the
10-attachment limit (`MAX_MESSAGE_ATTACHMENTS`), and the action fails with a
toast before uploading if the handoff files would not fit.

### In a new tab

The action opens the thread's add-to-group draft tab (`thread-groups.md`,
Group lifecycle) seeded the same way, into the group's `sibling:` draft. A
handoff always re-seeds the pills, even when the draft tab was already seeded
from this thread, and keeps the `seededFrom` stamp so a later "+" does not
re-seed over the handoff text. Unsent text and attachments are kept as in a
new thread. The tab opens without "+"'s own seeding, which would clear the
text; an already open draft tab remounts its composer on the seed. Sending
creates the Group child and forms the group if needed.

The item is disabled wherever "+" is unavailable: a group at its cap, a
container, a read-only viewer. If the view leaves the group while the
handoff is still uploading, the draft is seeded but its tab is not opened;
the group's "+" shows it later.

## Non-goals

- No stored link from the new thread to its source. The draft text names the
  source thread's URL and that is the link.
- No LLM-written summary. A later "Summarize first" option could run a prompt
  on the source CLI.
- No native history injection, such as Codex `thread/inject_items`. Every
  runtime gets the same file.
- No handoff from thread list rows. The transcript exists only for the open
  thread, the same reason the export is not offered there.
