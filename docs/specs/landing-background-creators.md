# Landing background creators

## Status

Implemented as a playground-only multi-product Toolcraft host at
`playground/ui/bg-creators`.

## Purpose

Five background creators for the landing page (`apps/landing`) share the
same Toolcraft runtime and build toolchain. They run as one Vite project so the
shared runtime, dependencies, and verification configuration have one source
of truth.

## Routes

The host exposes one stable URL per creator:

| Route | Creator |
| --- | --- |
| `/ascii-art` | Image-driven animated ASCII |
| `/aurora` | Animated glow blobs |
| `/flow-field` | Particle flow field |
| `/grid-lines` | Animated technical grid |
| `/halftone` | Image-driven animated halftone |

The root route renders an index of all five creators. Every index entry links
to its stable creator route and can preload that creator composition on pointer
or keyboard intent. Unknown routes use the router's not-found handling.

## Architecture

- `src/toolcraft/` contains one immutable Toolcraft runtime snapshot.
- `src/creators/<slug>/` owns each creator's schema, composition, renderer,
  export behavior, and supporting modules.
- The creator registry is the seam between routing and product code. Each
  entry supplies a slug, display name, description, and lazy composition
  loader. The index renders only this metadata and does not eagerly load any
  creator renderer.
- The shared host is the only module that renders `ToolcraftApp`. Creator
  modules continue to expose `ToolcraftAppComposition` and do not build runtime
  chrome themselves.
- Creator modules are loaded only for the active route so the initial bundle
  does not contain all five renderers.
- Route changes remount `ToolcraftApp` by creator slug, preventing runtime
  state from leaking between creators.
- Shared public assets use one canonical path. Creator-specific persistence,
  when added, must use a creator-specific storage key.

## Verification

- TypeScript checks every creator because the registry imports every lazy
  composition path.
- Unit coverage verifies route uniqueness and that every lazy loader resolves
  a valid Toolcraft composition.
- Browser smoke coverage opens every public route, verifies the Toolcraft shell
  and product output are present, and verifies the index links to every creator.
- A production build must emit separate lazy creator chunks.

## Non-goals

- The migration does not redesign creator controls or renderer behavior.
- The landing page itself (`apps/landing`) remains a separate project; the
  creators only supply its effect parameters.
- The merged host is not a newly generated single-product Toolcraft export;
  generated contract documents are retained as runtime reference material.
