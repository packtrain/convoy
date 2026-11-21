# Cost Tracking (OS-1132)

Pre-aggregated agent spend (USD + tokens per model) derived from CLI thread
runs, attributable per thread, per task, per project, per team member, per
CLI type, grouped by UTC day (months are sums of days).

## Data model

Two tables (`convex/schema.ts`), written from the same event:

- `costRollups` — one row per `(projectId, userId, taskId?, cliType,
  dayStartMs)`. Deliberately has **no thread dimension** so project/task
  range reads stay bounded by (users × tasks × cliTypes × days) regardless
  of how many threads ran.
- The schema may temporarily tolerate a deprecated optional `threadId` on
  `costRollups` during migration windows only; production code must not write
  or read that field. Run `migrations.clearLegacyCostRollupThreadIds` before
  narrowing the schema back to the canonical shape.
- `threadCostRollups` — one row per `(threadId, dayStartMs)`; read only by
  the thread cost summary, so that scan is bounded by the thread's active
  days.
- `taskId` unset means the thread was not attached to a task; the spend still
  counts toward project/member totals but never appears in any task grouping.
- `costUsd` is the sum of known USD contributions; `costMetadata` describes
  its source and completeness. `byModel[]` embeds the
  per-model breakdown (`model`, `inputTokens`, `cachedInputTokens`,
  `outputTokens`, `costUsd`); the array is bounded (a run rarely uses more
  than a couple of models). Token totals are always derived by summing
  `byModel` — there are no duplicate top-level token fields.
- `inputTokens` means **uncached input** in every runtime's entry; extractors
  whose source counts embed the cache read (Codex) subtract it. Optional
  `cacheReadTokens`/`cacheWriteTokens` split `cachedInputTokens` where the
  runtime reports it — cache read and write are priced differently, so
  pricing needs the split; `cachedInputTokens` stays the combined display
  total. Retain whichever splits Claude or OpenCode reports. Supported Codex payloads report cache reads and may
  report writes; retain absent writes as unknown. Both split fields are absent
  when only the combined total is known.
- `runCount` counts runs, not cost events: a run's first cost event carries
  `runCount: 1` and stamps `costRecordedAt` on the assistant message; later
  usage-bearing batches of the same run merge tokens with `runCount: 0`.
  Without this, runtimes that stream usage mid-run (Codex app-server emits
  `thread/tokenUsage/updated` per model call, OpenCode per step) over-count.
  Runs that report no usage are never counted. Retry deletes the assistant
  message, so a retried run counts again — matching its re-spent tokens.
- `dayStartMs` is UTC midnight (`ts - ts % 86_400_000`). UTC keeps buckets
  stable across viewers with no timezone storage; a viewer's local "today"
  can straddle two buckets. Month grouping happens client-side from the
  daily buckets (`lib/costs/cost-summary.ts`).
- Dedicated table (not counters on `tasks`/`projects` docs) so frequent cost
  writes don't invalidate hot-document subscribers (same rationale as
  `taskRefCounters`).

Indexes: `costRollups.by_project_user_task_cliType_day` (upsert identity),
`by_project_and_day` (project summaries), `by_task_and_day` (task
summaries); `threadCostRollups.by_thread_and_day` (upsert identity + thread
summaries).

## Recording pipeline

1. Runtimes report spend in their terminal stream chunks. Extraction is a
   per-runtime capability (`extractCostUsageFromChunks`) on the runtime
   registry (`convex/cli/lib/runtimes/registry.ts`), implemented per runtime
   in `<runtime>/costUsage.ts`:
   - **Claude Code** — `result` chunks. `total_cost_usd` is cumulative for
     the Claude process; each run starts a fresh forked process, so only the
     **last** result chunk of an append call is used (never summed). Prefers
     the `modelUsage` map (per-model tokens + `costUSD`); falls back to the
     aggregate `usage` object under model `"unknown"`. If a future streaming
     mode reuses one process across runs, this needs delta handling.
     An entry with `provider: "bedrock"` or `"mantle"` and `costBasis: "list"`
     was priced at Claude Code's built-in list rates, which miss the AWS geo
     and Mantle uplift. When the catalog has its AWS row (the model ID, or
     `bedrock_mantle/<id>` for Mantle) the entry is recorded under that key as
     unreported and estimated, and the event total becomes the model sum.
     `managed` (org-set) prices and IDs without an AWS row stay as reported.
     Only this re-keying drops the reported total; an entry that merely lacks
     `costUSD` leaves a valid `total_cost_usd` authoritative.
   - **OpenCode** — `step-finish` parts inside `message.part.updated` chunks
     carry per-step `tokens` and `cost` (USD). Snapshots are deduplicated by
     part id (last wins) and summed. OpenCode has no per-model payload; the
     resolved run model attributes the total.
   - **Codex** reports tokens, with `costUsd: 0` and `reportedCost: false`. Both exec
     `turn.completed.usage` and app-server `thread/tokenUsage/updated.total`
     are cumulative thread snapshots. Diff each snapshot against the optional
     `cliThreads.codexUsageCursor`, persisted through `cliThreadsRepo`.
     Keep each positive delta as its own extraction entry until cost resolution.
     Processing snapshots in order also preserves usage on both sides of a
     counter reset. A known different continuation starts a new baseline;
     learning a previously absent ID adopts it without recounting usage.
     Preserve a known ID if a later batch omits it.
     App-server `last` can repeat on resume and compaction, so it must not be
     summed. `turn/completed` alone carries no usage.
     The CLI tags usage notifications received before the current turn starts
     with `convoyUsageBaseline: true`. These replayed resume totals seed the
     cursor without recording historical usage again.
     Zero/reset and repeated snapshots still persist the cursor, but an empty
     `byModel` neither schedules a rollup nor stamps `costRecordedAt`.
     A falling cumulative category starts a new counter baseline; this is a
     defensive reset rule, not support for older per-turn protocols. Captured
     compaction keeps cumulative categories unchanged or increasing.
     Subtract cache reads and reported cache writes from inclusive input.
     Combined cached input is read plus write. Reasoning is already inside
     output and is not added again. Preserve absent cache-write fields as
     unknown. Missing required input/read/output counters or malformed payloads
     leave accounting and the cursor unchanged.
   - **Antigravity** records nothing. Its prompt result carries tokens, but
     the pricing catalog has no Gemini models and agy bills by subscription
     (OS-2481 owns estimates).
   - Runtimes without the capability (generic types) record nothing.
2. `appendRunContent` (`convex/cli/messages.ts`, assistant branch) calls the
   registry extractor and, when spend is found, schedules
   `internal.costs.core.recordUsage` with delay 0 — cost accounting never
   blocks or fails the streaming hot path (same pattern as task activity
   logging). Dimensions come from the already-loaded thread: `projectId`,
   `userId` (thread owner), `associatedTaskId`, the thread's own id, plus the
   message's `cliType` and resolved run model.
3. `recordUsage` (internal mutation, `convex/costs/core.ts`) upserts both
   grains from the one event — the coarse daily row
   (`upsertDailyCostRollup`) and the thread-grain row
   (`upsertDailyThreadCostRollup`) — summing `costUsd` and merging `byModel`
   by model id.

## Codex protocol evidence and support boundary

Token accounting is verified for **Codex 0.153.4** and cumulative payloads
compatible with that version. This is the minimum version supported by this
accounting contract, not a claim that cumulative usage first appeared there.
Execution can still run older binaries under the runtime's transport rules,
but older per-turn token accounting is outside this contract. Counters alone
cannot distinguish cumulative `100, 150` from two per-turn values of the same
size. Do not infer the protocol from an increase, equality, or decrease.
Supporting older accounting requires explicit version/capability routing.

`apps/web/convex/cli/lib/runtimes/codex/costUsage.fixtures.json` contains
usage-only captures from the installed `codex-cli 0.153.4` on 2026-09-18.
A loopback HTTP provider supplied deterministic Responses SSE events; these
are actual Codex output, not live OpenAI billing observations. Thread and turn
IDs were replaced with stable labels. The capture procedure was:

1. Configure a temporary custom `model_provider` with `wire_api = "responses"`,
   a loopback `base_url`, and `requires_openai_auth = false`. Run in a temporary
   directory, with web search disabled. No paid model requests are needed.
2. For response number N, send `response.created`, `response.output_item.added`,
   `response.output_item.done`, and `response.completed`. The completion usage
   is `input_tokens: 100*N`, `input_tokens_details.cached_tokens: 40*N`,
   `input_tokens_details.cache_write_tokens: 10*N`, `output_tokens: 20*N`,
   `output_tokens_details.reasoning_tokens: 5*N`, and `total_tokens: 120*N`.
   Response 1 contains an `exec_command` call to `echo fixture`. Later responses
   contain an assistant message. The sandbox denied that tool invocation, but
   Codex continued to response 2, giving two model calls in the first turn.
3. For app-server, initialize, start a thread and turn, resume that thread and
   run another turn, call `thread/compact/start`, then run one more turn.
   Capture `thread/tokenUsage/updated` params. Resume repeats the prior `last`;
   compaction repeats it again, adds the compaction call, then replaces `last`
   with context-size metadata while preserving cumulative categories.
4. For exec, run `exec --json`, then `exec --json resume <id>`. Captured totals
   are 300 then 600 input, confirming cumulative behavior across processes.

A second capture omitting provider cache writes produced explicit zero write
counters. Tests separately cover absent fields for older payload compatibility.
Counter resets, late IDs, and malformed events are labeled synthetic tests;
the captured compaction does not reset cumulative usage. Official protocol
entry point: [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

The resume-baseline marker requires Convoy CLI **0.56.3**. Deploy the backend
before upgrading the CLI. Existing exec cursors remain valid. Old cursors have
no cache-write baseline, so the first delta preserves an unknown write split
and seeds it for subsequent deltas. An older CLI resuming an app-server thread
without a stored cursor cannot distinguish historical from new usage. Upgrade
that CLI before resuming such threads; repairing existing totals belongs to
OS-1532. Imported exec histories without a cursor have the same limitation.
This change does not backfill, repair, or reprice historical rollups.

## Codex model attribution, OS-1529

Convoy CLI 0.57.0 adds `model` to the synthetic app-server `thread/started`
params alongside `thread: { id }`. The model is the explicit resolved turn
override when present, otherwise the model returned by `thread/start` or
`thread/resume`. The startup event precedes turn usage. A missing model field
remains valid for older CLIs and servers.

`cliMessages.codexModelState` stores the assistant run's model evidence,
evidence source, current turn ID, and whether usage spans a model change.
Message responses expose its model as `resolvedCliModel` for the run-details
popover, which prefers it over the configured slot. Startup-only batches
persist this state without recording usage. Later
appends pass it to the pure Codex extractor, independently of the thread's
cumulative usage cursor. Configured `cliModel` slots are never overwritten.
A fresh assistant message starts without inherited model state, including on
resume and retry. A runtime fact observed on another run or machine is not
model evidence for this run.

Precedence is a confirmed `model/rerouted` destination, then the startup
model chosen by the CLI, then the explicitly resolved configured model for
legacy app-server or exec. Exec `default`, unknown slots, and absent evidence
retain tokens under `unknown`. No pricing happens in the extractor.

Model notifications and usage are processed in stream order. The runner only
forwards `model/rerouted` for its active thread and turn; replayed old-turn
notifications on resume are ignored. The backend also ignores changes whose
known thread or turn differs. A reroute has no cumulative token boundary, so
the next positive usage delta may contain work from both models. Record that
whole crossing interval under `unknown`, then use the confirmed destination
for later deltas. Zero, repeated, malformed, and resume-baseline snapshots do
not consume this ambiguity marker. Multiple reroutes before a positive delta
leave it ambiguous. The marker survives append boundaries. Already recorded
usage retains its original attribution, and repeated startup metadata cannot
override runtime model evidence.

The event shape was checked against the installed Codex 0.153.4 protocol via
`codex app-server generate-ts`. Tests use a local fake app-server and backend
append integration to cover startup/usage batch separation, explicit overrides,
resume, retry, reroutes, legacy events, and both rollup grains. No paid model
requests are required. Deploy the additive backend field before upgrading to
CLI 0.57.0. Existing runs without evidence stay unknown until they receive
reliable metadata; there is no historical model backfill. OS-1530 consumes this
attribution together with pricing and source/completeness metadata.

## Baseline pricing catalog, OS-1528

`convex/costs/lib/pricing/catalog.json` is a checked-in, pruned LiteLLM
snapshot. Convex never fetches prices at runtime. The current snapshot uses
[upstream revision 5231680](https://github.com/BerriAI/litellm/blob/52316808d9befffe79c099f834d97e09c8358a26/model_prices_and_context_window.json),
retrieved on 2026-11-17. It contains 112 direct OpenAI and Anthropic model
entries and 144 AWS Bedrock entries. This revision (OS-2420) adds GPT-6.2
Astra and Sol (direct, `global.`, `us.` and Mantle rows), `gpt-6.2-astra-law`,
Mythos 5.2, Bedrock GPT-5.6 Cyber, and Mantle rows for older Claude models.
Upstream also added the 10% Mantle uplift to Haiku 4.5; every other prior rate
is unchanged. The previous revision (31a9a99, 2026-11-09) added Fable 5.2,
GPT-6.1 Terra, `gpt-6-astra-law`, `gpt-6-cyber`, `gpt-6-rosalind`, and Bedrock
Mythos 5.2 rows; every prior rate is unchanged. Upstream `alias_of` pointer
rows (`claude-fable-latest`) carry no rates and are skipped. An earlier
revision (f81e657, 2026-10-16) added `gpt-5.5-cyber-preview` and the Bedrock
rows, and 46d440a (2026-10-07) added Haiku 5.5.
Upstream also corrected the Sonnet 5.5 cache read rate; every other rate is
unchanged. An earlier refresh (Sonnet 5.5) dropped 13 retired models
that upstream had removed (Claude 3.x, Opus 4 and 4.1, dated Sonnet 4, early
GPT-4 previews, and `codex-mini-latest`), so they remain unpriced. The refresh retains chat/responses models in the `claude-`, numbered
`gpt-`, numbered `o`, and `codex-` families. It excludes vendor paths,
fine-tunes, audio, realtime, search, and non-text endpoints.

Format `v2` (OS-2105) also keeps AWS rows for Claude and GPT models:
`global.`, `us.`, `eu.`, `apac.`, `au.` and `jp.` inference profiles
(`bedrock_converse`) and `bedrock_mantle/<id>` (Mantle). These carry AWS
on-demand Standard tier rates: global matches the direct API, geo profiles and
Mantle add 10%. AWS's pricing page renders its tables client-side, so the
rates come from LiteLLM; the 10% geo premium matches what that page shows for
models it lists in full. Region-pinned spellings (`us-gov.`,
`bedrock/<region>/`, `bedrock_mantle/<region>/`) and in-region bare IDs are
not kept.

Metadata records the immutable source URL, full revision, source SHA-256,
retrieval date, snapshot version, `USD/token` units, and tariff basis
`standard-short-context-api-equivalent`. The format/selection version is
`v2`; change that version when changing the catalog's derivation rules.

This is a standard short-context API-equivalent estimate. It does not predict
subscription spending or invoices. Base text-token fields exclude batch,
flex/priority tiers, long-context surcharges, regional/provider uplifts,
account discounts, tools, and non-token fees. The AWS rows are the exception:
their geo and Mantle uplift is part of the row. Cache writes use the base
upstream write rate, excluding extended cache TTL rates. Do not choose a
long-context tariff from tokens aggregated across calls or runs.

`resolveModelPricing` checks exact catalog keys before the explicit
`modelAliases` map in `resolution.ts`. The initial aliases cover:

- `openai/gpt-6.2-astra`, `openai/gpt-6.2-sol`, `openai/gpt-6-astra`,
  `openai/gpt-6.1-sol`, `openai/gpt-6-sol`,
  `openai/gpt-6-luna`, and `openai/gpt-5.3-codex`.
- Codex's Mantle model IDs `openai.gpt-6.2-astra`, `openai.gpt-6.2-sol`,
  `openai.gpt-6-astra`, `openai.gpt-6-sol`,
  `openai.gpt-6-luna` (OS-2105) and `openai.gpt-5.6-sol`, `-terra`, `-luna`
  resolve to their `bedrock_mantle/` rows. Its
  Bedrock Runtime profiles (`global.openai.<model>`, `us.openai.<model>`) are
  catalog rows themselves. A test asserts that every AWS run model the Codex
  catalog can send resolves to an AWS row. GPT-6.1 Sol uses $2
  input, $10 output, $0.10 cache read, and $2.50 base cache write per
  million tokens. These match the [official rates](https://developers.openai.com/api/docs/models/gpt-6.1-sol).
  GPT-6.2 Sol has the same rates. GPT-6.2 Astra uses $8 input, $40 output,
  $0.40 cache read, and $10 base cache write per million tokens (LiteLLM).
- `anthropic/claude-fable-5-2` and `anthropic.claude-fable-5-2`. Fable 5.2 uses $8 input,
  $40 output, $0.20 cache read, and $10 base cache write per million tokens.
  Source: [pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- `anthropic/claude-opus-5-5` and `anthropic.claude-opus-5-5`. Opus 5.5 uses $4 input, $20 output,
  $0.20 cache read, and $5 base cache write per million tokens.
  These match the [official rates](https://platform.claude.com/docs/en/models/opus-5-5/overview).
- `anthropic/claude-sonnet-5-5` and `anthropic.claude-sonnet-5-5`. Sonnet 5.5 uses $2 input,
  $10 output, $0.10 cache read, and $2.50 base cache write per million tokens.
- `anthropic/claude-haiku-5-5` and `anthropic.claude-haiku-5-5`. Haiku 5.5 uses its
  short-context rates: $0.10 input, $0.50 output, $0.01 cache read, and
  $0.125 base cache write per million tokens. Prompts over 100k tokens cost
  5x more and are not modeled.
  These match the [official rates](https://platform.claude.com/docs/en/models/haiku-5-5/overview).
- `anthropic/claude-sonnet-5` and `anthropic.claude-sonnet-5`.
- `anthropic/claude-sonnet-4-5-20250929`,
  `anthropic.claude-sonnet-4-5-20250929-v1:0` and
  `vertex_ai/claude-sonnet-4-5@20250929`.

Other aliases identify the direct API baseline and do not apply a vendor's
billable tariff. Bare `anthropic.` IDs are in-region Bedrock spellings; they
keep the direct rate. There is no general prefix, region, or date stripping.
Unknown IDs and `default` remain unpriced. Every current Codex model slot has
an explicit coverage assertion. GPT-6.2 Astra/Sol, GPT-6 Astra/Sol/Luna, GPT-6.1 Sol, GPT-5.6 Sol/Terra/Luna, GPT-5.5,
GPT-5.4, and GPT-5.4 Mini have prices. Spark has no direct priced entry in
this snapshot. Its `chatgpt/` entry has no token rates, so it remains unpriced.

`estimateTokenCost(model, quantities)` accepts four disjoint categories:
`input` means uncached input, `cacheRead` and `cacheWrite` are separate,
and `output` includes reasoning tokens already counted by the runtime.
Quantities must be explicit nonnegative safe integers. A missing cache rate
falls back to the input rate and appears in `fallbackCategories`. Zero rates
remain zero. A missing quantity stays unknown, even with a zero rate; never
pass the combined `cachedInputTokens` as both cache categories or infer an
absent split to be zero. Known zero quantities need no rate.

A complete result has `status: "priced"`, `costUsd`, per-category costs,
resolved model key, exact/alias match, snapshot version, tariff basis, and
fallback categories. Unknown models, missing quantities or rates, invalid
numbers, and arithmetic overflow return `status: "unpriced"` with a reason.
Incomplete results expose missing categories and known category costs but
have no total `costUsd`, so partial costs cannot masquerade as complete.

Refresh from the repository root with an immutable upstream commit and an
explicit retrieval date:

```bash
pnpm exec tsx apps/web/scripts/refreshModelPricing.ts <full-commit-sha> <YYYY-MM-DD>
```

An optional third argument reads a downloaded source file for offline
reproduction. The operator must obtain that file from the pinned source URL;
the script records its hash and does not authenticate an offline file against
GitHub. Output is deterministic for identical source bytes, revision, and
date. The script validates the source shape and all selected rates before
writing a temporary file beside the destination, then renames it atomically.
Download, parse, or validation failure leaves the prior catalog intact.
Review the resulting diff and coverage tests before accepting a refresh.

OS-1530 calls this pure lookup when runtime cost is absent and
model attribution plus required quantities are known. Catalog
refreshes never reprice historical rows.

## Cost resolution and compatibility, OS-1530

Amounts below $1 display up to four decimal places so small follow-up costs remain
visible after a thread crosses one cent. Exact cent amounts keep two places;
amounts below one cent keep four. Zero and amounts at least $1 retain
two decimal places. Display rounding never changes stored costs. OpenCode
follow-ups add each step's cost and count each run once; context snapshots
do not add cost or increment run counts.

Runtime extraction includes `reportedCost` at event and model contribution
level. `true` means the runtime supplied a finite nonnegative amount, including
zero. `false` means no valid amount was supplied. Absence is reserved for legacy
scheduled events and keeps their existing numbers without estimating them.
Claude preserves aggregate-only results. OpenCode retains individual step
contributions until recording so a reported step does not mask an unpriced
step using the same model. Missing input/output quantities set
`quantitiesIncomplete`; absent cache splits remain absent. Neither can be
repaired by substituting zero for estimation.

`recordUsage` resolves the event asynchronously before writing both grains:

- A reported event total is authoritative. Preserve it, price no missing model
  allocations, and mark allocation incomplete if model costs are missing,
  unknown, or do not sum to that total.
- Otherwise preserve reported model amounts and estimate missing amounts only
  when all disjoint categories and the model are known. Sum known
  contributions and retain unpriced entries with their tokens.
- A thrown resolver error retains the affected contribution as unpriced. It
  cannot interrupt streaming because resolution runs in the scheduled mutation.
- Model entries merge after resolution, preventing mixed steps or Codex deltas
  from losing cost presence or complete pricing quantities. A legacy Codex cursor without
  a cache-write baseline leaves only its first delta unpriced; later complete
  deltas can be estimated even within the same append. Cache split totals
  remain unknown if any merged contribution lacks that split. Run counting remains independent of pricing availability.

The shared pure `costMetadataValidator` lives in
`convex/lib/contracts/validators.ts`. It carries independent booleans
`hasReported`, `hasEstimated`, `hasUnpriced`, and `hasLegacy`, plus
`modelAllocationIncomplete`. All-unpriced usage has no known cost, even though
its numeric sum is zero. Reported zero is a known zero. Legacy provenance
means source and completeness are unknown; neither positive nor zero historical
amounts establish a source. No evidence is inferred from the amount.

Every contribution under model `unknown` marks model allocation incomplete,
including reported, estimated, unpriced and mixed event paths. Adding an
unpriced contribution cannot make unknown attribution complete.

A reported aggregate can have complete total coverage and incomplete model
allocation. In that case its total metadata has `hasReported: true` and
`hasUnpriced: false`; model entries without allocated cost remain unpriced.
For totals without an authoritative aggregate, $10 reported plus $2 estimated
has both source flags, while $10 reported plus unpriced usage keeps $10 and
`hasUnpriced: true`. Flags combine with logical OR in every rollup and query.
An empty aggregation starts with all flags false; an actual legacy row with
absent metadata contributes `hasLegacy: true` and incomplete model allocation.

Estimates store `pricingSnapshot` and `tariffBasis`. Equal values remain equal;
a single value survives contributions without estimates; differing values
merge to the literal `mixed`, which remains mixed on future merges. These
bounded fields avoid growing a version list on long-lived rollups.

Metadata appears on model, day, member, CLI, task, thread and project totals,
on prior-period totals as `prevCostMetadata`, and on daily model chart entries.
Client model shares and month sums retain it. The shared UI wording and comparison rules are defined below.

Extraction uses `extractedCostModelUsageValidator` and
`extractedCostUsageValidator`. Its `reportedCost` and `quantitiesIncomplete`
fields are not part of the stored model shape. `toCostModelUsage` explicitly
projects both new and legacy contributions before recording. Extraction inputs
exclude `costMetadata`; only the recorder derives provenance. Every legacy
event's model entries receive legacy metadata, regardless of extra properties
on an in-memory input.

All persisted metadata and scheduled mutation presence arguments are optional.
Old rows and already-scheduled calls remain valid. Reading or merging legacy
rows preserves historical amounts and marks unknown provenance; no backfill
or repricing occurs. Summary-level query metadata is required because the
server resolves absent legacy provenance before returning it. Model storage
metadata remains optional for existing documents.

### OpenCode reported-cost limitation

OpenCode computes a numeric cost from runtime pricing data. Its upstream
`getUsage` formula defaults missing rates to zero; explicit zero rates produce
the same amount. The current step payload does not carry enough evidence to
distinguish the two cases. Partial tariffs can also produce a positive amount
that omits some categories.

Convoy preserves any finite nonnegative OpenCode amount, including zero, as
runtime-reported. This describes the runtime evidence, not verified provider
billing or verified tariff completeness. Convoy does not infer missing pricing
from `cost > 0`, token count, subscription authentication, or a custom provider
name. Absent or invalid amounts remain eligible for estimation. Distinguishing
placeholder zero from free usage requires explicit runtime/provider pricing
evidence and supported-version captures before changing this contract.

Upstream source inspected for the review: [OpenCode getUsage](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/session.ts#L321-L383).
This source inspection is not a live capture of the deployed runtime.

### Automatic estimation

New usage with missing runtime cost is estimated automatically when model
pricing and complete disjoint token quantities are available. There is no
environment flag or separate activation step. Deploy the recorder together
with the estimate and coverage disclosure UI.

Reported amounts, including zero, remain authoritative. Unknown models,
missing quantities and legacy events retain their existing treatment.
Earlier unpriced rows are not recalculated when this code is deployed.

Verification uses the installed Sandbox Codex version and actual payloads for
each supported transport. Require explicit cache-write counts, including zero,
and complete disjoint token quantities. A fresh multi-batch run must produce
`hasEstimated: true` and matching thread/task/project totals. Missing categories
remain unpriced; do not replace missing cache writes with zero.

On 2026-09-19, fresh loopback-provider captures from installed Codex 0.153.4
confirmed explicit zero cache writes for exec and app-server. These are protocol
checks with deterministic local responses, not live provider billing evidence.

## Query contracts (`convex/costs/core.ts`)

- `getProjectUsageDashboard({ projectId, fromDayStartMs, toDayStartMs })` —
  requires `PROJECT_VIEW`. One indexed range read (plus the same-length
  prior range for the period delta) returning `{ totalCostUsd,
  prevTotalCostUsd, totalRuns, byDay (with per-model cost per day), byModel,
  byMember (user names joined), byCli, topTasks }`. `topTasks` is the top 10
  task groups by cost with ref/name joined, plus an entry without `taskId`
  aggregating unattached-thread spend; groups beyond the cap are dropped,
  not aggregated.
- `getTaskCostSummary({ taskId })` — requires `TASK_VIEW` on the task's
  project (denials read as "Task not found"). Returns
  `{ totalCostUsd, byModel, byDay }` for that task only.
- `getThreadCostSummary({ threadId })` — requires `CLI_THREAD` on the
  thread's project (denials read as "Thread not found"). Same shape, scoped
  to that thread only.

## UI

- **Cost indicator**
  (`components/blocks/thread/cost-indicators.tsx`): one chip rendered in
  the thread composer footer next to the context window meter. Shows the
  task total and thread total as "$5.00 / $1.00" when both exist and
  differ in amount, source or coverage, otherwise a single value; hidden only
  when nothing was recorded. Recorded zero and unpriced usage remain visible. Click
  opens a popover with both available scopes and their per-model breakdowns
  of token count, share of total tokens and cost. Per-message footer chips
  (`run-stats.tsx`) intentionally do not show cost — it remains available
  in the message's run-details popover.
- Aggregate-only reported events render the dashboard even with no model rows,
  including reported zero. Recorded days or runs establish usage for its empty
  state; the model list alone does not.
- Every recorded usage day counts as active, including reported zero and
  unpriced usage. Average known spend per active day divides the known total
  by that count. The average carries the same source and coverage labels as the total.
- **Project usage page** (`app/o/[organizationSlug]/[projectAlias]/usage/`,
  dashboard in `components/blocks/project/usage/project-usage-dashboard.tsx`):
  stat tiles (total spend with prior-period delta and sparkline, month to
  date, avg per active day, agent runs), daily spend stacked by model with
  hover breakdown, tokens by model (top four by tokens; the rest behind a
  `Show N more` toggle), spend by member, spend by CLI, cache
  efficiency (cached share of input tokens, floored to one decimal so a
  small uncached remainder never reads as 100%, plus the uncached count),
  and a most-expensive-tasks table. Token counts use `k`, `m`, `b` and `t`
  suffixes. Each task reference in that
  table links to the canonical project task route so selecting it opens the
  task detail sidebar; the unattached-threads row remains plain text. Each
  row stays on one line; a long task name is truncated with an ellipsis. Range
  filter: 30/90/180 days.
- **Project settings Usage link**: the project settings sidebar shows `Usage`
  as a navigation link, not an in-dialog tab. Selecting it closes the settings
  dialog and opens the full project usage dashboard. The menu item keeps the
  `Usage` label with a trailing `ArrowUpRight` icon to indicate that it leaves
  the settings dialog.
- **Chart primitives** (`components/custom/charts/`): shared SVG components
  (`StackedBarChart`, `ShareBarList`, `CompositionBar`, `Sparkline`) with
  data-in props so a chart library can replace the internals later. Series
  colors come from the theme's categorical `--chart-1…5` slots (CVD-validated
  per mode); models are assigned slots alphabetically for cross-range
  stability, CLIs have a fixed slot map.

### Source and coverage display, OS-1531

`lib/costs/cost-summary.ts` owns the wording for every aggregate cost display.
Sources and coverage combine independently, without inferring evidence from a
positive or zero amount:

| Evidence | Example label |
| --- | --- |
| Runtime-reported positive or zero | `$10.00` or `$0.00` |
| Estimated only | `$2.00 estimated` |
| Reported and estimated | `$12.00` |
| All unpriced | `Not priced` |
| Known and unpriced | `$10.00 known` |
| Legacy provenance | `$10.00 source unknown` |
| Known subtotal with excluded history | `$10.00 known` |

Combined states retain each qualifier, except that an estimate mixed with
reported or legacy cost gets no visible estimate label; Cost details and
accessible descriptions still disclose it. For example, an estimate mixed with
unpriced usage and legacy history reads `$4.00 known source unknown`. Known zero mixed with unpriced
usage reads `$0.00 known`, without claiming all usage was free.

Cost details explain reported amounts as runtime evidence, not verified
provider invoices. Estimated amounts use standard short-context API-equivalent
token rates, excluding provider adjustments and non-token fees; they do not
represent subscription charges. Pricing snapshot metadata is retained.
Compact labels use words, with accessible descriptions and cost details;
color and symbols never carry the meaning alone.

The same rules apply to project, UTC month, per-active-day and per-run averages,
model/member/CLI/task rows, thread/task headers and popover model breakdowns.
Month sums merge metadata for the included days only. Recorded usage, rather
than positive spend, determines whether the indicator and dashboard exist.
The header popover keeps task and thread breakdowns available even when their
headline amounts happen to match. In the thread/task cost indicator, estimate
wording appears only beside the total at the top of each popover section.
The closed trigger and per-model rows omit `estimated`.
The trigger, popover totals and per-model rows omit `source unknown` while
retaining cost metadata and known/unpriced labels. The popover has no pricing explanation
paragraph or catalog snapshot; only brief unpriced, incomplete-allocation or
excluded-history notices appear when applicable. Full explanations remain in
the project dashboard's Cost details. The project dashboard also omits
`source unknown` from visible labels; legacy provenance stays in Cost details
and accessible descriptions.

Comparisons are suppressed when either period has unpriced, legacy or excluded
history; the total tile then shows no comparison line. Complete totals remain comparable when only model allocation is
incomplete. A comparison involving estimates says so, including when only the
prior period is estimated. Previous-period zero never yields an infinite
percentage. Average and composition bars represent known recorded cost and
inherit its limitations.

Daily charts show source/coverage labels for each day and model on pointer
hover and keyboard focus. The tooltip omits explanations; each bar's accessible
description and Cost details carry them. Missing calendar days read `No usage`;
recorded unpriced days read `Not priced`. If model allocation is incomplete,
the chart uses authoritative daily totals instead of stacking partial model
allocations. The sparkline is described as a trend of known daily costs.

### Excluded-history disclosure contract

`costMetadata.hasDataGap` is optional and OR-merges through both rollup grains,
all query groupings, prior periods and client month sums. Absence means no
exclusion has been recorded; it does not certify the accuracy of history.
Readers disclose `Historical usage was excluded` even when the known subtotal
is zero or no usage remains. Numeric surviving subtotals keep their amount.

A future cleanup must persist exclusion evidence with its affected scopes and
UTC dates, then supply this flag only to affected summaries and periods. It
must preserve the evidence after deleting corrupted rows, exclude removed
usage from token/run/active-day counts, and handle new writes in affected
buckets. This flag alone does not implement cleanup or its evidence storage.
OS-1532 was canceled when this UI shipped; this change performs no cleanup,
creates no gap markers and does not guess a cutover timestamp.

## Known limitations

- No historical backfill: spend is recorded from feature deploy onward.
- Retried runs count each run's spend (both runs consumed tokens).
- Retry deletes the failed assistant message's chunks but recorded rollups
  are kept — by design.
- Codex USD estimation requires catalog pricing and complete model/token evidence.
  Codex app-server batches without a
  `thread/tokenUsage/updated` payload record nothing.
- Rows for deleted tasks/threads are kept; project totals remain accurate.
- Events recorded before `threadCostRollups` existed appear in
  project/task totals but not in any thread summary (no backfill).
