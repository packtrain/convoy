# CLI Thread Reasoning-Effort Selection Specification

This document specifies reasoning-effort selection for CLI threads: which runtimes offer it, where it lives in the UI, how it is stored, resolved, and passed to the agent subprocess.

## UI

- Effort lives **inside the CLI selector's per-runtime submenu**, mirroring the Codex desktop app: a "Reasoning" section (radio-style list) above a "Model" section in the same submenu. There is no separate effort dropdown.
- A "Last used" combo section (model + effort, OS-1200) renders on the menu edge nearest the trigger: above the Reasoning section for a menu that opens downwards, below the Model section for one that opens upwards (OS-1899) — see `docs/specs/cli-thread-model-selection.md` ("Selector Structure").
- Selecting an effort selects that runtime and closes the menu, same as selecting a model.
- The composer trigger appends the effort label in muted text when a non-default effort is active (e.g. "GPT-5.5 High"); the default effort adds no suffix.
- Runtimes without an effort catalog show no Reasoning section.

## Catalogs

Effort slots are registry-owned (`apps/web/convex/cli/lib/runtimes/`), provider-agnostic at the schema boundary, validated per runtime:

| Runtime | Slots | Run mapping |
|---|---|---|
| `claude-code` | `default`, `low`, `medium`, `high`, `xhigh`, `ultracode` | Agent SDK `effort` query option (`max` intentionally omitted — model-dependent); `ultracode` sends `effort: "xhigh"` plus `ultracode: true` in the `--settings` JSON (see below) |
| `codex` | `default`, `low`, `medium`, `high`, `xhigh`; GPT-6.2 Astra, 6.2 Sol, GPT-6 Astra, 6.1 Sol, and GPT-6 Sol also offer `max`, `ultra`; GPT-6 Luna also offers `max` | `codex exec -c model_reasoning_effort="<value>"` or app-server `effort` |
| `opencode` | **dynamic per model**: `default` + the selected advertised model's variant keys | `promptAsync({ variant })` |
| `cursor` | **dynamic per model**: `default` + the selected model's tiers (see `docs/specs/cli-cursor-runtime.md`) | `--model` name suffix |
| all others | none | selector hidden |

- `default` means "use the connected machine's configured effort" and never resolves to a run value (no flag/option is sent).
- Unknown stored values never resolve to a run value.

### Claude Code ultracode

- Ultracode is a Claude Code session setting (xhigh effort plus standing multi-agent workflow orchestration), not an Agent SDK effort level. The runner sends `effort: "xhigh"` and merges `ultracode: true` into the single `--settings` JSON that already carries the provider env.
- It needs a Claude Code version that knows the setting (verified on 2.1.281). On a model that does not support it, Claude Code runs at plain xhigh; an older CLI ignores the unknown setting and runs at xhigh too. No per-model gating.

### Codex model-specific efforts

- `gpt-6.2-astra`, `gpt-6.2-sol`, `gpt-6-astra`, `gpt-6.1-sol`, and `gpt-6-sol` offer `max` and `ultra`; `gpt-6-luna` offers `max`. Other models, including `default`, retain the base catalog.
- Support checks and storage normalization without a model accept all known Codex efforts. With a model context, they enforce that model's catalog.
- Run resolution without a model uses the base catalog, so it never sends GPT-6-only efforts to an unknown configured model.
- See `docs/specs/cli-codex-runtime.md` for the catalog sources and transport mapping.

### Dynamic catalogs (OpenCode variants, Cursor tiers)

- Effort hooks accept an optional context (`{ cliModel, availableClis }`); static catalogs ignore it.
- OpenCode's Reasoning section appears only when the active runtime's selected model is a concretely advertised model with variants — the `default` model slot and variant-less models show no section. Cursor's appears only for models with tiers.
- **Validation is context-dependent, and applies at all three points** (support check, option build, run resolution) — a dynamic runtime's `isSupportedEffort` honors the context it is given (OS-1466):
  - **With a model context**, the value must be one the model offers, so a stale effort left over from a model switch is rejected rather than preselected in the pills. OpenCode reads the model's advertised variants; Cursor reads the model's tier list.
  - **Without a model context** (`cliModel` absent), acceptance is lenient: any single non-whitespace token passes. Model and effort are stored separately, so storage normalization never sees a model and must let a per-machine/per-model value round-trip.
  - **OpenCode with an unadvertised model** (offline machine, stale slug, or the `default` slot) is also lenient — no variant list is known and OpenCode is the authority. Run resolution passes the value through for the same reason; for an *advertised* model it drops variants the model does not offer.
- Callers that validate a stored model+effort pair pass that model as context: composer resolution (`resolveChatDetailEffort`, `resolveNewThreadDraftState`), remembered new-thread selections, and favorite combos. Composer callers also pass `availableClis`, which is where OpenCode's variant list comes from — without it an OpenCode model reads as unadvertised and validation stays lenient. Since OS-1721 the variants arrive from the per-profile catalog subscription and are re-attached with `hydrateAvailableClis`, so leniency is also what covers the first render before that query resolves.
- Run resolution on the server (`cliMessages.startRunResponse`) reads the catalog row for the thread's profile + runtime to apply the same guard — the session row no longer carries the variants.

## Storage and Resolution

- `cliEffort` is stored per user message (`cliMessages.cliEffort`), like `cliMode`/`cliModel`; normalized via the registry at write time.
- Drafts persist `cliEffort` per thread; sanitization replaces unsupported values with the runtime default and drops it for effort-less runtimes.
- Active effort resolution mirrors model resolution:
  - New-thread composers: unsent draft effort → remembered effort for the active `cliType` when the selected profile exposes that CLI → runtime default.
  - Existing-thread composers: unsent draft effort → the thread's stored last-used effort (`cliThreads.metadata.cli.lastUsedEffort`) → runtime default.
- The stored last-used effort is denormalized onto the thread at
  user-message-write time (OS-1454). It moves **atomically with the model**: a
  user message that names a `cliModel` replaces both the stored model and the
  stored effort, clearing the effort when that message carries none. Merging
  them independently could leave the thread describing a model+effort pair no
  message ever had, which matters for runtimes with per-model effort variants.
- Composer validation of a stored effort passes the resolved model (and the
  profile's advertised inventory) as context, so a per-model variant is judged
  against the model the composer settled on and a value that model does not
  offer falls through to the runtime default.
- `startRunResponse` resolves the run effort from the latest user message in the run and returns `resolvedCliEffort` to the CLI; the thread processor passes it into the runner unchanged.
- Successful new-thread creation from `/threads` or task-scoped composers — and successful sends in existing threads (OS-1200) — update the remembered effort for the thread's `cliType` when that runtime supports the selected `cliEffort`.

## Related Specs

- Model selection: `docs/specs/cli-thread-model-selection.md`
- Modes: `docs/specs/cli-thread-modes.md`
- Codex runtime: `docs/specs/cli-codex-runtime.md`
- Runtime subsystem layout: `docs/specs/cli-runtime-architecture.md`
