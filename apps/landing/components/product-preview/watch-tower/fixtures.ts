import { threads } from "../fixtures";

export const sections = [
  { id: "running", title: "Running", description: "Agents currently working.", label: "Running" },
  { id: "waiting_input", title: "Waiting for your input", description: "Agents asked a question and are blocked until you answer.", label: "Waiting for input" },
  { id: "failed", title: "Failed", description: "Runs that stopped with an error and can be retried.", label: "Failed" },
  { id: "needs_review", title: "Needs your review", description: "Finished threads you haven't marked as done yet.", label: "Needs review" },
  { id: "done", title: "Done", description: "Threads you marked as done, newest first.", label: "Done" },
] as const;

export const watchThreads = [
  { ...threads[0], status: "needs_review", project: "Northstar", cli: "codex", branch: "fix/delivery-retries", added: 86, removed: 12 },
  { ...threads[1], status: "waiting_input", project: "Northstar", cli: "claude-code", branch: "plan/webhook-delivery", added: 24, removed: 3, result: "Should retries share the original event's idempotency key? I need your decision before updating the delivery plan.", checks: [] },
  { ...threads[2], status: "needs_review", project: "Northstar", cli: "codex", branch: "feat/delivery-filters", added: 42, removed: 8 },
  { id: "NS-135", type: "feature", title: "Add event payload previews", age: "Now", status: "running", project: "Northstar", cli: "codex", branch: "feat/payload-preview", added: 31, removed: 4, prompt: "Add a JSON preview to the event details.", intro: "I'll check the existing event detail view.", tools: [{label: "Read event details", detail: "src/events/detail.tsx"}], result: "I'm updating the payload renderer and checking large event bodies.", checks: [] },
  { id: "DOC-28", type: "task", title: "Document webhook authentication", age: "4m", status: "waiting_input", project: "Documentation", cli: "claude-code", branch: "docs/webhook-auth", added: 48, removed: 2, prompt: "Document authentication for incoming webhooks.", intro: "I've compared the endpoint examples with the authentication code.", tools: [{ label: "Read authentication guide", detail: "docs/webhooks/authentication.md" }], result: "Should the guide recommend a separate signing secret for each environment? I'm waiting for your decision before finishing the examples.", checks: [] },
  { id: "WEB-41", type: "bug", title: "Fix the signup form validation", age: "8m", status: "failed", project: "Website", cli: "codex", branch: "fix/signup-validation", added: 18, removed: 6, prompt: "Fix validation on the signup form and run its tests.", intro: "I'll check the validation rules and the form tests.", tools: [{ label: "Run form tests", detail: "pnpm test signup" }], result: "The run stopped because the test browser could not start. The validation change is saved, but verification is incomplete.", checks: [] },
  { id: "NS-119", type: "bug", title: "Fix duplicate event timestamps", age: "1h", status: "done", project: "Northstar", cli: "claude-code", branch: "fix/event-timestamps", added: 12, removed: 5, prompt: "Fix duplicate timestamps in the event log.", intro: "I traced the duplicate entries to the event serializer.", tools: [{label: "Update event serializer", detail: "src/events/serialize.ts"}], result: "Duplicate timestamps are fixed and the regression tests pass. This thread has been marked as done.", checks: ["Event ordering tests pass"] },
] as const;
