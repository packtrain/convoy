# Store artifact comment anchors outside the artifact content

Artifact comments will anchor to Artifact content through a separate `artifactComments` table that stores the selected snippet, surrounding context, and character offsets — not through marks embedded in the Artifact content. Highlights are computed at render time by re-finding the anchor text in the current content, and remapped live as the user edits. We chose this over embedding comment ranges as Lexical mark nodes in the document because Artifact content is persisted as a plain markdown string (`taskArtifacts.content`), consumed and edited as a string by MCP/CLI (`replace_in_task_artifact` does literal substring replacement), and has no place to carry mark metadata. Embedded marks would be stripped on markdown serialization or would corrupt the stored markdown.

## Consequences

- Comment position is derived, not authoritative: on load and on edit the anchor snippet+context is searched in the current content to place the highlight.
- Comments survive content rewrites (user autosave and agent `replace`/`rewrite`). When the anchor text is gone the comment becomes a **Detached comment** — kept and readable, not highlighted — and re-attaches if the text reappears.
- The selected snippet is copied into the comment at creation, so the referenced text is always visible even after the content changes.
- Surrounding context is stored alongside the snippet to disambiguate near-duplicate selections and avoid re-anchoring onto the wrong occurrence.
- Character offsets are only a search hint (raw markdown offsets differ from the Lexical text content); the snippet+context match is the source of truth.
- No schema change to `taskArtifacts`; artifacts stay plain markdown strings. Switching artifact storage to Lexical editor-state JSON was rejected because MCP/CLI and agents treat artifacts as markdown text.
- Anchoring inherits a known limitation: if the snippet+context still matches multiple places after a large edit, re-anchoring may pick the wrong one. Accepted for v1; mitigated by storing context.
