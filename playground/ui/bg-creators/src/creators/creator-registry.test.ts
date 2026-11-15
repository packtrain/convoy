import { describe, expect, it } from "vitest";

import { creatorDefinitions, creatorSlugs } from "./creator-registry";

describe("creator registry", () => {
  it("defines one stable route for every creator", () => {
    const slugs = creatorDefinitions.map(({ slug }) => slug);
    const paths = creatorDefinitions.map(({ path }) => path);

    expect(slugs).toEqual(creatorSlugs);
    expect(new Set(slugs).size).toBe(creatorDefinitions.length);
    expect(new Set(paths).size).toBe(creatorDefinitions.length);
    expect(paths).toEqual(creatorSlugs.map((slug) => `/${slug}`));
  });

  it.each(creatorDefinitions)(
    "loads the $title composition",
    async ({ load }) => {
      const { appComposition } = await load();

      expect(appComposition.schema).toBeDefined();
      expect(appComposition.canvasContent).toBeDefined();
    },
    15_000,
  );
});
