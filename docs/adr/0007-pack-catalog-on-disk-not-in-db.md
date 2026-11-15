# Pack catalog lives on disk, not in the database

The Pack Gallery's catalog is directories under `packs/` in this repository:
per-Pack metadata (`pack.json`, `README.md`), a pinned Upstream manifest
(`upstream.json`), generated patches, and committed Materialized content. A
build step compiles this into a static index the web app serves; installing a
Pack creates ordinary project rows (Skills etc.) from that index. No catalog
tables exist. This makes every Pack change a reviewable Git diff, makes
Adaptations to third-party content a normal code-review artifact, and needs no
authoring UI, moderation, or storage plumbing for v1.

Upstream content is vendored by a sync script into a gitignored pristine
checkout (`upstream/`), and Adaptations are recorded as generated diffs
(pristine vs. Materialized), so bumping the pinned commit re-applies them or
fails loudly. We rejected catalog tables (dynamic data like install counts can
be added later without changing the on-disk format), Git submodules (painful
for subtrees), and fork-per-Upstream repositories (a patch directory carries
the same information without repo sprawl). The cost: catalog changes ship only
with a deploy, and per-organization or user-submitted Packs are out of scope
until a database representation exists.
