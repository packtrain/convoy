# Project Agents on CLI Threads

Tracking task: OS-1138.

## Scope

This document defines how a Project agent's `prompt` (the "reusable working
prompt" from `agents.md`) becomes effective at runtime:

- Thread-level agent binding (`cliThreads.projectAgentId`) and its display.
- The agent selector in the new-thread composer.
- Per-runtime delivery of the agent prompt to the CLI agent process.
- Integration with assignment automation (OS-1094 / OS-1131).

Related specs: `agents.md` (Agent/Project-agent model, the `prompt` field),
`agent-automation.md` (assignment automation, `automation.prompt`),
`cli-runtime-architecture.md` (runtime registry and runners).

## Terms

- **Agent prompt**: the Project agent's `prompt` field — persona/working
  instructions for the agent, distinct from `automation.prompt` (composer
  content for the first message).
- **Agent binding**: the immutable association between a CLI thread and one
  Project agent, set at thread creation.
- **Prompt delivery**: the runtime-specific mechanism by which the agent
  prompt reaches the spawned CLI agent process.

## Thread Agent Binding

- `cliThreads` gets an optional `projectAgentId: v.id("projectAgents")`.
- The binding is set only at thread creation and is immutable afterwards.
  Rationale: system-prompt content must stay constant for the lifetime of a
  runtime session — changing it mid-thread would invalidate the provider
  prompt cache and change agent behavior mid-run.
- The thread also snapshots the agent prompt text at creation
  (`agentPromptSnapshot: v.optional(v.string())`). Editing the Project agent
  later never changes what an existing thread runs with; the snapshot is the
  single source the CLI receives.
- A thread with a bound agent whose Project agent was later deleted keeps
  running on its snapshot. Display fails soft with the existing deleted-agent
  placeholder pattern.
- An agent with no `prompt` can still be bound (attribution-only): the thread
  shows the agent, and no prompt is delivered.
- Binding a Project agent requires it to belong to the thread's project.

## Display

- Thread list rows and existing-thread composer metadata show an agent chip
  (agent avatar initials + color + name) for bound threads, resolved live from
  `projectAgentId` with the deleted-agent placeholder fallback. Dense/compact
  thread rows (compact list layout, task popover rows) show the
  avatar only, with the name in the tooltip. The deleted-agent placeholder
  renders dimmed. The detail header does not show the persona chip; immutable
  thread context lives next to the follow-up composer. The read-only chip in
  the follow-up composer's context bar has `px-2` horizontal padding.
- In compact thread-list rows, revealing the row actions may replace the
  relative timestamp, but it must not hide the CLI runtime icon or bound agent
  chip.
- The compact branch hover card includes the bound agent avatar and name.
  Repository, working-directory, branch, and pull-request rows are compact
  icon/value pairs without label headers.
- The agent prompt text is never rendered in the thread. It is not part of
  any stored message content; the thread chip plus the agent's settings page
  are the transparency surface.
- `tasks.agentThreadWork` entries gain the bound agent's identity
  (`projectAgentId` + display name snapshot) so task surfaces can show which
  agent a thread ran as, not only which CLI.

## Composer Agent Selector

- New-thread composers show a persona selector, rendered in the composer's
  context bar above the input after the workspace selectors (single shared
  layout, see `docs/specs/cli-thread-context-selectors.md`);
  existing-thread composers render the read-only bound-agent chip in the same
  position. Options:
  `Default` (no Project agent) plus the project's active Project agents (initials
  avatar in the agent color). The selector is hidden entirely when the project
  has no active Project agents.
- The selection participates in composer draft persistence like the other
  pills; a persisted selection that no longer resolves to an active project
  agent falls back to `Default`.
- Selecting an agent whose `automation` config is present and enabled
  defaults the other pills (`cliType`, `cliModel`, `cliEffort`, `mode`,
  `workspace`) from that config, and seeds `automation.prompt` into the
  composer (slash-command refs rebuilt into real nodes). Seeding happens only
  when the composer is empty **or still holds the previous agent's unedited
  seed** (switching agents swaps prompts; deselecting or switching to an
  agent without a prompt clears the leftover seed). Text the user typed or
  edited is never overwritten or cleared. Each pill and the seeded prompt
  stay user-editable. Agents without an enabled automation config only bind
  identity/prompt and leave the pills untouched.
- Leaving an agent (deselecting, or switching to one whose automation doesn't
  set a given field) also reverts that agent's **unedited** pill seeds: the
  drafted value is unset so the composer falls back to its pre-agent defaults
  (the remembered last-used CLI/model/effort from local storage, then registry
  defaults). Pills the user overrode after selecting the agent are kept.
- The selector exists only on new-thread composers. Follow-up message
  composers on an existing thread never show it (the binding is immutable).
- The assignment-automation dialog shows the selector in a locked state (see
  "Assignment Automation Integration").
- Threads created with no agent behave exactly as today.

## Prompt Delivery

The stored Convex user message is exactly what the user typed. The agent
prompt is injected CLI-side by the runtime runner when composing what the
runtime receives; it is never appended to stored message content and never
rendered by the web UI.

Each runtime declares its delivery mode in the runtime registry
(`agentPromptDelivery: "system-append" | "first-message" | "unsupported"`).
New runtimes must declare one explicitly.

### system-append runtimes

The runner supplies the agent prompt on **every** run of the thread:

- **Claude Code**: Agent SDK
  `systemPrompt: { type: "preset", preset: "claude_code", append: <text> }`.
  The append is per-invocation and does not survive `--resume`, hence the
  every-run rule.
- **Codex** (app-server transport): `developerInstructions` on `thread/start`
  and `thread/resume` carries the agent prompt and thread identity. The runner
  selects built-in plan/default instructions through
  `collaborationMode.settings.developer_instructions: null`; it does not copy
  the persona into that field or replace `baseInstructions`. Protocol probes
  on 0.142.0 and 0.153.4 confirmed that the thread instructions and selected
  mode instructions both reach the model. The thread's initial instructions
  persist with its continuation. Re-passing them on resume remains the runner
  contract. The exec transport uses first-message delivery instead.

Codex mode settings select the mode instructions; thread-level instructions
carry Convoy's persona. Compatibility evidence and plan approval behavior live
in [Codex runtime](cli-codex-runtime.md#proposed-plans-os-1481).

### first-message runtimes

Runtimes with no per-invocation append mechanism deliver the prompt by
prepending it to the prompt text of the **first message of a fresh runtime
session only** (no `continuationId`); the runtime's own transcript carries
it across resumes:

- **opencode**: the server API's per-message `system` field *replaces* the
  default agent prompt and is therefore not used; server-level config
  injection is not per-session. First-message delivery applies.
- **Cursor**: `cursor-agent` print mode has no system-prompt flag and rules
  files would mutate the user's checkout. First-message delivery applies.
- **Codex (`codex exec` transport)**: the non-app-server transport is a
  one-shot subprocess with no per-thread RPC channel, so it delivers the
  prompt first-message style even though the runtime's registry declaration
  is `system-append` (the declaration describes the app-server transport;
  delivery is transport-dependent).

The prepended block is delimited so the model reads it as role instructions,
not task content (the thread-identity line follows the block, see below):

```text
<agent-instructions agent="Reviewer">
...prompt text...
</agent-instructions>

Your Convoy thread ID is <threadId>. Reference it when calling Convoy MCP thread tools about the current thread.

...user message text...
```

If a fresh session is later restarted from scratch (continuation lost), the
same rule re-injects the prompt naturally.

### Thread identity delivery (OS-1223)

Every run also carries the Convoy thread ID into the spawned runtime so
the agent can reference its own thread when calling MCP thread tools:

- **Prompt context**: a one-line identity instruction
  (`threadIdentityInstruction` in
  `apps/cli/src/agent/runtimes/agent-instructions.ts`) rides the same
  channel as the agent prompt — appended after it on system-append
  runtimes (every run), and prepended after the agent block on
  first-message runtimes (fresh sessions only; the thread ID is immutable
  for the thread's lifetime, so the resumed transcript already carries
  it). Unlike the agent prompt, it is injected even when the thread has no
  bound agent.
- **Environment variable**: `CONVOY_THREAD_ID` is set on the spawned
  subprocess for Claude Code, Codex (both transports), and Cursor.
  **Exception — opencode**: the opencode server is a shared long-lived
  process serving multiple threads, so no per-thread env var is possible;
  opencode threads get identity via prompt context only.
- **Profile (OS-2265)**: the bridge sets `CONVOY_PROFILE` in its own
  environment to the profile it connected with, before any runtime starts. Every
  runtime subprocess inherits it, so `convoy` commands an agent runs (such as
  `convoy threads attach`) reach the bridge's backend. A host-exported
  `CONVOY_PROFILE` and path matching do not apply to them. This covers opencode
  too: one bridge process serves one profile.

### Reply attachment delivery (OS-2091)

Every normal run, fresh or resumed, ends its prompt with one line naming the
command that attaches files to the reply:

```text
To attach files (screenshots, logs, generated files) to your reply in this Convoy thread, run: convoy threads attach <threadId> <file...> --message-id <replyId> --session-id <sessionId>. For a chart or table page, attach an .html file with --inline and follow the Convoy skill's inline HTML guide. To report a check, add --check <key> and one of --passed, --warning, --failed or --not-performed (the last three need --note <why>), plus --value <answer> or --artifact <artifactId> when the check asks for one; `convoy threads checks <threadId>` lists the checks.
```

The last sentence (OS-2291) lets a user type "run the checks" with no other
context. Spec: [task-checks.md](task-checks.md#reporting-agent-side).

- `withRunAttachmentInstructions` (`apps/cli/src/agent/runtimes/agent-instructions.ts`)
  adds it after `startRunResponse`, because the reply ID exists only then. Claude's
  stream-json input replaces the text prompt, so the line is also appended to the
  last bootstrap frame.
- Script requests and runtime commands get no line.
- The IDs are selectors, not credentials. The command authenticates with the
  saved `convoy` credentials of the bridge's profile (see Profile above), so it
  assumes an installed CLI on `PATH`.
  No environment variable carries them: the opencode server is shared across threads.

### Delivery invariants

- Identical prompt content is supplied on every run of a thread (or carried
  by the runtime transcript); the effective system prefix of a session never
  changes mid-thread.
- The CLI receives `agentPromptSnapshot` (and agent display name) with the
  claimed thread data; runners read it from run options.
- Threads without a bound agent (or with an empty snapshot) get no agent
  block; only the thread-identity line (OS-1223) is delivered.

## Assignment Automation Integration

- The automation composer dialog preselects and locks the assigned agent in
  the Agent selector; the created thread binds that agent. The locked pill
  renders the agent normally (no muted disabled styling) but never opens —
  the assignment decided the binding — and its option list contains only the
  assigned agent.
- Auto-submit (OS-1131) sets the binding on the created thread through the
  same draft-resolution + submit pipeline the dialog uses (no UI).
- Both automation paths seed the binding directly from the assignment; they
  never re-apply the agent's automation-config pill defaulting on top of the
  already-seeded composer config.
- The first message remains the automation `prompt` composer content
  (slash-command expansion unchanged); the agent prompt travels only via
  prompt delivery.
- Non-automation surfaces (threads workspace, task sidebar composer) get the same Agent selector; assignment automation is no longer
  the only way an agent participates in a thread.

## MCP Thread Creation

- MCP `create_thread` takes an optional `projectAgentId` (OS-1222), binding the
  agent through the same `createThreadCore` guards: same project, not deleted,
  prompt snapshotted at creation. See
  [mcp-server.md](mcp-server.md#create_thread).
- The binding is never inherited from `sourceThreadId`, and the agent's
  automation config is not applied — automation defaults are a web-composer
  concern, so an agent with `workspace: "worktree"` does not implicitly get one.

## Out of Scope

- Changing or removing a thread's agent after creation (including over MCP).
- Agent-authored attribution for messages/comments/artifacts (threads still
  run as the connecting user; the agent is a persona, not an actor).
- `@agent` mentions in message content.
- Delivering `description` or other agent fields to the runtime; only
  `prompt` is delivered.

## Environment guidance, OS-2262

Environment capabilities and tool setup belong to the user's project or environment
instructions. Runtime prompts must not assume browsers or skills are installed.
Convoy supplies thread identity and attachment routing for its own integration,
and forwards user-authored agent prompts.
