import type { ToolcraftAppComposition } from "@/toolcraft/runtime/react";

export const creatorSlugs = [
  "ascii-art",
  "aurora",
  "flow-field",
  "grid-lines",
  "halftone",
] as const;

export type CreatorSlug = (typeof creatorSlugs)[number];

export type CreatorModule = {
  appComposition: ToolcraftAppComposition;
};

export type CreatorDefinition = {
  description: string;
  load: () => Promise<CreatorModule>;
  path: `/${CreatorSlug}`;
  slug: CreatorSlug;
  title: string;
};

export const creatorDefinitions = [
  {
    description:
      "Translate images into animated character fields with cursor-driven color reveal.",
    load: () => import("./ascii-art/app-composition"),
    path: "/ascii-art",
    slug: "ascii-art",
    title: "ASCII Art",
  },
  {
    description:
      "Compose drifting glow blobs with grain, vignette, seed, and seamless loops.",
    load: () => import("./aurora/app-composition"),
    path: "/aurora",
    slug: "aurora",
    title: "Aurora",
  },
  {
    description:
      "Shape simplex-noise particle streams with trails and interactive forces.",
    load: () => import("./flow-field/app-composition"),
    path: "/flow-field",
    slug: "flow-field",
    title: "Flow Field",
  },
  {
    description:
      "Build technical grids with scanlines, pulse cells, crosshairs, and cursor glow.",
    load: () => import("./grid-lines/app-composition"),
    path: "/grid-lines",
    slug: "grid-lines",
    title: "Grid Lines",
  },
  {
    description:
      "Convert images into animated dot matrices with hover reveal and duotone modes.",
    load: () => import("./halftone/app-composition"),
    path: "/halftone",
    slug: "halftone",
    title: "Halftone",
  },
] as const satisfies ReadonlyArray<CreatorDefinition>;
