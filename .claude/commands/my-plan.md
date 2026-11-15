---
description: Plan a task with verified file paths, Convex signatures, and a reactivity/cost analysis
---

Plan this task: $ARGUMENTS

Do not write implementation code yet.

## Before planning

Read the actual code. Every file path, function name, table, and API route you
mention must either already exist (verified) or be explicitly marked NEW.
Search for existing code that already does part of this — reuse beats new.

Read the relevant spec(s) under `docs/specs/` and note which ones this change
makes stale.

## Output

**Understanding** — 3-5 lines: what changes for the user, and what is explicitly
out of scope.

**Open questions** — anything ambiguous where two readings lead to different
work. If none, say "none". Do not invent requirements to fill gaps; state the
assumption instead.

**Design** — the shape of the change:

- Schema changes: tables, fields, indexes. For each new index, name the query
  that needs it.
- Convex functions: full path (`api.tasks.core.foo`), args, return shape,
  query/mutation/action, public vs internal.
- For each query: reactive subscription or one-shot? Which index does it use?
  Paginated or `.collect()`, and roughly how many documents per call?
- Files: exact paths, marked NEW or MODIFIED.
- Frontend: components, hooks, where state lives.
- Specs under `docs/specs/` to create or update.

Prose and signatures only. No implementation code — except 5-10 lines of
pseudocode where the *logic* is the risk (algorithm, state transitions,
concurrency/ordering, tricky invariant). If the logic is obvious from the
signature, skip it.

**Phases** — vertical slices, not layers. Each phase is one commit carrying
whatever backend *and* frontend it needs to be verified by clicking in the
running app before the next phase starts. A backend-only phase followed by a
frontend-only phase is the wrong cut, however cleanly it reviews. Every phase
leaves the app working.

For each phase: what it does, files touched, rough size, and:

- **Verify by clicking** — the exact UI steps that prove it works, ending in a
  reload so persistence is actually tested. If you can't write them, the phase
  is mis-cut: either pull a thin UI slice forward, or the work belongs in a
  different task because the thing that triggers it lives there. Say which, and
  never invent throwaway UI to make something clickable.
- What it deliberately does not cover yet.

Sequencing rules:

- Cheapest complete round trip first (create → see it → edit → reload → delete),
  then widen. Defer the variant that drags in a heavy dependency, even when it
  looks like the "main" case.
- No phase may depend on a later one.
- Required schema fields land with the first phase that writes the table —
  adding a required field later means fixing existing rows by hand. Optional
  fields land in the phase that first reads them.
- A pure refactor has no UI. Fold it in as the first commit of the phase that
  needs it; never give it its own phase.
- A dev gate or feature flag comes off when the feature is usable end to end,
  which may be a later task, not this one.

If it's one commit's worth of work, say so and skip the phases section.

**Reactivity & cost** — the point of this section is to let me decide whether the
feature is worth its price. Be concrete and quantified:

- New live subscriptions from frontend → backend. List them, and say which
  screens mount them and how many are mounted at once.
- For each new/changed query: its read set, and **which mutations invalidate it**.
  Spell out the fanout: "any task edit re-runs this and re-sends all ~500 project
  tasks to every viewer of the board".
- Existing queries this change makes noisier — e.g. adding a field to a hot
  document, or reading a doc that's written frequently.
- Extra reads/writes per mutation, and per what: "1 extra write per org member".
- OCC / write-contention risk: does any mutation write a document that concurrent
  users also write (counters, parent rollups, a shared settings doc)?
- Scheduled functions or crons added, and at what rate.
- Where denormalization removes the cost — and what keeping it in sync costs
  (which mutations must now also write it, and what happens if they drift).
- What breaks at 10x current data volume.
- Migration/backfill needed for existing documents?

**Alternatives** — the simpler option you rejected and why, in 2-3 lines. If the
simpler option is actually fine, recommend it instead. Explicitly consider:
does this need to be reactive at all, or would a one-shot read do?

---

Present the plan in chat first. If I ask for it on disk as phase files with
per-agent handoff notes, follow `/feature-plan` for that format.
