---
description: Re-split a plan into vertical slices, each one commit I can verify by clicking
---

Re-split this plan into vertical slices: $ARGUMENTS

Default to the plan in this conversation. If given a task ref, read the task and
its plan artifact first. Do not rewrite the plan — the split is a separate
proposal, and the plan stays the reference for *what* to build.

## The cut

A slice is **one commit carrying whatever backend and frontend it needs to be
verified by clicking in the running app** before the next slice starts. A
backend-only phase followed by a frontend-only phase is the wrong cut, however
cleanly it reviews. Every slice leaves the app working.

Most plans arrive split by layer (schema → functions → UI). That split is what
you are replacing. Expect to interleave: the same file gets touched by three
slices, and that is correct.

## For each slice

- What it does, files touched (marked NEW or MODIFIED), rough size.
- **Verify by clicking** — the exact UI steps that prove it works, ending in a
  reload so persistence is actually tested.
- What it deliberately does not cover yet.
- The non-obvious calls and why, so the implementer doesn't re-litigate them.

## Sequencing rules

- Cheapest complete round trip first (create → see it → edit → reload → delete),
  then widen. Defer the variant that drags in a heavy dependency, even when it
  looks like the "main" case — a cheap sibling case ships the plumbing first.
- No slice may depend on a later one.
- Required schema fields land with the first slice that writes the table. Adding
  a required field later means fixing existing rows by hand. Optional fields
  land in the slice that first reads them.
- A pure refactor has no UI. Fold it in as the first commit of the slice that
  needs it; never give it its own slice.
- A dev gate or feature flag comes off when the feature is usable end to end —
  which may be a later task, not this one.

## When a slice has no click path

Say so instead of burying it. It means one of:

- **Its trigger lives in another task.** Name that task and move it there, where
  it becomes clickable. Check whether that task's description already scopes it.
- **A thin UI slice can be pulled forward** to exercise it. Do that.
- **Neither.** Then it is a test-only commit: label it, put it last, and say
  what verifies it instead.

Never invent throwaway UI just to make something clickable.

## Output

A table of slices (ref, name, click path), then the per-slice detail, then what
this changes outside the plan — stale task titles or descriptions, specs, and
anything now scoped in two places.

Propose first. Create subtasks only when I say so, one per slice, each carrying
its own file list, verify steps, and rationale.
