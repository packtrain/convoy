# Pack installs record a gallery-typed source pointing at the monorepo

A Skill installed from a Pack records `source` provenance with a `type`
discriminator set to `gallery`, reusing the existing git-source shape
(`docs/specs/skills.md`, Git Sources) but pointing at **this repository** —
`subpath: packs/<slug>/materialized/skills/<name>`, `commitSha`: the repo
commit the Gallery index was built from — not at the Pack's Upstream
repository. Materialized content includes Adaptations that do not exist
Upstream, so an Upstream-pointing source would be false provenance and a
refresh against it would clobber the Adaptations. The type distinguishes the
three install origins a row can have: `sourceSkillId` (organization template),
`source` without a type (ad-hoc `convoy skills add` from any repo), and
`source.type: "gallery"` (Pack install), so the UI and refresh flow know which
affordances apply.

This reuses the whole existing Skill machinery — install, refresh, update
detection via `commitSha`, locally-edited warnings, and the commit-pinned
source link — instead of a parallel `packSource` + content-hash mechanism,
which we rejected. The owning Pack and the chosen Pack prefix stay derivable
(`source.subpath` and the installed item names), so the only schema change is
the optional `type` marker. The Upstream repo and commit are shown on the
Gallery's Pack detail page, not stored per row.
