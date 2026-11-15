# Module folders inside Convex domains

A sub-entity module inside a domain may be a folder instead of a single file.
`cli/threads/` holds one callable file per capability (`core.ts`, `lists.ts`,
`runControl.ts`, each becoming `api.cli.threads.<capability>.*`) plus a
module-private `lib/` that only files inside the module may import. This adds
a third privacy tier to the existing two: `convex/lib/` is importable
everywhere, `<domain>/lib/` inside its domain, and `<domain>/<module>/lib/`
only inside its module — both scoped tiers with the lint's standing
exemptions for `*Repo` files and type-only imports. A module graduates to a folder when it owns a table
and has three or more private helpers; below that bar it stays a single file
with helpers in the domain `lib/`. Today the bar covers `tasks` (core), `cli`
(threads), and `mcp` (handlers); every other domain stays flat, and
`organizations/` remains the reference layout for a normal-sized domain.

This codifies shipped practice rather than introducing a layout. Convex merges
a file and a same-named folder into one api namespace, so
`tasks/core/{search,bulk,rank,move}.ts` already coexists with `tasks/core.ts`
and production calls `api.tasks.core.search.byProject`;
`mcp/handlers/tasks/core.ts` likewise sits three levels deep in the generated
api. We rejected promoting large sub-entities to top-level domains (a
`cliThreads/` domain splits one domain's vocabulary across two folders and
renames every `api.cli.threads.*` path without adding any privacy), and we
rejected staying flat (`cli/threads.ts` reached 2,369 lines and 37 functions,
with its helpers mixed among the ~77 files of `cli/lib/`). The cost: the
privacy lint globs were written for exactly one folder depth and stop matching
one level deeper, so they must be rewritten depth-proof before the first
module `lib/` lands, and import paths gain a segment.
