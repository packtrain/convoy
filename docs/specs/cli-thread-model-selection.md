# CLI Thread Model Selection Specification

This document specifies Claude Code model selection behavior for CLI thread composers.

## Scope

- Applies to thread composer surfaces in `apps/web`:
  - `/threads` new-thread composer
  - `/threads/[threadId]` thread detail composer
- Runtime-specific model options remain owned by each CLI runtime.
- OpenCode's model catalog is **dynamic** (advertised per machine, persisted per profile) — see "OpenCode dynamic models" below and `docs/specs/cli-opencode-runtime.md`.

## OpenCode dynamic models

- Options come from the selected profile's advertised catalog: the `default` slot plus every advertised `providerID/modelID` model (labels are the advertised model names).
- The catalog is stored per profile + runtime in `cliRuntimeCatalogs` and read by its own subscription, not carried on `availableClis` (OS-1721). Consumers opt in with `useCliProfiles(projectId, { withModelCatalogs: true })` and re-attach it via `hydrateAvailableClis`; a catalog that has not loaded yet reads as "no models advertised" — the `default` slot only, with remembered selections preserved.
- `availableClis` keeps `models` in its **validator** even though nothing writes it any more: the same validator types `cli.sessions.register`'s argument, and published CLIs still send catalogs. Narrowing the stored shape therefore requires moving the split into the HTTP parser first, or the registration of every older CLI fails argument validation.
- Runtime presence still comes from `availableClis` (freshest online session) → the profile's `lastKnownClis` snapshot (an empty detection never overwrites it), which is what keeps an offline machine selectable.
- Stored values are `default` or a `provider/model` slug; anything else normalizes away. A stored slug that is no longer advertised still resolves to a labeled option (label = model id segment) and runs as-is — OpenCode reports the error if the model is truly gone.
- `default` omits the model from the prompt; OpenCode uses the machine's configured default.

## Related Specs

- Runtime architecture and ownership: `docs/specs/cli-runtime-architecture.md`
- Draft persistence and resolution: `docs/specs/cli-thread-drafts.md`
- Context selector interaction and layout: `docs/specs/cli-thread-context-selectors.md`

## Model Options

- Supported composer options:
  - `default`
  - `sonnet`
  - `sonnet-1m`
  - `sonnet-5-5`
  - `opus-5-5`
  - `opus-5`
  - `fable-5-2`
  - `fable-5-1`
  - `fable`
  - `haiku-5-5`
- Legacy Opus 4.8 slots `opus` and `opus-1m`, `opus-4-7` and
  `opus-4-7-1m`, plus the Haiku 4.5 slot `haiku`, remain valid for stored drafts and messages but are no longer
  offered in the model catalog. Saved favorites and recent selections retain
  their labels and can still be selected; execution mappings stay unchanged.
- `cliModel` stores one of these portable slots in drafts and messages; it does not store provider-specific raw model IDs.
- Trigger label rules:
  - When `default` is selected, the trigger label is `Claude Code`.
  - When a non-default model is selected, the trigger label is the selected model label.
- Model options are exposed as submenu items under `Claude Code` in the CLI selector.
- Claude submenu items do not render model/provider icons.
- The `default` submenu item includes an info tooltip clarifying that it uses the default configured in the user's Claude Code CLI.
- When the selected online Claude runtime reports `provider` metadata, submenu labels should use the server-owned Convoy provider catalog for that provider (for example `Sonnet 5` or `Opus 5.5`).
- When provider metadata is absent or unknown, submenu labels fall back to generic labels (`Sonnet`, `Sonnet (1M)`, `Sonnet 5.5`, `Opus 5.5`, `Opus 5`, `Fable 5.2`, `Fable 5.1`, `Fable 5`, `Haiku 5.5`).
- `Fable 5.2`, `Fable 5.1`, `Fable 5`, `Sonnet 5.5`, `Opus 5.5`, `Opus 5`, and `Haiku 5.5` keep their versioned labels even without
  provider metadata; none has a separate 1M option because the 1M context
  window is the model's default and maximum.

## Codex on AWS (OS-2105)

When the profile's Codex runtime reports `provider: "mantle"` or `"bedrock"`
(see `cli-provider-keys.md` → Codex on AWS Bedrock and Mantle):

- The Codex menu offers only GPT-6 Astra, GPT-6 Sol, GPT-6 Luna and the GPT-5.6
  family (Sol, Terra, Luna), all served by Mantle and Bedrock Runtime. Codex
  0.156.1's own Bedrock catalog lists the GPT-5.6 models and GPT-6 Astra. `Default` is hidden because a machine
  default could be a model the provider does not have.
- Stored slots stay the same. Mantle resolves `gpt-6-sol` to
  `openai.gpt-6-sol`; Bedrock Runtime resolves it to the `global.` inference
  profile `global.openai.gpt-6-sol`. Switching a profile between providers
  keeps drafts, favorites and recents.
- The new-thread composer starts on GPT-6 Sol instead of `default`, both for a
  `default` draft and a remembered `default`. The menu hides `Default`, so it is
  never a choice the user made there. A model the user picked stays.
- On an existing thread, a saved `default` or native-only slot (`gpt-6.1-sol`,
  GPT-5.x) keeps its label but resolves to no run model; the CLI then fails
  the run with "Select a GPT-6 or GPT-5.6 model". Nothing picks a
  replacement silently there.
- Reasoning for these slots stops at `max`, matching Codex's Bedrock catalog
  (codex-cli 0.156.1, `model/list` on both providers); `ultra` is not offered
  or sent. The GPT-5.6 slots get `max` on AWS too, though natively they stop at
  `xhigh`.
- The menu opens with a provider label and region, for example
  `AWS Bedrock (Mantle) · us-east-1`, then the provider's limits ("No Fast mode
  or image generation", plus "hosted web search" on Bedrock Runtime). When the
  selected model cannot run there it adds "Select a supported model to run."
  The trigger tooltip appends the provider label.
- The model mapping lives in `convex/cli/lib/runtimes/codex/models.ts`; no
  catalog table, discovery or extra query is involved.

## Selector Structure (all runtimes)

- Section order follows the side the menu opened on, so the likeliest picks
  land nearest the cursor (OS-1899). The side is Radix's resolved `data-side`
  on the menu content, read from a **callback ref** and watched for changes:
  Radix portals the content in a commit of its own (a mount effect runs before
  the node exists) and resolves the side asynchronously afterwards, flipping
  the attribute then. The menu is parked off-screen until it is positioned, so
  the reorder is never visible. Tests must exercise this against the real
  Radix menu — a stubbed menu renders inline and hides the portal timing.
- A "Favorites" section (OS-1208) holds cross-runtime CLI+model+effort combos
  the user starred, grouped by runtime in selector order and then sorted by
  model label (OS-1919); rows for the same model keep the order they were
  pinned in, so effort variants stay together. The sort is display-only — the
  persisted list keeps insertion order, which is what the cap drops from. The
  section renders at the very top
  of the menu when the menu opens downwards, and at the very bottom — below
  the runtime list, above any host-supplied trailing items — when it opens
  upwards. Each row shows the runtime icon plus the model label
  with a muted effort suffix for non-default efforts; selecting one applies
  CLI type, model, and effort together and closes the menu. Favorite rows and
  "Last used" rows carry a star toggle (filled when favorited) that adds or
  removes the favorite without selecting the row or closing the menu.
  Favorites persist server-side on `userPreferences.cliFavoriteCombos`
  (capped at 20, oldest dropped client-side when toggling past the cap), so
  they follow the user across devices. The preferences query is a single
  shared subscription (same `useUserPreferences` hook pattern as labels and
  lists) — composers never issue per-selector reloads. A favorite whose
  model the runtime registry no longer supports is NOT hidden: it renders
  disabled (raw model/effort values, muted) with a tooltip explaining the
  model is no longer available, and keeps its star so it can be unpinned;
  unsupported efforts on supported models fall back to default like recents.
  Locked existing threads only show favorites for the runtime they are
  locked to; favorites for non-selectable runtimes are hidden.
- A "Last used" section renders inside each runtime's submenu, on the same
  edge as Favorites (OS-1899) — above the Reasoning and model sections for a
  menu that opened downwards, below the models for one that opened upwards —
  when that runtime has remembered model+effort combinations (OS-1200): up to the
  3 most recent unique combos, newest first, labeled with the model label
  plus a muted effort suffix for non-default efforts (e.g. "GPT-5.5 Medium").
  Selecting a combo applies both model and effort and closes the menu. For
  grouped runtimes (OpenCode, Cursor) the section stays at the runtime
  submenu's first level, never inside provider groups. Combos are recorded on
  every successful send — new-thread creation and existing-thread follow-ups
  (same trigger as the remembered model/effort) — and stored in the same
  client-side remembered-selection payload; persisted combos with unsupported
  models are dropped, and unsupported efforts fall back to default.
- A runtime may group its model options into provider sections
  (`CliRuntimeUiDefinition.groupModelOptions`): labeled groups render as
  nested submenus (provider icon + name on the trigger, no icons on model
  rows); unlabeled groups render as plain rows above them. Cursor and
  OpenCode group by provider; Claude Code and Codex keep flat lists.
- Grouped runtimes place a group's Reasoning options above its models
  inside the provider submenu (Cursor); when groups carry no reasoning of
  their own, the selected-model Reasoning section stays at the top of the
  runtime submenu (OpenCode).
- Selecting a Reasoning option does not close the menu, so effort and model
  can be picked in one visit. Selecting a model closes it.
- Model lists longer than 10 options render a "Search models…" filter
  input; a non-empty query flattens the list to matching rows. Known issue
  (OS-1139): Radix menus own focus, so the input only receives keystrokes
  after an explicit click and with the pointer kept off the menu — the
  catalogued focus workarounds failed and must not be retried; the planned
  fix is a cmdk Command surface.
- Menu contents are capped at 70vh and scroll (OpenCode can advertise
  dozens of models).

## Visibility and Interaction Rules

- Model selection is available through the `Claude Code` submenu inside the CLI selector (new-thread composers), or directly as the top-level selector menu in locked existing threads.
- In new-thread composers, model selector is editable whenever the composer is enabled.
- In existing-thread detail, profile/path remain locked and the CLI selector lists no other CLI types; opening it shows the active runtime's model/effort options directly, editable for the next outgoing message.
- When composer submit is pending, the CLI selector is disabled alongside the other composer controls.

## Persistence and Resolution Rules

- Draft storage persists `cliModel` for new-thread and existing-thread drafts.
- Convoy also persists a separate global client-side remembered selection for fresh new-thread composers, keyed by `cliType`, containing the last supported model and effort alongside the last-used `cliType` (`lastCliType`).
- New-thread composer `cliType` resolution:
  1. Valid persisted draft `cliType`
  2. Remembered last-used `cliType`, but only when the selected profile exposes that CLI in `availableClis`
  3. `claude-code` fallback
- New-thread composer resolution:
  1. Valid persisted draft `cliModel`
  2. Remembered model for the active `cliType`, but only when the selected profile exposes that CLI in `availableClis`
  3. Default model for that `cliType`
- Existing-thread composer resolution:
  1. Valid unsent draft `cliModel` for that thread
  2. The thread's stored last-used model (`cliThreads.metadata.cli.lastUsedModel`)
  3. Default model for that `cliType`
- The stored last-used model is denormalized onto the thread at
  user-message-write time (OS-1454), not scanned out of the message list, so
  the composer's pills are correct on the first frame and stay correct once
  older messages page out of the loaded window. A stored model the runtime no
  longer supports (a retired slot on an old thread) falls straight through to
  the default rather than skipping back to an older message's model.
- Assistant messages do not affect future model preselection.
- Successful existing-thread sends update the remembered selection (last-used
  `cliType`, model, effort, and combos) the same way new-thread creation does
  (OS-1200): "last used" reflects what actually ran. Model/effort changes
  without a send still update nothing.

## Execution Rules

- User messages persist the selected `cliModel`.
- A `send` that names no `cliModel` inherits the thread's stored last-used
  selection at write time (OS-1894): model and effort as a pair from
  `metadata.cli` (a caller naming a model keeps its own model+effort), and
  `cliMode` independently. Agent senders (MCP `send_thread_message`, `convoy
  threads send`) pass no selection, and run resolution reads only the latest
  user message — without inheritance those follow-ups would run the runtime's
  own default model instead of the thread's. The composer is unaffected: it
  always sends an explicit slot, with `default` as the literal `default` slot.
- Successful new-thread creation from `/threads`, and successful sends in existing threads, always update the remembered last-used `cliType`, update the remembered model for that `cliType` only when that runtime supports the selected `cliModel`, and update the remembered effort for that `cliType` only when that runtime supports the selected `cliEffort`.
- If the selected profile does not expose the current `cliType`, remembered fallback is ignored and composer resolution falls back to that runtime's default model.
- Run execution resolves `cliModel` from the latest user message in the run.
- Server-side run-model resolution dispatches by `cliType` through the shared runtime registry in `apps/web/convex/cli/lib/runtimes/registry.ts`, with Claude-specific backend details owned by `apps/web/convex/cli/lib/runtimes/claudeCode/`.
- `default` means Convoy omits the Claude CLI model flag.
- The CLI resolves portable model slots into the final `claude --model <value>` argument.
- Claude runtime/provider detection happens in the connected CLI process at `convoy connect` time and stores only provider metadata in session `availableClis`.
- Providers are `anthropic`, `bedrock`, `mantle`, or `unknown`. Mantle proxies Bedrock and sets the same Bedrock env flags/token, so detection checks `CLAUDE_CODE_USE_MANTLE` **before** any Bedrock check.
- For each env variable, detection mirrors Claude Code's own layering, so the detected provider matches the backend the spawned agent actually talks to: the injected profile provider-key env (see `docs/specs/cli-provider-keys.md`, re-sent through `--settings`, which outranks user settings) wins, then Claude settings `env`, then the inherited process env. Trusting process env first misreports a machine whose settings file enables Bedrock/Mantle over inherited opt-out flags — e.g. the devcontainer, which forwards the host's `CLAUDE_CODE_USE_*` flags into a container with its own `~/.claude/settings.json`.
- An explicit `CLAUDE_CODE_USE_BEDROCK` value other than `1` (e.g. `0`) resolves to `anthropic` and suppresses the heuristics below: Claude Code ignores a stored Bedrock token unless the flag enables it, so a kept-around `AWS_BEARER_TOKEN_BEDROCK` or `us.anthropic.*` default model must not misreport the provider as `bedrock`.
- Only when no `CLAUDE_CODE_USE_BEDROCK` flag is set at all do the heuristics apply: a non-empty `AWS_BEARER_TOKEN_BEDROCK` (process env or settings `env`) or a settings default model starting with `us.anthropic.` resolves to `bedrock`.
- For known providers (`anthropic`, `bedrock`, `mantle`), Convoy owns the exact non-default Claude model strings and resolves them from the provider-specific catalog.
- Mantle uses the Bedrock model names **without** the `us.` cross-region prefix (e.g. `anthropic.claude-opus-4-8` instead of `us.anthropic.claude-opus-4-8`); its catalog is derived from the Bedrock one by stripping that prefix, with per-slot overrides for IDs that do not follow that rule. Haiku is one such override: Bedrock's `us.anthropic.claude-haiku-4-5-20251001-v1:0` maps to Mantle's short alias `anthropic.claude-haiku-4-5`.
- Alias slots track the latest model of their family in the provider catalogs:
  - `sonnet` / `sonnet-1m` -> Claude Sonnet 5 (`claude-sonnet-5`, `claude-sonnet-5[1m]`; Bedrock `us.anthropic.claude-sonnet-5`, `us.anthropic.claude-sonnet-5[1m]`)
  - `opus` / `opus-1m` -> Claude Opus 4.8 (`claude-opus-4-8`, `claude-opus-4-8[1m]`; Bedrock `us.anthropic.claude-opus-4-8`, `us.anthropic.claude-opus-4-8[1m]`)
- `sonnet-5-5` resolves to Claude Sonnet 5.5: `claude-sonnet-5-5` for
  Anthropic, `us.anthropic.claude-sonnet-5-5` for Bedrock, and
  `anthropic.claude-sonnet-5-5` for Mantle. It requires Claude Code 2.1.284 or
  later. The `sonnet` alias slots keep their Sonnet 5 mappings. There is no
  separate 1M slot because Sonnet 5.5 already supports 1M context.
  Source: [model configuration](https://code.claude.com/docs/en/model-config).
- `haiku-5-5` resolves to Claude Haiku 5.5: `claude-haiku-5-5` for
  Anthropic, `us.anthropic.claude-haiku-5-5` for Bedrock, and
  `anthropic.claude-haiku-5-5` for Mantle. It requires Claude Code 2.1.293 or
  later. The retired `haiku` alias slot keeps its Haiku 4.5 provider mappings. There
  is no separate 1M slot because Haiku 5.5 already supports 1M context.
  Sources: [model configuration](https://code.claude.com/docs/en/model-config),
  [model IDs](https://platform.claude.com/docs/en/models/haiku-5-5/overview).
- `opus-5-5` resolves to Claude Opus 5.5: `claude-opus-5-5` for Anthropic,
  `us.anthropic.claude-opus-5-5` for Bedrock, and
  `anthropic.claude-opus-5-5` for Mantle. It requires Claude Code 2.1.280 or
  later. Default effort omits the override, allowing runtime settings and the
  model's medium default to apply. Existing Opus slots keep their mappings.
  There is no separate 1M slot because Opus 5.5 already supports 1M context.
  Sources: [model configuration](https://code.claude.com/docs/en/model-config),
  [Bedrock model IDs](https://code.claude.com/docs/en/amazon-bedrock).
- `opus-5` resolves to Claude Opus 5 (`claude-opus-5`; Bedrock `us.anthropic.claude-opus-5`, Mantle `anthropic.claude-opus-5`).
- `fable-5-2` resolves to Claude Fable 5.2: `claude-fable-5-2` for Anthropic,
  `us.anthropic.claude-fable-5-2` for Bedrock, and
  `anthropic.claude-fable-5-2` for Mantle. It requires Claude Code 2.1.321 or
  later. `fable-5-1` and `fable` keep their mappings, so stored selections run
  what they ran. There is no separate 1M slot because 1M is Fable 5.2's
  default context window.
  Source: [model configuration](https://code.claude.com/docs/en/model-config).
- `fable-5-1` resolves to Claude Fable 5.1 (`claude-fable-5-1`; Bedrock `us.anthropic.claude-fable-5-1`, Mantle `anthropic.claude-fable-5-1`).
- `fable` resolves to Claude Fable 5 (`claude-fable-5`; Bedrock `us.anthropic.claude-fable-5`).
- Legacy `opus-4-7` and `opus-4-7-1m` slots keep resolving to Claude Opus 4.7:
  - Anthropic: `claude-opus-4-7`, `claude-opus-4-7[1m]`
  - Bedrock: `us.anthropic.claude-opus-4-7`, `us.anthropic.claude-opus-4-7[1m]`
- When provider metadata is absent or unknown, the CLI falls back to the portable Claude string for alias slots (`sonnet`, `sonnet[1m]`, `opus`, `opus[1m]`, `haiku`) and to the explicit Anthropic-compatible names for versioned slots (`claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-opus-5-5`, `claude-opus-5`, `claude-fable-5-2`, `claude-fable-5-1`, `claude-fable-5`, `claude-opus-4-7`, `claude-opus-4-7[1m]`).

## QA Checklist

- `/threads` exposes Claude model options from the `Claude Code` submenu.
- Fresh `/threads` composers reuse the remembered model and effort for the active CLI when no `new` draft value exists and the selected profile exposes that CLI.
- `/threads/[threadId]` reuses draft model, then the thread's stored last-used model, then `default`, with no visible snap from the default on first paint.
- Switching to a profile that does not expose the active CLI ignores remembered fallback and uses that runtime's default model.
- Existing-thread model changes without a send do not affect fresh new-thread model preselection; a successful send in that thread updates it.
- Selected online profiles with Claude provider metadata show provider-aware submenu labels.
- Missing or unknown provider metadata falls back to generic submenu labels.
- Ongoing Claude threads keep the CLI selector interactive while disabling all non-current CLI types.
- `default` sends no explicit model flag.
- `sonnet-1m` maps to the provider-specific exact Sonnet 5 1M model when the provider is known, otherwise to `sonnet[1m]`.
- `opus-1m` maps to the provider-specific exact Opus 4.8 1M model when the provider is known, otherwise to `opus[1m]`.
- `sonnet-5-5` maps to the exact provider model and preserves its label without provider metadata.
- `haiku-5-5` maps to the exact provider model and preserves its label without provider metadata.
- `opus-5-5` maps to the exact provider model, preserves its label without provider metadata, and remains selected after reload or a workflow launch.
- `opus-5` maps to the provider-specific exact Claude Opus 5 model when the provider is known, otherwise to `claude-opus-5`.
- `fable-5-2` maps to the exact provider model and preserves its label without provider metadata.
- `fable-5-1` maps to the provider-specific exact Claude Fable 5.1 model when the provider is known, otherwise to `claude-fable-5-1`.
- `fable` maps to the provider-specific exact Claude Fable 5 model when the provider is known, otherwise to `claude-fable-5`.
- Legacy `opus-4-7` / `opus-4-7-1m` map to the provider-specific exact Opus 4.7 models when the provider is known, otherwise to `claude-opus-4-7` / `claude-opus-4-7[1m]`.
