import { defineToolcraft } from "@/toolcraft/runtime";

import { auroraDefaults, auroraSeedMax, auroraSeedMin, auroraTargets } from "./aurora/aurora-settings";

export const randomizeSeedActionValue = "aurora.randomize-seed";
export const exportPngActionValue = "aurora.export-png";

export const appSchema = defineToolcraft({
  canvas: {
    enabled: true,
    renderScale: true,
    size: { height: 900, unit: "px", width: 1600 },
    sizing: { mode: "editable-output" },
    upload: false,
  },
  panels: {
    controls: {
      sections: [
        {
          controls: {
            blobCount: {
              defaultValue: auroraDefaults.blobCount,
              label: "Count",
              max: 7,
              min: 3,
              performanceReason:
                "Each blob adds a radial gradient pass to the low-resolution blob layer every frame.",
              performanceRole: "workload",
              sliderValueKind: "discrete",
              step: 1,
              target: auroraTargets.blobCount,
              type: "slider",
            },
            blobSize: {
              defaultValue: auroraDefaults.blobSize,
              label: "Base size",
              max: 100,
              min: 10,
              performanceReason:
                "Blob radius scales the gradient footprint painted per frame.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: auroraTargets.blobSize,
              type: "slider",
              unit: "%",
            },
            blur: {
              defaultValue: auroraDefaults.blur,
              description:
                "How soft the glow edges are; applied when upscaling the low-resolution blob layer.",
              label: "Blur",
              max: 100,
              min: 0,
              performanceReason:
                "Blur radius controls the canvas filter cost of the upscale pass.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 1,
              target: auroraTargets.blur,
              type: "slider",
              unit: "%",
            },
            blendMode: {
              defaultValue: auroraDefaults.blendMode,
              label: "Blend",
              options: [
                { label: "Screen", value: "screen" },
                { label: "Lighter", value: "lighter" },
                { label: "Normal", value: "normal" },
              ],
              performanceReason:
                "Blend mode swaps the composite operation used while painting blobs.",
              performanceRole: "responsiveness",
              target: auroraTargets.blendMode,
              type: "segmented",
            },
            seed: {
              defaultValue: auroraDefaults.seed,
              description:
                "Deterministic layout seed; the same seed always produces the same blob arrangement.",
              label: "Seed",
              max: auroraSeedMax,
              min: auroraSeedMin,
              performanceReason:
                "Seed changes recompute blob parameters and repaint one frame.",
              performanceRole: "responsiveness",
              sliderValueKind: "discrete",
              step: 1,
              target: auroraTargets.seed,
              type: "slider",
            },
            randomize: {
              actions: [
                {
                  icon: "shuffle",
                  label: "Randomize seed",
                  value: randomizeSeedActionValue,
                },
              ],
              label: false,
              target: "aurora.randomize",
              type: "actions",
            },
          },
          title: "Blobs",
        },
        {
          controls: {
            backgroundColor: {
              defaultValue: auroraDefaults.backgroundColor,
              label: "Background",
              performanceReason:
                "Background fill repaints one frame on change.",
              performanceRole: "responsiveness",
              target: auroraTargets.backgroundColor,
              type: "color",
            },
            color1: {
              defaultValue: auroraDefaults.colors[0],
              label: "Glow 1",
              performanceReason: "Color change repaints one frame.",
              performanceRole: "responsiveness",
              target: auroraTargets.color1,
              type: "color",
            },
            color2: {
              defaultValue: auroraDefaults.colors[1],
              label: "Glow 2",
              performanceReason: "Color change repaints one frame.",
              performanceRole: "responsiveness",
              target: auroraTargets.color2,
              type: "color",
            },
            color3: {
              defaultValue: auroraDefaults.colors[2],
              label: "Glow 3",
              performanceReason: "Color change repaints one frame.",
              performanceRole: "responsiveness",
              target: auroraTargets.color3,
              type: "color",
            },
            color4: {
              defaultValue: auroraDefaults.colors[3],
              label: "Glow 4",
              performanceReason: "Color change repaints one frame.",
              performanceRole: "responsiveness",
              target: auroraTargets.color4,
              type: "color",
            },
            intensity: {
              defaultValue: auroraDefaults.intensity,
              label: "Intensity",
              max: 100,
              min: 0,
              performanceReason:
                "Global opacity scales gradient alpha painted per frame.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: auroraTargets.intensity,
              type: "slider",
              unit: "%",
            },
          },
          title: "Palette",
        },
        {
          controls: {
            grainEnabled: {
              defaultValue: auroraDefaults.grainEnabled,
              label: "Film grain",
              performanceReason:
                "Grain toggles a pattern-fill overlay pass per frame.",
              performanceRole: "workload",
              target: auroraTargets.grainEnabled,
              type: "switch",
            },
            grainIntensity: {
              defaultValue: auroraDefaults.grainIntensity,
              label: "Intensity",
              max: 100,
              min: 0,
              performanceReason:
                "Grain alpha only changes overlay opacity of the precomputed tile.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: auroraTargets.grainIntensity,
              type: "slider",
              unit: "%",
              visibleWhen: { equals: true, target: auroraTargets.grainEnabled },
            },
            grainAnimated: {
              defaultValue: auroraDefaults.grainAnimated,
              description:
                "Re-offsets the noise tile every frame for a subtle film flicker.",
              label: "Animated",
              performanceReason:
                "Animated grain forces a repaint every frame even when blobs are idle.",
              performanceRole: "workload",
              target: auroraTargets.grainAnimated,
              type: "switch",
              visibleWhen: { equals: true, target: auroraTargets.grainEnabled },
            },
          },
          title: "Grain",
        },
        {
          controls: {
            animate: {
              defaultValue: auroraDefaults.animate,
              label: "Animate",
              performanceReason:
                "Animation drives the continuous requestAnimationFrame repaint loop.",
              performanceRole: "workload",
              target: auroraTargets.animate,
              type: "switch",
            },
            speed: {
              defaultValue: auroraDefaults.speed,
              label: "Speed",
              max: 100,
              min: 0,
              performanceReason:
                "Speed changes phase advance per frame without extra paint cost.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: auroraTargets.speed,
              type: "slider",
              unit: "%",
              visibleWhen: { equals: true, target: auroraTargets.animate },
            },
            drift: {
              defaultValue: auroraDefaults.drift,
              description:
                "How far each blob orbits around its anchor point over one seamless loop.",
              label: "Drift range",
              max: 100,
              min: 0,
              performanceReason:
                "Drift changes orbit radii and repaints one frame.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: auroraTargets.drift,
              type: "slider",
              unit: "%",
            },
            parallax: {
              defaultValue: auroraDefaults.parallax,
              description:
                "Blobs shift toward the cursor with a different depth factor per blob.",
              label: "Mouse parallax",
              max: 100,
              min: 0,
              performanceReason:
                "Parallax triggers repaints while the pointer moves.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: auroraTargets.parallax,
              type: "slider",
              unit: "%",
            },
          },
          title: "Motion",
        },
        {
          controls: {
            vignette: {
              defaultValue: auroraDefaults.vignette,
              label: "Vignette",
              performanceReason:
                "Vignette toggles one radial-gradient overlay pass per frame.",
              performanceRole: "workload",
              target: auroraTargets.vignette,
              type: "switch",
            },
            vignetteStrength: {
              defaultValue: auroraDefaults.vignetteStrength,
              label: "Strength",
              max: 100,
              min: 0,
              performanceReason:
                "Strength only changes overlay gradient alpha.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: auroraTargets.vignetteStrength,
              type: "slider",
              unit: "%",
              visibleWhen: { equals: true, target: auroraTargets.vignette },
            },
          },
          title: "Frame",
        },
        {
          controls: {
            imageFormat: {
              defaultValue: "png",
              label: "Format",
              options: [{ label: "PNG", value: "png" }],
              performanceReason:
                "Export format only affects the one-off export encode.",
              performanceRole: "responsiveness",
              target: "export.image.format",
              type: "select",
            },
            imageResolution: {
              defaultValue: "current",
              label: "Resolution",
              options: [
                { label: "Current size", value: "current" },
                { label: "2K", value: "2k" },
                { label: "4K", value: "4k" },
              ],
              performanceReason:
                "Export resolution only affects the one-off export render size.",
              performanceRole: "responsiveness",
              target: "export.image.resolution",
              type: "select",
            },
          },
          title: "Image Export",
        },
        {
          controls: {
            exportActions: {
              actions: [
                {
                  icon: "download",
                  label: "Export PNG",
                  role: "export-image",
                  value: exportPngActionValue,
                },
              ],
              label: false,
              target: "panel.actions",
              type: "panelActions",
            },
          },
          title: "Export",
        },
      ],
      title: "Aurora",
    },
  },
  toolbar: {
    history: true,
    radar: true,
    theme: true,
    zoom: true,
  },
});
