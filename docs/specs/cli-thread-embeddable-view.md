# Embeddable Thread View (OS-1130)

`ThreadView` (`apps/web/components/blocks/thread/thread-view/thread-view.tsx`)
is the reusable, embeddable thread conversation extracted from the thread
detail page. It renders, as a fragment:

1. the message stream (`ThreadMessageList`: visibility windows / "show more"
   cuts, AskUserQuestion cards, plan execution, failed-run Continue/Retry
   actions, run diff cards),
2. the queued-messages strip (edit/delete/steer),
3. interaction request cards,
4. the follow-up composer (drafts, attachments, mode/model/effort selectors,
   context-window meter, stop button), and
5. the retry confirmation dialog.

## Hosts

- **Thread detail page**
  (`components/blocks/thread/workspace/thread-workspace.tsx`)
  — a thin wrapper: header + workspace sidebar (tabs, run timeline, file
  viewers, task panels) + revert flow around a `ThreadView`.
- **Task agent-work popover mini preview**
  (`components/blocks/thread/thread-mini-preview.tsx` hosted by
  `components/blocks/tasks/agent-thread-work/agent-thread-work-cell.tsx`)
  — see `agent-automation.md` (Visibility UI).

## Contract

- The host resolves the thread (`useCliThread`) and owns the single
  `useCliMessages(chat._id)` subscription, passing both in (`chat`,
  `cliMessages`). This lets page-level features (run timeline, review
  comments, cumulative diffs) share the same envelope data without a second
  chunk-store instance, and keeps not-found states host-styled.
- Message loading is owned by `ThreadView`, not the host: while
  `cliMessages.isLoading` is true and no message is renderable yet, the
  stream shows placeholder bubbles and everything else (host header, queued
  strip, composer) stays mounted. Hosts must not swap themselves for a
  full-surface skeleton once the thread doc resolves — replacing the composer
  mid-load reads as a page reload (OS-1434). A host-level skeleton is only
  for the thread itself still loading (`useCliThread`). Both placeholders are
  held invisible for their first 200ms, so a load that resolves inside that
  window shows no skeleton at all.
- A `ThreadDraftProvider` ancestor is required (the threads layout provides
  it on the page; embedded hosts mount their own with
  `buildProjectDraftStorageKey`, sharing drafts with the full page).
- Layout: the fragment expects a column whose first row can grow, e.g. the
  page's `grid-rows-[auto_minmax(0,1fr)_auto]` main or the mini preview's
  `grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)]
  grid-rows-[minmax(0,1fr)]` wrapper. The queued-message
  strip and each queued row must allow their intrinsic width to shrink within
  that host; long follow-up text truncates inside the row instead of widening
  a narrow mini preview.
- Hosts must constrain **both** axes, not just height. The mini preview sits in
  a fixed-width `overflow-hidden` popover, so a grid track left at `auto` sizes
  to its content's min-content width and silently clips the trailing edge —
  tab strips, header counts, even the composer's stop button — instead of
  shrinking. Every wrapper between the host and the content needs `min-w-0`
  (and `minmax(0,1fr)` on grid tracks); one `auto` track anywhere in the chain
  reintroduces the clipping (OS-1602).
- The queued strip and interaction cards render between the message stream and
  the composer, in **auto-height rows outside the conversation scroller**.
  Nothing upstream bounds their height, so any content that can grow without
  limit must cap and scroll itself, or it pushes a fixed-height host (the mini
  preview's `h-[min(70vh,36rem)]`) past the viewport and clamps the composer.
  `InteractionRequestCards` does this for question bodies (OS-1602; see
  `cli-ask-user-question-ui.md` → Vertical overflow). Keep each strip's primary
  action outside its own scroller so it stays reachable.
- Everything page-specific is an optional prop; omitting it degrades
  gracefully:
  - `onOpenDiffFile` / `onRevertRun` / `onRevertFile` — run-card actions;
    omitted (mini) hides them.
  - `taskLinkHref` / `onOpenTask` — task pill routing; defaults to the
    project task URL with normal navigation.
  - `initialAttachedTask` / `onAttachedTaskChange` — host-persisted attached
    task state.
  - `wrapSubmit` / `extraAttachmentPills` — the page wraps sends to append
    run-review feedback and shows the review-comments pill.
  - `composerControllerRef` — shared composer controller so host surfaces
    (e.g. "mention in reply" from the file viewer) can insert into the
    composer.
  - `compactSelectors`, `composerContainerClassName`,
    `composerContentClassName` — density tweaks for narrow embeds.
  - `readOnly` — see below.

## `readOnly` (OS-1575)

Set by a host whose `chat.isOwner === false`: a project teammate watching a
thread shared with them (`cli-thread-sharing.md`). Both hosts derive it the
same way, and the mini preview passes it too — a teammate can now resolve
someone else's thread there.

`readOnly` suppresses every write affordance in one place:

- the composer (`conversationComposerProps` returns `null`), and with it every
  selector, the cost indicator and the context-window meter it hosts;
- the queued-messages strip and the interaction request cards;
- `onSubmitEditLast` / `onRetry` / `onContinueFailedSession` /
  `onPlanDecision` / `onSubmitAskUserQuestion` / `onMentionFile` /
  `onDeleteHeldMessage`, all passed as `undefined`, and `showPlanDecisions`
  forced false.

`ThreadMessageList` takes those handlers as optional and each render site hides
its own control when its handler is absent. **The failed-run error text stays**
— a viewer should see that the run failed, they just can't Continue or Retry it
(`cli-thread-failed-message-actions.md`).

Three subscriptions are `"skip"`ed rather than mounted, because only the
suppressed surfaces read them: `cli.facts.getThreadRuntimeCommands`,
`cli.interactionRequests.listPendingByThread` and
`cli.sessions.getSessionCapabilities`. All three are owner-only on the backend
and would return empty anyway, so this is a cost saving, not a correctness fix.
`cli.profiles.get` stays — it checks `TASK_VIEW`, and the transcript's
path/profile labels come from it.

The host is responsible for the writes `ThreadView` doesn't own: it must pass
`useCliMessages(threadId, { canWrite: false })` so the legacy-content backfill
never fires, and gate its own header actions.

Related specs: `agent-automation.md`, `cli-thread-drafts.md`,
`cli-thread-message-pagination.md`, `cli-thread-failed-message-actions.md`,
`cli-thread-print.md`, `cli-thread-sharing.md`,
`cli-thread-task-attachments.md`.
