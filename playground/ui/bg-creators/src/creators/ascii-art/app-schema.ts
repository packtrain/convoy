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
              label: "Image",
              performanceReason:
                "Replacing the source image triggers a full grid resample.",
              performanceRole: "workload",
              target: "source.image",
              type: "fileDrop",
            },
          },
          title: "Source",
        },
        {
          controls: {
            ramp: {
              defaultValue: "classic",
              label: "Character set",
              options: [
                { label: "Classic ( .:-=+*#%@)", value: "classic" },
                { label: "Blocks (░▒▓█)", value: "blocks" },
                { label: "Binary (01)", value: "binary" },
                { label: "Custom", value: "custom" },
              ],
              performanceReason:
                "Swapping the ramp only remaps precomputed luminance to glyphs.",
              performanceRole: "responsiveness",
              target: "chars.ramp",
              type: "select",
            },
            customChars: {
              commitMode: "content",
              defaultValue: " .:-=+*#%@",
              description:
                "Characters ordered from darkest to brightest. Start with a space to keep dark areas empty.",
              label: "Custom characters",
              performanceReason:
                "Typing custom glyphs only remaps the existing luminance grid.",
              performanceRole: "responsiveness",
              target: "chars.custom",
              textValueKind: "single-line",
              type: "text",
              visibleWhen: { equals: "custom", target: "chars.ramp" },
            },
            cellSize: {
              defaultValue: 12,
              label: "Cell size",
              max: 32,
              min: 8,
              performanceReason:
                "Cell size sets the character grid density and per-frame glyph count.",
              performanceRole: "workload",
              sliderValueKind: "discrete",
              step: 1,
              target: "chars.cellSize",
              type: "slider",
              unit: "px",
            },
            fontWeight: {
              defaultValue: "400",
              label: "Weight",
              options: [
                { label: "Light", value: "300" },
                { label: "Regular", value: "400" },
                { label: "Semibold", value: "600" },
                { label: "Bold", value: "700" },
              ],
              performanceReason:
                "Font weight changes only restyle the glyph pass.",
              performanceRole: "responsiveness",
              target: "chars.fontWeight",
              type: "select",
            },
          },
          title: "Character",
        },
        {
          controls: {
            brightness: {
              defaultValue: 0,
              label: "Brightness",
              max: 100,
              min: -100,
              performanceReason:
                "Tone edits resample the small offscreen grid once per change.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "tone.brightness",
              type: "slider",
            },
            contrast: {
              defaultValue: 0,
              label: "Contrast",
              max: 100,
              min: -100,
              performanceReason:
                "Tone edits resample the small offscreen grid once per change.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "tone.contrast",
              type: "slider",
            },
            gamma: {
              defaultValue: 1,
              label: "Gamma",
              max: 2.5,
              min: 0.2,
              performanceReason:
                "Tone edits resample the small offscreen grid once per change.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "tone.gamma",
              type: "slider",
            },
            invert: {
              defaultValue: false,
              label: "Invert",
              performanceReason:
                "Invert flips precomputed luminance without touching the source image.",
              performanceRole: "responsiveness",
              target: "tone.invert",
              type: "switch",
            },
          },
          title: "Tone",
        },
        {
          controls: {
            colorMode: {
              defaultValue: "hover",
              label: "Mode",
              options: [
                { label: "Mono", value: "mono" },
                { label: "Hover reveal", value: "hover" },
                { label: "Full color", value: "full" },
              ],
              performanceReason:
                "Color mode switches which precomputed per-cell style set is used.",
              performanceRole: "responsiveness",
              target: "color.mode",
              type: "segmented",
            },
            tint: {
              defaultValue: "#d9d9d9",
              label: "Tint",
              performanceReason:
                "Tint only rebuilds the small quantized mono style table.",
              performanceRole: "responsiveness",
              target: "color.tint",
              type: "color",
              visibleWhen: { notEquals: "full", target: "color.mode" },
            },
            hoverRadius: {
              defaultValue: 220,
              label: "Hover radius",
              max: 600,
              min: 40,
              performanceReason:
                "Radius bounds how many cells receive per-frame color mixing.",
              performanceRole: "workload",
              sliderValueKind: "continuous",
              step: 1,
              target: "color.hoverRadius",
              type: "slider",
              unit: "px",
              visibleWhen: { equals: "hover", target: "color.mode" },
            },
            falloff: {
              defaultValue: 60,
              label: "Falloff softness",
              max: 100,
              min: 0,
              performanceReason:
                "Falloff changes only the color mix curve inside the hover disk.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 1,
              target: "color.falloff",
              type: "slider",
              unit: "%",
              visibleWhen: { equals: "hover", target: "color.mode" },
            },
          },
          title: "Color",
        },
        {
          controls: {
            animate: {
              defaultValue: true,
              label: "Animate",
              performanceReason:
                "Toggles the requestAnimationFrame shimmer loop on and off.",
              performanceRole: "workload",
              target: "motion.enabled",
              type: "switch",
            },
            speed: {
              defaultValue: 1,
              label: "Speed",
              max: 3,
              min: 0.1,
              performanceReason:
                "Speed only scales the shimmer time input per frame.",
              performanceRole: "responsiveness",
              sliderValueKind: "continuous",
              step: 0.05,
              target: "motion.speed",
              type: "slider",
              unit: "x",
              visibleWhen: { equals: true, target: "motion.enabled" },
            },
            amplitude: {
              defaultValue: 18,
              label: "Amplitude",
              max: 100,
              min: 0,
              performanceReason:
                "Amplitude only scales the per-cell shimmer offset per frame.",
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
                "Background include only toggles one fill before the glyph pass.",
              performanceRole: "responsiveness",
              target: "export.includeBackground",
              type: "switch",
            },
            backgroundColor: {
              defaultValue: "#060606",
              label: false,
              performanceReason:
                "Background color only changes one fill before the glyph pass.",
              performanceRole: "responsiveness",
              target: "appearance.background",
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
            imageFormat: {
              defaultValue: "png",
              label: "Format",
              options: [
                { label: "PNG", value: "png" },
                { label: "JPG", value: "jpg" },
              ],
              performanceReason:
                "Export format only selects the encoder for the export pass.",
              performanceRole: "responsiveness",
              target: "export.image.format",
              type: "select",
            },
            imageResolution: {
              defaultValue: "4k",
              label: "Resolution",
              options: [
                { label: "2K", value: "2k" },
                { label: "4K", value: "4k" },
                { label: "8K", value: "8k" },
              ],
              performanceReason:
                "Export resolution scales only the one-off export canvas.",
              performanceRole: "responsiveness",
              target: "export.image.resolution",
              type: "select",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["imageFormat", "imageResolution"],
              layout: "inline",
            },
          ],
          title: "Image Export",
        },
        {
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
          title: "Export",
        },
      ],
      title: "ASCII Art",
    },
  },
  toolbar: {
    history: true,
    radar: true,
    zoom: true,
  },
});
