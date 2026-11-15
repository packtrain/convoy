# Convoy MCP servers

## Which server to use

Two Convoy MCP servers are configured: `convoy` (prod) and `convoy-dev`.

- **Tickets/tasks the user references for implementation (e.g. "check OS-1234")
  always live in prod — use `mcp__convoy__*` tools.** Same for attaching
  commits and PRs to tasks.
- Use `mcp__convoy-dev__*` **only** for testing newly built functionality
  against the dev environment.

## Updating MCP tools

When adding, removing, or renaming MCP tools, update all MCP-facing setup
surfaces in the same change:

1. `apps/web/convex/mcp/tools.ts` and the related handler/tests
2. `docs/specs/mcp-server.md`
3. `apps/docs/content/docs/reference/mcp-tools.mdx`
4. Codex approval snippets in `apps/docs/content/docs/cli/mcp/index.mdx` and
   `apps/web/components/blocks/user/settings/api-keys/api-keys-section.tsx`

Codex approval tool names must match the exact server tool names. Remove stale
aliases (e.g. retired tool names) when the server catalog changes.
