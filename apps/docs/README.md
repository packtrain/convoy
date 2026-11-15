# Convoy Docs

Documentation site built with [Fumadocs](https://fumadocs.vercel.app/) and [React Router](https://reactrouter.com/).

## Development

From the repository root:

```bash
pnpm docs:dev
```

Or from `apps/docs`:

```bash
pnpm dev
```

The dev server runs at [https://docs.convoy.localhost](https://docs.convoy.localhost).

## Build

```bash
# From root
pnpm docs:build

# Or from apps/docs
pnpm build
```

The site is fully pre-rendered (static). Build output goes to `build/client/`.

## Type Checking

```bash
# From root
pnpm docs:types:check

# Or from apps/docs
pnpm types:check
```

## Deploy to Vercel

1. Import the repository in Vercel
2. Configure the project:

   | Setting | Value |
   |---------|-------|
   | **Root Directory** | `apps/docs` |
   | **Build Command** | `npx react-router build` |
   | **Output Directory** | `build/client` |
   | **Install Command** | Leave as default |

3. No environment variables are required
4. Deploy

The `react-router build` command runs the static prerender defined in `react-router.config.ts`, which generates pages for all MDX content under `content/docs/`.

## Content

Documentation content lives in `content/docs/` as `.mdx` files. Root `content/docs/meta.json` owns flat-section ordering. Only the MCP and dev-container groups own child ordering. See [Authoring docs](content/docs/contributing/authoring-docs.mdx) for navigation and compatibility-page rules. See the [Fumadocs docs](https://fumadocs.vercel.app/) for authoring details.
