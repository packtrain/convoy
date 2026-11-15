# Packs and the Gallery

## Scope

This document defines Packs — curated bundles of Skills, Slash commands,
Agents, and Workflows from one author, vendored into this repository — and the
Gallery, the in-app catalog users browse to install them into a project.

The catalog lives on disk, not in the database (ADR-0007). Installed items are
ordinary project rows that record a gallery-typed Git source pointing at this
repository (ADR-0008). This spec covers the on-disk format, the vendoring and
adaptation tooling, licensing, the served index, and the install / update /
uninstall model and UI.

Related specs: `docs/specs/skills.md` (Git Sources, install/refresh — the
machinery Packs reuse), `docs/specs/agents.md`, `docs/specs/slash-commands.md`.
Glossary terms (Pack, Gallery, Upstream, Adaptation, Materialized content, Pack
install, Pack prefix) are canonical in `CONTEXT.md`.

## Sequencing

Pack install requires the org-template install machinery to exist per item
type. Skills (OS-1683) and Agents (OS-1759) have it; Prompts are OS-1771 and
Workflows are OS-1847. **The Gallery does not launch until all four types are
installable.** Additionally, Slash commands, Agents, and Workflows need the
`source` Git-provenance field (today Skills-only); adding it is part of the
Packs implementation.

## On-Disk Format

One directory per Pack under `packs/` at the repo root. `plugins/` is not
used: the CLI build copies that whole directory into the published npm package.

```
packs/<slug>/
  pack.json          # metadata
  README.md          # long-form markdown for the Pack detail page
  upstream.json      # vendoring manifest
  upstream/          # pristine checkout at the pinned commit — GITIGNORED
  patches/           # generated diffs: upstream/ vs materialized/
  assets/            # avatar.png, cover.png, README images
  materialized/      # committed; the only content the Gallery serves
    skills/  commands/  agents/  workflows/
    LICENSE          # copied from Upstream by packs:sync
```

`pack.json`:

- `name`, `slug`, `description` (one line, for cards and search), `tags`
- `author` — `{ name, url }`
- `license` — SPDX identifier
- `avatar`, `cover` — paths under `assets/`
- `defaultPrefix` — the Pack prefix proposed at install, e.g. `"mp"`

`upstream.json`, per source:

- `repo` — Upstream repository URL
- `ref` — branch or tag the pin tracks
- `sha` — the pinned commit; bumping it is how a Pack updates
- `syncedAt` — stamped by `packs:sync`
- `license` — required; sync refuses sources without one
- path mappings — Upstream subpath → destination under `materialized/`
- `replace` rules — ordered string substitutions applied to vendored content

## Vendoring and Adaptation

Adaptations are Convoy-specific changes to Upstream content (for example
"Jira" → "Convoy tasks"). They are never hand-maintained as forks:

- `packs:sync <slug>` — fetch each source at its pinned `sha` into `upstream/`,
  copy the mapped subtrees into `materialized/`, apply `replace` rules, then
  apply `patches/` with `git apply`. Copies the Upstream LICENSE in. Fails
  loudly when a patch no longer applies.
- `packs:diff <slug>` — regenerate `patches/` as `diff -ruN` of `upstream/`
  against `materialized/`. Run after editing materialized content (by hand or
  by agent); patches are a generated record, never written manually.
- `packs:check` — `git ls-remote` each source's `ref` and report Packs whose
  pin is behind Upstream.

Updating a Pack: bump `sha` → `packs:sync` → on conflict, re-adapt the
materialized file against the new Upstream and re-run `packs:diff`.

Scripts live in `scripts/` (repo-wide tooling).

## Licensing

`packs:sync` enforces an allowlist — MIT, Apache-2.0, BSD, CC-BY, CC0 — and
refuses anything else, including sources with no license file (no rights
granted). Copyleft (GPL, CC-BY-SA) and NC/ND variants are excluded from v1.
The LICENSE ships inside `materialized/` and the Gallery shows author and
license per Pack, which covers attribution.

## The Index

A web-app build step walks `packs/*/`:

- reads `pack.json`, `README.md`, and `materialized/` content
- copies `assets/` to `public/packs/<slug>/` and rewrites asset paths
- emits a static index: per Pack, the metadata, README markdown, Upstream info
  (`repo`, `ref`, `sha`, `syncedAt`), item list with full content, and the repo
  commit the index was built from (**the version of every item**, per
  ADR-0008)

A route handler serves the index. One global catalog, identical for every
organization; it changes only by deploying. `upstream/` and `patches/` never
leave the build.

## Install Model

Pack install is **direct to project**. There is no org-level copy step.

- Rows are created through each type's existing install machinery, recording
  `source` with `type: "gallery"`, `repoUrl` = this repository,
  `subpath: packs/<slug>/materialized/<kind>/<name>`, `commitSha` = the index
  build commit. See ADR-0008 for the three install origins a row can have.
- The owning Pack and chosen Pack prefix are **derived** (from `source.subpath`
  and item names), not stored; the `type` marker is the only schema addition.

**Item picker.** The install dialog shows the Pack's full contents across all
four types, everything selected by default; the user installs all or a subset.
The same dialog opens from every entry point.

**Pack prefix.** The dialog proposes `defaultPrefix` and the user may change
it. On install, the default prefix is string-replaced with the chosen one in
item names **and content** — pack content cross-references sibling items by
prefixed name, so names and content must move together.

**Conflicts.** Before installing, names are checked against the project. Every
conflict is shown up front; the user resolves by renaming their existing items
or changing the prefix, then retries. Install never overwrites an unrelated
item. Re-installing an item that already exists from the same gallery source
is a refresh, not a conflict.

**Permissions.** Same as installing a Skill from a Git source: project
authoring permission, nothing more.

## Update, Refresh, Uninstall

- **Detection**: a project row is stale when its `source.commitSha` differs
  from the current index's build commit *and* the item's content actually
  changed. Update hints render in project settings exactly like org-installed
  Skills do today (the settings page also fetches the index), and on the
  Gallery's Pack detail page.
- **Refresh**: per item, overwriting from the index content, with the standard
  locally-edited confirm. The chosen prefix is preserved (the replace is
  re-applied).
- **Uninstall Pack**: deletes the project's rows belonging to that Pack —
  matched by `source.subpath`, so renamed items are included — behind one
  confirm dialog that lists the items and flags locally-edited ones.

## UI

- **Project settings → Packs**: a new section listing installed Packs (name,
  avatar, installed items count, update state) with actions: open in Gallery,
  install more items, uninstall Pack.
- **Gallery**: browse page (cards: avatar, name, description, tags, author,
  license) and a Pack detail page (README, item list with per-item installed /
  update state, Upstream repo link pinned to the vendored commit, install
  button).
- **Entry points**: the Gallery itself, the Packs section, and an "install
  from Gallery" action beside the existing install-from-organization buttons
  in each type's settings section. All open the same install dialog.

## Deferred

- Per-organization or user-submitted Packs (requires a database catalog).
- Org-level roll-up of Pack installs across projects.
- Install counts, ratings, or any dynamic catalog data.
- Keep-local-copies option on uninstall.
- MCP/CLI surfaces for Pack install.
- CI staleness cron (`packs:check` on a schedule filing tasks).
