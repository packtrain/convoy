# Adopt markdown-native storage for task descriptions

Task descriptions will migrate from Tiptap + ProseMirror JSON storage to a markdown-native editor (MDXEditor, matching task Artifacts), so descriptions and artifacts share one editor surface and one canonical text representation. We chose this over keeping Tiptap and adding a server-side PM-JSON → markdown projection because the projection creates a permanent round-trip surface that has to be tested for every node and mark we ever add, and would leave two divergent editors (Tiptap for descriptions, MDXEditor for artifacts) in the product indefinitely. The migration is paid once; the projection would be paid forever.

The migration itself is not in flight yet — a backlog task tracks it. Until that task ships, partial-edit (`replace_in_task_description`) is deferred and `docs/specs/mcp-server.md` carries an explicit "Partial Updates" note saying so.

## Consequences

- Stored task description shape changes from a serialized ProseMirror JSON string to a markdown string; a one-time data migration of existing descriptions is required.
- Tiptap-specific rich features beyond the markdown subset (custom marks, embedded nodes not representable in commonmark) are dropped from task descriptions; artifact parity is gained in return.
- Once descriptions are markdown-native, `replace_in_task_description` can be added with exact bytewise-match semantics and strict single-match behavior unless `replaceAll` is explicitly requested, and the deferred note in `docs/specs/mcp-server.md` is removed.
- The MCP `update_task.description` contract changes: it accepts and returns markdown directly, with no PM-JSON normalization step on the server.
- `convex/lib/mcp/taskDescription.ts` (markdown → PM JSON normalization) becomes obsolete and is retired with the migration.
