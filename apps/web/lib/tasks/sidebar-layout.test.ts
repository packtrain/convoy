import { describe, expect, test } from "vitest";
import { getEffectiveSidebarWidthPx } from "./sidebar-layout";

describe("sidebar-layout", () => {
  test("keeps requested sidebar width when there is enough room for minimum artifact width", () => {
    const width = getEffectiveSidebarWidthPx({
      containerWidthPx: 1200,
      requestedSidebarWidthPx: 400,
      minArtifactWidthPx: 240,
    });

    expect(width).toBe(400);
  });

  test("caps sidebar width to preserve minimum artifact width", () => {
    const width = getEffectiveSidebarWidthPx({
      containerWidthPx: 1200,
      requestedSidebarWidthPx: 1100,
      minArtifactWidthPx: 240,
    });

    expect(width).toBe(960);
  });

  test("returns 0 when container is narrower than minimum artifact width", () => {
    const width = getEffectiveSidebarWidthPx({
      containerWidthPx: 180,
      requestedSidebarWidthPx: 400,
      minArtifactWidthPx: 240,
    });

    expect(width).toBe(0);
  });
});
