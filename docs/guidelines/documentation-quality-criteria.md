# Documentation Quality Criteria

A checklist for crafting well-structured developer documentation, distilled from
analyzing two reference sites:

- **AI SDK** — https://ai-sdk.dev/docs/foundations/overview
- **Inngest** — https://www.inngest.com/docs

Both share a backbone: a **concepts → quickstart → guides → reference** spine,
task-oriented pages, runnable code, aggressive cross-linking, and first-class
**AI-native consumption** (`llms.txt`, full-doc bundles, copy-Markdown, a docs
search endpoint). Use the criteria below to evaluate or build documentation.

> **Read this first — priorities are not equal.** A flat checklist invites you to
> score 13/14 while failing the one structural thing that sinks the site. The
> criteria are grouped into three tiers. If a **Tier 1** item is broken, nothing
> else matters; polish Tier 3 only once Tier 1 holds.

| Tier | Criteria | Why |
|---|---|---|
| **1 — Load-bearing** | Information architecture · Task-first quickstart · Runnable code · Mental models | If these fail, the docs fail regardless of everything else |
| **2 — Substance** | Page structure & progressive disclosure · Reference precision · Production-readiness coverage · Cross-linking | These make docs *useful* beyond the first 10 minutes |
| **3 — Polish & trust** | Wayfinding chrome · AI-native surfaces · Trust/maintenance signals · Writing & tone · Minimal marketing | These build confidence and reduce friction |

---

## TIER 1 — Load-Bearing

### 1. Information Architecture

The single most important factor. Both sites organize by **reader intent and
learning progression**, not by internal system boundaries.

- [ ] **Intent-based spine** that mirrors a learning journey. Keep the *primary*
      sidebar to ~6–8 lanes:
  - *Overview / Foundations* — what it is, why it matters, mental model
  - *Getting Started / Quickstart* — first working result in minutes
  - *Concepts* — how the system works, abstraction boundaries
  - *Guides / How-to* — task-oriented, "how do I X?"
  - *Reference / API* — exhaustive, lookup-oriented
  - *Advanced / Production* — deploy, scale, limits, failure modes
  - *Migration / Troubleshooting* — escape hatches
- [ ] **Long-tail categories are nested, not promoted.** Security, Limits, FAQ,
      Glossary, Examples, Changelog are *available* category types, but a given
      site picks the few it needs as top-level lanes and nests the rest. Avoid
      sidebar sprawl — it directly degrades wayfinding.
- [ ] **≤3 levels of hierarchy.** Section → subsection → page. No deeper.
- [ ] **Diátaxis discipline.** Tutorials (learning), how-to guides
      (problem-solving), reference (information), and explanation (understanding)
      are *not* mixed on the same page. This is the discipline that keeps the spine
      coherent as the docs grow.
- [ ] **Multiple entry points by intent.** Beginners, evaluators, implementers,
      maintainers, advanced users, and **AI coding agents** all arrive differently.
      AI SDK pairs a *Foundations* track with a *Quickstarts* track for exactly this.

### 2. Task-First Quickstart

- [ ] **A working artifact fast** — the explicit goal is a running result, not
      comprehension. Reachable in one sitting (≤ ~10 min, time stated up front).
- [ ] **States the full path**: outcome, prerequisites, estimated time, setup
      commands, files to create, expected result, **a verification step**, and
      next paths.
- [ ] **Friction reducers**: exact install commands, `.env` setup, scaffolding
      flags (`--ts`) spelled out — copy-paste, don't paraphrase.
- [ ] **A visible feedback loop** where possible — a local dev server/UI the reader
      can open to *see* it work (Inngest's Dev Server at `localhost:8288`).

### 3. Runnable Code Examples

- [ ] **Production-realistic** — real model ids, real imports, copy-paste runnable,
      not pseudo-code.
- [ ] **Copy button** on every block; **filename headers** showing where code
      belongs (`src/app/api/inngest/route.ts`).
- [ ] **Package-manager and framework/language variants** as tabs that switch a
      whole flow coherently (App Router / Pages Router; npm / pnpm / yarn;
      Gateway / Provider / Custom). Selection ideally persists across pages.
- [ ] **Progressive complexity**: first example deliberately minimal with comments;
      complexity layered in later. Explain *what changed* between variants.

### 4. Strong Mental Models

- [ ] **Concept pages explain how the system works**, where the abstraction
      boundaries are, and **what problem the product replaces.** Inngest's durable-
      execution page is the benchmark.
- [ ] **Jargon defined on first use**; terms link to a glossary where one exists.
- [ ] **Diagrams** for non-linear concepts (lifecycles, architectures, data flow).

---

## TIER 2 — Substance

### 5. Page Structure & Progressive Disclosure

Every page follows a predictable template so readers know where to look.
The site as a whole moves from *"what is this and why"* → *"build the first thing"*
→ *"understand the model"* → *"use advanced features"* → *"look up exact APIs."*

- [ ] **Consistent page template**: short intro / hook → prerequisites & context →
      main content → examples → caveats → links → **next steps**.
- [ ] **Hook / value statement up top**: one sentence on what this page gives you.
      Inngest: *"By the end, you'll have a working function that runs in the background."*
- [ ] **Numbered, sequential steps** for tutorials; each step is one goal.
- [ ] **Callouts** (note / tip / warning / version-note) used consistently and
      sparingly — not walls of bold text.
- [ ] **Bounded length.** Overview/index pages *route* (card grids of options); they
      don't dump. Consistency lowers cognitive load.

### 6. Reference Precision

- [ ] API reference includes **signatures, parameters, required/optional status,
      defaults, limits, nested properties, return values, and examples.**
- [ ] **Links back to the relevant guides** so reference isn't a dead end.
- [ ] Lookup-optimized: scannable tables, stable anchors, predictable ordering.

### 7. Production-Readiness Coverage

The content evaluators and maintainers need most — and the most commonly missing.

- [ ] Covers **deployment, auth, errors, retries, observability/logging,
      performance, limits, testing, migration, versioning, security, and failure
      modes.**
- [ ] Failure modes and limits are documented honestly, not hidden.

### 8. Cross-Linking & Discoverability

- [ ] **Dense inline links** to related concepts within prose — link concepts where
      they're mentioned, don't re-explain.
- [ ] **"Next steps" block** ending every tutorial with 3–5 branching paths
      (deploy, go deeper, related feature, advanced topic).
- [ ] **Related / see-also** sections on reference pages.
- [ ] **No dead ends**: every page suggests where to go next.

---

## TIER 3 — Polish & Trust

### 9. Wayfinding Chrome

- [ ] **Persistent left sidebar** showing the full tree, current location
      highlighted, ancestors expanded.
- [ ] **Breadcrumbs**, **"on this page" TOC**, and a **Previous / Next pager**
      following the intended reading order.
- [ ] **Full-text search** (ideally a `Cmd/Ctrl-K` command palette) spanning
      reference, guides, examples, and troubleshooting.
- [ ] **Version selector** with clear section labels.
- [ ] **Light / dark / system** theme toggle; responsive + keyboard-navigable;
      every heading deep-linkable.

### 10. AI-Native Surfaces

Increasingly the differentiator — both reference sites ship all of these.

- [ ] **`llms.txt`** index and, where useful, a **`llms-full.txt`** full-doc bundle.
- [ ] **Per-page "Copy as Markdown"** action and raw Markdown URLs.
- [ ] **A docs search endpoint** an agent can query (AI SDK exposes
      `/api/search-docs` and advises preferring targeted pages over the full bundle).
- [ ] **Agent-specific setup guidance** (how to point an AI coding tool at the docs).

### 11. Trust & Maintenance Signals

- [ ] **Version labels** and **release banners**; per-feature version notes
      ("v6 (Latest)", "since SDK v4").
- [ ] **"Edit on GitHub" / "Report an issue"** link on every page.
- [ ] **Feedback control** ("Was this helpful?").
- [ ] **Changelog and migration guides**; clear **support/community** paths.

### 12. Writing, Tone & Restraint

- [ ] **Active voice, second person**: "You'll write a function," "Click Invoke."
- [ ] **Outcome framing** confirming progress: "You now have Inngest running locally."
- [ ] **Real-world motivation** for abstract features ("sending emails, calling an
      AI model, processing a file upload").
- [ ] **Beginner-friendly without condescension**; offers skip-ahead paths for
      experienced readers.
- [ ] **Minimal marketing inside docs.** Writing is concrete, technical, and
      action-oriented. Product value belongs in the framing; the docs' job is to
      help users succeed.

---

## The Journey Rubric (the real test)

Structural strength isn't measured by a feature count — it's measured by whether a
new user can complete the whole journey, and hand the same context to a machine:

1. **Understand** the concept and the problem it solves
2. **Build** something real (working artifact, fast)
3. **Debug** it when it breaks
4. **Deploy** it to production
5. **Look up** exact API details on demand
6. **Hand the same context to an AI agent** (`llms.txt`, Markdown, search endpoint)

If a docs site supports all six, it is structurally strong. If it nails prose but a
reader can't answer *"where am I, what will this page give me, and where do I go
next?"* within five seconds of landing, it still fails the most important test.

---

## Quick-Audit Scorecard

| Dimension | Tier | Great looks like |
|---|---|---|
| Information architecture | 1 | Intent spine, ≤3 levels, Diátaxis, long-tail nested, multi-entry |
| Task-first quickstart | 1 | Working result ≤10 min, verification step, friction removed |
| Runnable code | 1 | Copyable, filename'd, tabbed variants, progressive complexity |
| Mental models | 1 | Explains how it works + what it replaces; diagrams |
| Page structure | 2 | Predictable template, progressive disclosure, bounded length |
| Reference precision | 2 | Signatures, defaults, limits, returns, links back to guides |
| Production readiness | 2 | Deploy, auth, retries, observability, limits, failure modes |
| Cross-linking | 2 | No dead ends, "next steps" everywhere |
| Wayfinding chrome | 3 | Sidebar, breadcrumbs, TOC, search, version selector, theme |
| AI-native surfaces | 3 | llms.txt, full-doc bundle, copy-Markdown, search endpoint |
| Trust & maintenance | 3 | Versions, edit-on-GitHub, feedback, changelog, support |
| Writing & restraint | 3 | Direct, outcome-framed, minimal in-docs marketing |
