/**
 * @vitest-environment jsdom
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import type { ComponentType, SVGProps } from "react";
import { afterEach, describe, expect, test } from "vitest";

const iconFiles = readdirSync(__dirname).filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"));

describe("brand icons", () => {
  afterEach(cleanup);

  // A shared `id` lets one icon's hide/show invalidate every other instance's
  // filters, so a list of them repaints in full on each hover.
  test.each(iconFiles)("%s keeps its SVG ids unique per instance", async (file) => {
    const iconModule = (await import(path.join(__dirname, file))) as Record<string, unknown>;
    const Icon = (iconModule.default ?? Object.values(iconModule)[0]) as ComponentType<SVGProps<SVGSVGElement>>;
    const { container } = render(
      <>
        <Icon />
        <Icon />
      </>
    );

    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const svg of container.querySelectorAll("svg")) {
      const refs = [...svg.outerHTML.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
      for (const ref of refs) {
        expect(svg.querySelector(`[id="${ref}"]`), `url(#${ref}) resolves inside its own svg`).not.toBeNull();
      }
    }
  });
});
