# UI playground

Two separate UI prototyping projects. Neither ships; both graduate by being
copied into `apps/web` or `apps/landing`.

## Root — Next.js prototypes

pnpm workspace member (package name stays `ui-playground`; `@convoy/ui` would
read as a shared design-system package, which this is not).

```bash
pnpm --filter ui-playground dev
```

- `/mdx-editor` — MDX editor prototype
  ([spec](../../docs/specs/ui-playground-mdx-editor.md)). It graduated to
  `apps/web/app/playground/mdx-editor`; the `ui-playground-admonition-*` class
  names in `apps/web/app/globals.css` come from here.

## `bg-creators/` — five Toolcraft background tools

Deliberately **not** a workspace member: it pins TypeScript 6 / Vite 8 and
installs with npm, so the root `pnpm.overrides` and lockfile must not reach it.
`pnpm-workspace.yaml` globs `playground/*`, so nesting one level down is what
keeps it out. It is excluded from this project's `tsconfig.json` and eslint
config for the same reason.

```bash
cd bg-creators && npm install && npm run dev
```

| Tool | What it makes |
|---|---|
| `ascii-art` | Image → animated ASCII, mouse color-reveal. Default: the design gradient. |
| `halftone` | Image → animated dot matrix, hover color-reveal, duotone modes. Source of truth for `apps/landing/components/effects/halftone-hero.tsx`. |
| `grid-lines` | Generative blueprint grid: hairlines, crosshairs, pulsing cells, scanline, cursor glow. |
| `flow-field` | Simplex-noise particle streams with trails, attract/repel mouse modes. |
| `aurora` | Linear-style drifting glow blobs, grain, vignette, seeded + seamless loop. |

Routes: `/ascii-art`, `/halftone`, `/grid-lines`, `/flow-field`, `/aurora`; the
root route indexes all five. Spec:
[landing-background-creators.md](../../docs/specs/landing-background-creators.md).

The tools meet a pragmatic bar (typecheck, build, dev-server smoke) — the full
Toolcraft acceptance/perf gates were intentionally not authored.

Dark mode only. The landing-page version gallery (v1–v6) that used to sit
beside these shipped as `apps/landing`; recover the older concepts from git
history if needed.
