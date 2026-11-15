# Background creators

This folder is one multi-product Toolcraft playground. It is not a standalone
single-product generated export.

## Structure

- `src/toolcraft/` is the shared immutable Toolcraft runtime snapshot. Do not
  edit it for creator-specific behavior.
- `src/creators/<slug>/` owns one creator's schema, composition, renderer, and
  export behavior.
- `src/creators/creator-registry.ts` is the routing seam. Add a creator there
  with a stable slug, title, index description, and lazy composition loader.
- `src/creators/creator-host.tsx` is the only creator host that renders
  `ToolcraftApp`.

Creators must continue to expose a typed `ToolcraftAppComposition`. Keep
product output in `canvasContent`, product settings in Toolcraft schema state,
and runtime chrome in the shared host.

## Verification

Run `npm run test`, `npm run build`, and `npm run test:browser` after changing
routes or creator behavior. Browser coverage must open every public creator
URL. Keep creator modules lazy-loaded so one route does not eagerly bundle all
renderers.

The retained `docs/toolcraft/` folder documents the runtime snapshot. Creator
decision histories live under `docs/creators/`.
