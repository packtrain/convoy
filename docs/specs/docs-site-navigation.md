# Public docs navigation

Task: OS-1918. Approved proposal: Plan `n97an9hfac2d5xcjdp8hfrdysx8ebqv7`,
Iteration 2. This spec covers the public site under `apps/docs`.

## Reader paths

The introduction offers using Convoy, connecting a runtime, deploying for a
team, and contributing. Direct MCP setup is also linked. Using the product
and connecting an MCP client do not require starting the CLI bridge.

The sidebar has eight flat sections, in this order:

1. Getting started: introduction, how Convoy works, connect your first
   machine, FAQ.
2. Using Convoy: working with projects and tasks, AI threads, project agents,
   Skills in Convoy, Prompts / Slash commands, workflows, keyboard shortcuts.
3. CLI: install and connect, profiles/paths/status, API keys for scripts and
   headless machines, model provider keys, security, isolation, dev container,
   running the CLI long-term, troubleshooting.
4. Integrations: overview, MCP, Skills for AI clients, one-shot scripting.
5. Deploy Convoy: choose a path, Clerk, Convex, web app, email, production
   checklist, Docker. The landing links directly to the Docker alternative.
6. Operations: overview, upgrading, migrations, monitoring, backups, scaling,
   debugging.
7. Reference: overview, CLI commands, config, environment variables, MCP
   tools, glossary, supported runtimes and deployment status.
8. Contributing: overview, source setup, specs-first workflow, testing, CLI
   architecture, adding a runtime, authoring docs, deploying the docs site.

## Navigation ownership

Root `content/docs/meta.json` owns every flat page and uses separators for
sections. It enumerates all canonical pages explicitly, without `...`.
Section metadata must not contain competing `pages` arrays. Only the
existing `cli/mcp` and `cli/dev-container` groups own child ordering.
There are no new directories solely for collapsible navigation.

Pages may define a short `sidebarTitle` in frontmatter. The Fumadocs page
tree uses it as the navigation label, while `title` remains the page heading
and search title. Keep labels short enough for one line in the standard
desktop and mobile sidebar; do not hide the meaning through truncation.
This also applies to previous/next labels, which use the same page tree.

Each canonical page appears exactly once. Previous/next follows that order;
Docker must not interrupt the managed deployment sequence. Flat pages have
root-level breadcrumbs; the two nested groups retain their group breadcrumb.

## Consolidation and route compatibility

`/docs/using` owns organizations/projects/members, tasks, Lists and views,
comments, attachments, and artifacts. It retains permissions, archive
behavior, and both Markdown and HTML artifact formats. Table and Board are
views; a List groups tasks independently of status.

`/docs/cli` owns prerequisites, installation, browser login, profile setup,
connection, a first thread, reconnecting, and updating. Full flags remain in
reference; advanced profiles and headless API keys have separate guides.
The join quickstart is a short orientation linking to the canonical guide.

Retain these routes as concise compatibility pointers, including their
existing heading anchors and per-page Markdown endpoints:

| Existing route | Canonical destination |
| --- | --- |
| `/docs/using/organizations-and-members` | `/docs/using#organizations-projects-and-members` |
| `/docs/using/tasks` | `/docs/using#tasks` |
| `/docs/using/comments-attachments-artifacts` | `/docs/using#comments-attachments-and-artifacts` |
| `/docs/cli/install` | `/docs/cli#install` |
| `/docs/cli/setup-and-connect` | `/docs/cli#login-and-connect` |

Compatibility pages are excluded from sidebar and previous/next. Search
and LLM entries for them contain only pointers, never duplicate guides.
Internal links point directly to the canonical sections. Static generation
continues to enumerate content files independently of navigation metadata.

The implementation baseline is 59 MDX routes on 2026-09-20. Add five pages:
`using/project-agents`, `using/skills`, `using/prompts`, `using/workflows`, and
root `integrations.mdx`. The result is 64 routes, including five compatibility
pages and 59 canonical pages. Preserve all baseline URLs.

## Content contracts

Thread ownership and explicit read-only sharing follow
[CLI thread sharing](cli-thread-sharing.md). Organization membership alone
does not grant implicit project access. Runtime support is checked against
the registered runners and capabilities; execution and interactive features
are distinct. The runtime matrix lives in the existing roadmap route.

Project agents, in-app Skills, stored prompts, and workflows have separate
practical guides checked against their specs and implemented UI. Distinguish
in-app Skills from local client installation and stored prompts from runtime
commands. The workflow guide includes authoring, stages/lanes/steps,
connection/path selection, starting, waits, recovery, and cancellation.
Watch Tower's public docs scope remains to be verified.

Clerk setup precedes using its issuer in Convex. Managed and Docker setup
are alternatives. Recipes do not claim end-to-end validation unless run.
Reference pages are hand-maintained mirrors of their named source modules.

## Validation

Mermaid diagrams follow the site's resolved light or dark theme, including
system preference and changes through the theme switch. Text and connecting
lines must remain readable against their diagram background. A theme change
rerenders existing diagrams without navigation or reload. Mermaid remains
lazy-loaded with strict sanitization; stale asynchronous results must not
replace a diagram rendered for a newer theme.

Before editing, capture routes and old heading anchors and run focused
checks that fail for incorrect navigation and stale claims. After editing,
compare routes and rerun the checks. No separate prose testing framework is
required. Verify built HTML, per-page Markdown, search and LLM output,
internal routes and anchors, navigation ownership, and previous/next order.
Check source and built output for Claude-only execution, missing Cursor
support, a Codex placeholder, and implicit broad access claims.

Run docs build and type checks, repository web lint and web type checks.
Inspect desktop and mobile navigation on an existing server when available;
do not start a server in the primary checkout. Record any checks that could
not be completed and any untested deployment recipes.
