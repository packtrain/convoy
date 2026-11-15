import { defineToolcraft } from "@/toolcraft/runtime";

export const appSchema = defineToolcraft({
  canvas: {
    enabled: true,
    renderScale: true,
    upload: false,
  },
  panels: {
    controls: {
      sections: [
        {
          controls: {
            cellSize: {
              defaultValue: 56,
              label: "Cell size",
              max: 160,
              min: 24,
              performanceReason:
                "Smaller cells multiply the number of grid lines, crosshairs, and pulse candidates drawn every frame.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 2,
              target: "grid.cellSize",
              type: "slider",
              unit: "px",
            },
            lineThickness: {
              defaultValue: 1,
              label: "Line thickness",
              max: 3,
              min: 0.5,
              performanceReason:
                "Stroke width changes per-line raster cost only marginally; it must stay responsive while dragging.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.25,
              target: "grid.lineThickness",
              type: "slider",
              unit: "px",
            },
            lineColor: {
              defaultValue: "#2e3646",
              label: "Line color",
              performanceReason:
                "Color changes invalidate the cached grid layer and must repaint without lag.",
              performanceRole: "responsiveness",
              target: "grid.lineColor",
              type: "color",
            },
            lineOpacity: {
              defaultValue: 55,
              label: "Line opacity",
              max: 100,
              min: 5,
              performanceReason:
                "Opacity changes invalidate the cached grid layer and must repaint without lag.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "grid.lineOpacity",
              type: "slider",
              unit: "%",
            },
            crosshairSize: {
              defaultValue: 6,
              description:
                "Length of the + tick drawn at grid intersections. 0 hides crosshairs.",
              label: "Crosshair size",
              max: 20,
              min: 0,
              performanceReason:
                "Crosshair size adds two short strokes per marked intersection to the cached grid layer.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "grid.crosshairSize",
              type: "slider",
              unit: "px",
            },
            crosshairOpacity: {
              defaultValue: 80,
              label: "Crosshair opacity",
              max: 100,
              min: 0,
              performanceReason:
                "Opacity changes invalidate the cached grid layer and must repaint without lag.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "grid.crosshairOpacity",
              type: "slider",
              unit: "%",
            },
            crosshairEvery: {
              defaultValue: 2,
              description: "Draw a + mark at every Nth grid intersection.",
              label: "Crosshair every",
              max: 8,
              min: 1,
              performanceReason:
                "Lower values multiply the crosshair count drawn into the cached grid layer.",
              performanceRole: "workload",
              sliderValueKind: "discrete",
              step: 1,
              target: "grid.crosshairEvery",
              type: "slider",
            },
          },
          title: "Grid",
        },
        {
          controls: {
            accentColor: {
              defaultValue: "#6aa2ff",
              label: "Accent color",
              performanceReason:
                "Accent color repaints pulses, scanline, and the glow layer and must stay responsive.",
              performanceRole: "responsiveness",
              target: "accent.color",
              type: "color",
            },
            pulseDensity: {
              defaultValue: 8,
              description:
                "Approximate number of cells that softly light up per minute. 0 disables pulses.",
              label: "Pulse density",
              max: 30,
              min: 0,
              performanceReason:
                "Each pulse slot adds a filled and stroked cell per frame while active.",
              performanceRole: "workload",
              sliderValueKind: "discrete",
              step: 1,
              target: "accent.pulseDensity",
              type: "slider",
            },
            pulseIntensity: {
              defaultValue: 45,
              label: "Pulse intensity",
              max: 100,
              min: 0,
              performanceReason:
                "Intensity scales pulse alpha only; it must track slider drags without stutter.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "accent.pulseIntensity",
              type: "slider",
              unit: "%",
            },
            scanline: {
              defaultValue: true,
              label: "Scanline",
              performanceReason:
                "Toggling adds or removes one gradient band draw per frame.",
              performanceRole: "responsiveness",
              target: "accent.scanline",
              type: "switch",
            },
            scanlineSpeed: {
              defaultValue: 25,
              label: "Scanline speed",
              max: 100,
              min: 1,
              performanceReason:
                "Speed only changes the band position per frame; draw cost is constant.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "accent.scanlineSpeed",
              type: "slider",
              visibleWhen: { equals: true, target: "accent.scanline" },
            },
            scanlineDirection: {
              defaultValue: "horizontal",
              label: "Scanline direction",
              options: [
                { label: "Horizontal", value: "horizontal" },
                { label: "Vertical", value: "vertical" },
              ],
              performanceReason:
                "Direction swaps the gradient axis; draw cost is constant.",
              performanceRole: "responsiveness",
              target: "accent.scanlineDirection",
              type: "segmented",
              visibleWhen: { equals: true, target: "accent.scanline" },
            },
          },
          title: "Accents",
        },
        {
          controls: {
            glowRadius: {
              defaultValue: 160,
              label: "Glow radius",
              max: 400,
              min: 40,
              performanceReason:
                "Radius sizes the masked accent-layer region composited around the cursor each frame.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 10,
              target: "interaction.glowRadius",
              type: "slider",
              unit: "px",
            },
            glowStrength: {
              defaultValue: 60,
              description:
                "How strongly lines near the cursor brighten toward the accent color. 0 disables the glow.",
              label: "Glow strength",
              max: 100,
              min: 0,
              performanceReason:
                "Strength scales the glow mask alpha only; compositing cost is constant.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "interaction.glowStrength",
              type: "slider",
              unit: "%",
            },
          },
          title: "Interaction",
        },
        {
          controls: {
            animate: {
              defaultValue: true,
              description:
                "Master animation switch. Off freezes pulses, scanline, and wobble at the current frame.",
              label: "Animate",
              performanceReason:
                "Disabling animation stops per-frame redraws entirely except for cursor glow updates.",
              performanceRole: "workload",
              target: "motion.enabled",
              type: "switch",
            },
            speed: {
              defaultValue: 100,
              label: "Speed",
              max: 300,
              min: 10,
              performanceReason:
                "Speed scales virtual time only; per-frame draw cost is unchanged.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 5,
              target: "motion.speed",
              type: "slider",
              unit: "%",
              visibleWhen: { equals: true, target: "motion.enabled" },
            },
            wobble: {
              defaultValue: false,
              description:
                "Low-amplitude noise displacement of grid lines for a breathing, technical feel.",
              label: "Wobble",
              performanceReason:
                "Wobble forces the cached grid layer to re-render every frame with sampled polylines.",
              performanceRole: "workload",
              target: "motion.wobble",
              type: "switch",
              visibleWhen: { equals: true, target: "motion.enabled" },
            },
          },
          title: "Motion",
        },
        {
          controls: {
            backgroundColor: {
              defaultValue: "#05070b",
              label: "Color",
              performanceReason:
                "Background fill is one rect per frame; color changes must repaint immediately.",
              performanceRole: "responsiveness",
              target: "background.color",
              type: "color",
            },
          },
          title: "Background",
        },
      ],
      title: "Grid Lines",
    },
  },
  toolbar: {
    history: true,
    radar: true,
    theme: true,
    zoom: true,
  },
});
