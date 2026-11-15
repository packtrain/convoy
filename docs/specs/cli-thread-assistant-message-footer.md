# CLI Thread Assistant Message Footer Specification

This document defines the run-details footer rendered beneath assistant
messages in thread detail.

## Scope

- `apps/web/components/blocks/thread/assistant-cli-thread-message.tsx`
- `apps/web/components/blocks/thread/message-parts/components/run-stats.tsx`
- `apps/web/components/blocks/thread/thread-view/thread-message-list.tsx`

## Run timestamp

- A completed or failed assistant message displays the message's `updatedAt`
  value as its finish date.
- Pending, claimed, and streaming assistant messages display their `createdAt`
  value — the time the response started. A run parked on an interaction gate
  (plan approval, ask-user-question) is still `streaming`, so an unsettled
  message must show something rather than an empty footer.
- `updatedAt` is not used before the message settles: streaming writes advance
  it, so it would render as a moving activity time.
- User-message footers continue to display their own `createdAt`; assistant
  timestamp behavior does not change user-message timestamp semantics.
- The component prop carrying this value is named `timestamp`, not
  `finishedAt`, because its lifecycle meaning depends on message status.

`updatedAt` represents the server-visible completion boundary: the backend has
accepted the response as completed or failed. For successful CLI runs, this is
after buffered chunks and steering have drained and after post-run diff capture.
It can therefore be slightly later than the final agent token, but it is the
time at which the response becomes terminal in the product.

## Other run details

- The footer continues to show the runtime icon and any available duration.
- The run-details popover continues to expose available runtime metadata such
  as cost, reasoning effort, result, session, usage, and system initialization.
- Omitting a run timestamp must not hide other available run details.


## Model and reasoning

- Every assistant run-details popover includes Model and Reasoning rows after CLI, for every runtime.
- The model comes from the assistant run's persisted `resolvedCliModel`, then normalized `metadata.model`, then `systemInit.model`, then the stored `cliModel` selection. Codex message queries project `resolvedCliModel` from `codexModelState.model`, including existing runs with saved evidence. After a reroute, this is the latest confirmed model; the usage breakdown retains attribution for earlier and ambiguous intervals. The current composer selection and current machine defaults never rewrite historical run details.
- Known stored model slots use the shared runtime catalog's label. Unknown model names remain readable as stored, including custom and retired models.
- Reasoning comes from the assistant message's stored `cliEffort`. Label lookup includes the selected model so Codex and Cursor model-specific efforts use the same labels as their pickers. Runtime-specific variants without a catalog label keep their stored value.
- An explicit `default` selection displays Default only when the run has no resolved or reported model. Missing model or effort data displays Not reported. Default is a recorded selection, not a claim about which model or effort the CLI ultimately used.
- Both values truncate within the popover and expose their full text on hover.
- These rows use existing message data and normalized metadata. They require no per-message requests, schema changes, or backfill.
