import { defineToolcraft } from "@/toolcraft/runtime";

export const appSchema = defineToolcraft({
  canvas: {
    enabled: true,
    renderScale: true,
    sizing: { mode: "editable-output" },
    upload: true,
  },
  media: {
    defaultAssets: [
      {
        assetKind: "image",
        dataUrl: "/gradient.jpg",
        fileName: "gradient.jpg",
        id: "default-source",
        mimeType: "image/jpeg",
        sourceTarget: "source.image",
      },
    ],
  },
  panels: {
    controls: {
      sections: [
        {
          controls: {
            sourceImage: {
              assetKind: "image",
              defaultValue: null,
              label: "Image",
              performanceReason:
                "Replacing the source image forces a full grid resample of the halftone dot matrix.",
              performanceRole: "workload",
              target: "source.image",
              type: "fileDrop",
            },
          },
          title: "Source",
        },
        {
          controls: {
            gridSpacing: {
              defaultValue: 14,
              label: "Spacing",
              max: 48,
              min: 6,
              performanceReason:
                "Spacing sets the dot count of the sampled grid and directly scales per-frame draw workload.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 1,
              target: "grid.spacing",
              type: "slider",
              unit: "px",
            },
            gridAngle: {
              defaultValue: 0,
              label: "Screen angle",
              max: 90,
              min: 0,
              performanceReason:
                "Rotating the screen re-samples the grid but keeps dot count comparable; it must stay responsive while dragging.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "grid.angle",
              type: "slider",
              unit: "°",
            },
            gridShape: {
              defaultValue: "circle",
              label: "Dot shape",
              options: [
                { label: "Circle", value: "circle" },
                { label: "Square", value: "square" },
                { label: "Diamond", value: "diamond" },
              ],
              performanceReason:
                "Shape switches the per-dot path primitive without changing grid workload.",
              performanceRole: "responsiveness",
              target: "grid.shape",
              type: "select",
            },
          },
          title: "Grid",
        },
        {
          controls: {
            toneBrightness: {
              defaultValue: 0,
              label: "Brightness",
              max: 100,
              min: -100,
              performanceReason:
                "Tone mapping is applied through a cached lookup table; slider drags must repaint dots live.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "tone.brightness",
              type: "slider",
            },
            toneContrast: {
              defaultValue: 0,
              label: "Contrast",
              max: 100,
              min: -100,
              performanceReason:
                "Tone mapping is applied through a cached lookup table; slider drags must repaint dots live.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "tone.contrast",
              type: "slider",
            },
            toneGamma: {
              defaultValue: 1,
              label: "Gamma",
              max: 3,
              min: 0.2,
              performanceReason:
                "Gamma feeds the tone lookup table; it repaints dots without resampling the grid.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "tone.gamma",
              type: "slider",
            },
            toneInvert: {
              defaultValue: false,
              description:
                "Flips the classic mapping so darker source areas render the bigger dots.",
              label: "Invert",
              performanceReason:
                "Invert flips the tone lookup table and only repaints dots.",
              performanceRole: "responsiveness",
              target: "tone.invert",
              type: "switch",
            },
            toneMinDot: {
              defaultValue: 0,
              description: "Smallest dot size as a percentage of one grid cell.",
              label: "Min dot size",
              max: 90,
              min: 0,
              performanceReason:
                "Dot size bounds change per-dot radii only and must track slider drags live.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "tone.minDot",
              type: "slider",
              unit: "%",
            },
            toneMaxDot: {
              defaultValue: 100,
              description: "Largest dot size as a percentage of one grid cell.",
              label: "Max dot size",
              max: 160,
              min: 10,
              performanceReason:
                "Dot size bounds change per-dot radii only and must track slider drags live.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "tone.maxDot",
              type: "slider",
              unit: "%",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["toneMinDot", "toneMaxDot"],
              layout: "inline",
            },
          ],
          title: "Tone",
        },
        {
          controls: {
            colorMode: {
              defaultValue: "hover-reveal",
              description:
                "Hover reveal keeps dots monochrome and paints the sampled source colors around the cursor.",
              label: "Color mode",
              options: [
                { label: "Mono", value: "mono" },
                { label: "Duotone", value: "duotone" },
                { label: "Hover reveal", value: "hover-reveal" },
                { label: "Full color", value: "full-color" },
              ],
              performanceReason:
                "Full color and hover reveal switch the renderer from batched paths to per-dot fills.",
              performanceRole: "workload",
              target: "color.mode",
              type: "select",
            },
            colorTint: {
              defaultValue: "#93a0b8",
              label: "Mono tint",
              performanceReason:
                "Tint changes fill styles only and repaints without resampling.",
              performanceRole: "responsiveness",
              target: "color.tint",
              type: "color",
            },
            colorDuotone: {
              defaultValue: "#3730a3",
              description: "Shadow-end color blended toward the mono tint in highlights.",
              label: "Duotone color",
              performanceReason:
                "Duotone blending is bucketed into a fixed number of fill batches.",
              performanceRole: "responsiveness",
              target: "color.duotone",
              type: "color",
              visibleWhen: { equals: "duotone", target: "color.mode" },
            },
            colorHoverRadius: {
              defaultValue: 220,
              label: "Hover radius",
              max: 600,
              min: 40,
              performanceReason:
                "Hover radius bounds how many dots take the per-dot colored fill path each frame.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 5,
              target: "color.hoverRadius",
              type: "slider",
              unit: "px",
              visibleWhen: { equals: "hover-reveal", target: "color.mode" },
            },
            colorFalloff: {
              defaultValue: 60,
              description: "How softly the color reveal fades out toward the hover radius edge.",
              label: "Falloff",
              max: 100,
              min: 0,
              performanceReason:
                "Falloff changes the per-dot blend weight math without changing dot count.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "color.falloff",
              type: "slider",
              unit: "%",
              visibleWhen: { equals: "hover-reveal", target: "color.mode" },
            },
          },
          title: "Color",
        },
        {
          controls: {
            motionEnabled: {
              defaultValue: true,
              label: "Animate",
              performanceReason:
                "Toggling animation starts or parks the requestAnimationFrame redraw loop.",
              performanceRole: "workload",
              target: "motion.enabled",
              type: "switch",
            },
            motionSpeed: {
              defaultValue: 1,
              label: "Speed",
              max: 3,
              min: 0.1,
              performanceReason:
                "Speed only scales the phase of the idle pulse; frame cost is unchanged.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.1,
              target: "motion.speed",
              type: "slider",
              unit: "x",
              visibleWhen: { equals: true, target: "motion.enabled" },
            },
            motionAmplitude: {
              defaultValue: 8,
              description: "How far dot sizes breathe around their sampled size during the idle pulse.",
              label: "Pulse amplitude",
              max: 30,
              min: 0,
              performanceReason:
                "Amplitude scales the per-dot pulse term without changing workload.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "motion.amplitude",
              type: "slider",
              unit: "%",
              visibleWhen: { equals: true, target: "motion.enabled" },
            },
          },
          title: "Motion",
        },
        {
          controls: {
            includeBackground: {
              defaultValue: true,
              label: "Include",
              performanceReason:
                "Background inclusion toggles one full-canvas fill per frame.",
              performanceRole: "responsiveness",
              target: "export.includeBackground",
              type: "switch",
            },
            backgroundColor: {
              defaultValue: "#08080d",
              label: false,
              performanceReason:
                "Background color changes one fill style and repaints without resampling.",
              performanceRole: "responsiveness",
              target: "scene.background",
              type: "color",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["includeBackground", "backgroundColor"],
              layout: "inline",
            },
          ],
          title: "Background",
        },
        {
          controls: {
            imageExportFormat: {
              defaultValue: "png",
              label: "Format",
              options: [
                { label: "PNG", value: "png" },
                { label: "JPG", value: "jpg" },
              ],
              target: "export.image.format",
              type: "select",
            },
            imageExportResolution: {
              defaultValue: "4k",
              label: "Resolution",
              options: [
                { label: "2K", value: "2k" },
                { label: "4K", value: "4k" },
                { label: "8K", value: "8k" },
              ],
              target: "export.image.resolution",
              type: "select",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["imageExportFormat", "imageExportResolution"],
              layout: "inline",
            },
          ],
          title: "Image Export",
        },
        {
          actionGroup: "primary",
          controls: {
            exportActions: {
              actions: [
                {
                  icon: "upload-simple",
                  label: "Export PNG",
                  role: "export-image",
                  value: "export-image",
                },
              ],
              target: "panel.actions",
              type: "panelActions",
            },
          },
        },
      ],
      title: "Halftone",
    },
  },
  toolbar: {
    history: true,
    radar: true,
    theme: true,
    zoom: true,
  },
});
