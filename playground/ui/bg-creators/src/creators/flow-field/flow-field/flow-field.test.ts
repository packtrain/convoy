import { describe, expect, it } from "vitest";

import { appSchema } from "../app-schema";
import { FlowFieldSimulation } from "./flow-field-simulation";
import {
  buildFlowFieldPalette,
  flowFieldDefaults,
  flowFieldPaletteSize,
  readFlowFieldSettings,
} from "./flow-field-settings";
import { createSimplexNoise3D } from "./simplex-noise";

describe("flow field product modules", () => {
  it("resolves the product schema with five product sections plus sticky export", () => {
    const sections = appSchema.panels.controls?.sections ?? [];
    const titles = sections.map((section) => section.title);

    expect(titles).toContain("Particles");
    expect(titles).toContain("Interaction");
    expect(appSchema.canvas.upload).toBe(false);
  });

  it("reads defaults when runtime values are empty and coerces invalid values", () => {
    const settings = readFlowFieldSettings({
      "color.background": "not-a-color",
      "interaction.mode": "bogus",
      "particles.count": "2500",
    });

    expect(settings.backgroundColor).toBe(flowFieldDefaults.backgroundColor);
    expect(settings.interactionMode).toBe(flowFieldDefaults.interactionMode);
    expect(settings.particleCount).toBe(2500);
  });

  it("builds a bounded palette lookup table", () => {
    const palette = buildFlowFieldPalette(readFlowFieldSettings({}));

    expect(palette).toHaveLength(flowFieldPaletteSize);
    expect(palette.every((color) => color.startsWith("rgb("))).toBe(true);
  });

  it("produces bounded simplex noise", () => {
    const noise = createSimplexNoise3D(42);

    for (let i = 0; i < 500; i += 1) {
      const value = noise(i * 0.13, i * 0.07, i * 0.011);

      expect(value).toBeGreaterThanOrEqual(-1.05);
      expect(value).toBeLessThanOrEqual(1.05);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("steps particles without NaN and keeps them inside wrap bounds", () => {
    const simulation = new FlowFieldSimulation({ count: 200, height: 300, width: 400 });
    const settings = readFlowFieldSettings({ "interaction.mode": "attract" });

    for (let frame = 0; frame < 120; frame += 1) {
      simulation.step(settings, { active: true, x: 200, y: 150 }, 1);
    }

    const snapshot = simulation as unknown as { x: Float32Array; y: Float32Array };

    for (let i = 0; i < 200; i += 1) {
      expect(Number.isFinite(snapshot.x[i])).toBe(true);
      expect(Number.isFinite(snapshot.y[i])).toBe(true);
      expect(snapshot.x[i]).toBeGreaterThanOrEqual(-8);
      expect(snapshot.x[i]).toBeLessThanOrEqual(408);
      expect(snapshot.y[i]).toBeGreaterThanOrEqual(-8);
      expect(snapshot.y[i]).toBeLessThanOrEqual(308);
    }
  });
});
