// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isEventInsideCurrentTarget, isTaskTableInteractiveTarget } from "./table-interaction";

it("allows native card dragging from its detail trigger but excludes nested controls", () => {
  const body = document.createElement("div");
  body.setAttribute("role", "button");
  body.setAttribute("data-task-card-body", "");
  const title = document.createElement("span");
  const control = document.createElement("button");
  body.append(title, control);

  expect(isTaskTableInteractiveTarget(title)).toBe(true);
  expect(isTaskTableInteractiveTarget(title, { allowTaskCardBodyDrag: true })).toBe(false);
  expect(isTaskTableInteractiveTarget(control, { allowTaskCardBodyDrag: true })).toBe(true);
});

describe("isEventInsideCurrentTarget", () => {
  it("accepts events whose target is inside the current target", () => {
    const row = document.createElement("div");
    const cell = document.createElement("span");
    row.appendChild(cell);

    expect(isEventInsideCurrentTarget({ currentTarget: row, target: cell })).toBe(true);
    expect(isEventInsideCurrentTarget({ currentTarget: row, target: row })).toBe(true);
  });

  it("rejects portal-bubbled events whose target lives outside the row DOM", () => {
    // Overlays (drawer content/overlay, menus) are portalled to body but
    // React re-dispatches their events through the row's React tree.
    const row = document.createElement("div");
    const portalledOverlay = document.createElement("div");
    document.body.append(row, portalledOverlay);

    expect(
      isEventInsideCurrentTarget({ currentTarget: row, target: portalledOverlay })
    ).toBe(false);

    row.remove();
    portalledOverlay.remove();
  });

  it("rejects events without element targets", () => {
    const row = document.createElement("div");
    expect(isEventInsideCurrentTarget({ currentTarget: row, target: null })).toBe(false);
    expect(isEventInsideCurrentTarget({ currentTarget: null, target: row })).toBe(false);
  });
});
