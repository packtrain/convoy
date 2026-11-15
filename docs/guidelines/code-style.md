# Code style

## TypeScript

- Prefer early returns over nested ifs.
- Use named exports.
- **Avoid `any`.**
- **Avoid unsafe casts.** Don't cast an untrusted `Record<string, unknown>` (e.g.
  JSON-RPC `params`) to a typed shape — validate or narrow with a type guard or
  parser first.

## Comments

**Keep them short.** A docblock is 1–3 lines; a top-of-module one may reach ~5.
Inline comments are one or two lines. If the explanation is longer than the code
it sits above, it belongs in the spec, not the source.

- Comment the **why**, never the what. If the code says it, delete the comment.
- **Rationale lives in `docs/specs/`.** Rejected alternatives, cost analysis,
  cross-module contracts, and history belong in the spec for the area; the
  comment points there in a clause (`Spec: docs/specs/mcp-server.md`) instead of
  reproducing the argument.
- No walls of text. Multi-paragraph docblocks, bold headings inside comments, and
  restated spec prose all make the next reader scroll past code to reach code.
- Don't narrate a ticket. `(OS-1234)` beside the thing it introduced is enough.

## File naming

kebab-case everywhere (`api-key-row.tsx`, not `ApiKeyRow.tsx`) — **except in
`convex/`, which requires camelCase** because Convex module paths cannot contain
hyphens. See [convex/core-conventions.md](convex/core-conventions.md).

## Import paths

Prefer the `@/` alias for app-wide modules (`@/components/ui/accordion`,
`@/lib/utils`) over deep relative paths like `../../../..`. Use relative imports
mainly for nearby same-folder files.
