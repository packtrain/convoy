# Workflow runs pin auto-cut immutable versions

A Workflow definition is one freely editable draft stored on the Workflow
itself. The editor's explicit Save writes the draft and nothing else — there
is no Save-as-version or publish step. Every Save sets a
`dirtySinceLastVersion` flag. When a run
starts, the flag decides everything: clear → the run pins the latest
immutable Workflow version; set → the draft is copied into a new version,
the flag is cleared, and the run pins the copy. Runs never read the live
draft, so mid-run edits cannot change, corrupt, or re-order an in-flight
run, and bash script Steps execute exactly what the starting user saw and
consented to at start. Version history is therefore exactly the definitions
that have actually run; reverting the draft to an older version is a planned
later feature the schema already supports.

We rejected live-reference runs (mid-run reordering is undefined behavior),
version-per-Save (fills history with definitions that never ran and makes
revert history noisy), and content hashing or deep comparison at run start
(the dirty flag answers "changed since last version?" for free). Deleting a Workflow cancels its active runs,
but history keeps rendering through pinned versions. The full schema and
lifecycle are defined in `docs/specs/workflow-data-schema.md`.
