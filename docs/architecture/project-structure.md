# Project structure

A pnpm monorepo with five apps under `apps/`:

- **`apps/web/`** — Next.js + Convex app (the product)
- **`apps/cli/`** — CLI agent bridge (see [cli-bridge.md](cli-bridge.md))
- **`apps/desktop/`** — Tauri menubar app wrapping the CLI
  ([spec](../specs/desktop-app.md))
- **`apps/docs/`** — public documentation site
- **`apps/landing/`** — marketing landing site

Root folders outside `apps/` are mapped in
[AGENTS.md](../../AGENTS.md), including which ones are frozen by an external
contract.

```text
apps/web/
├── app/             # Next.js App Router (routes, pages)
├── convex/          # Backend: schema, queries, mutations (camelCase files)
├── convex-testing/  # Test utilities (see README.md there)
├── components/      # ui/ (shadcn), custom/ (extended), blocks/ (features), tiptap-*/ (editor)
├── hooks/           # Shared cross-domain hooks only (domain hooks live under lib/<domain>/hooks/)
├── lib/             # Domain-organized frontend/shared modules (one folder per domain)
└── providers/       # Convex + Clerk, theme providers

apps/cli/
├── bin/             # Entry point (convoy command)
└── src/
    ├── cli.ts       # Command registration
    ├── agent/       # Agent runner, Claude Code executor, message handler
    ├── commands/    # CLI commands (setup, connect, config, paths, status)
    ├── lib/         # Config system, git utils, prompts
    └── convex/      # _generated/: real ESM api.js (anyApi) + d.ts symlinks to apps/web/convex/_generated
```

> Only stable top-level folders are listed, to avoid drift. `components/`,
> `hooks/`, and `lib/` contain many domain subfolders — browse them directly
> rather than relying on an exhaustive list.

Where new code belongs is governed by
[../guidelines/architecture.md](../guidelines/architecture.md).
