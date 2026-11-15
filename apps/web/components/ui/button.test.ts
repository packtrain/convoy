import { describe, expect, test } from "vitest";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

describe("buttonVariants", () => {
  test("icon-sm owns the compact panel-header glyph size", () => {
    const classes = cn(buttonVariants({ size: "icon-sm" }));

    expect(classes).toContain("[&_svg:not([class*='size-'])]:size-3.5");
    expect(classes).not.toContain("[&_svg:not([class*='size-'])]:size-4");
  });
});
