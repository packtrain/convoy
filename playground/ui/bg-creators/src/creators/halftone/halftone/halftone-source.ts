import type { ToolcraftMediaAsset, ToolcraftState } from "@/toolcraft/runtime";

export const halftoneSourceTarget = "source.image";

/**
 * Resolves the current halftone source image asset from runtime media state,
 * respecting layer visibility. Returns null when no source is attached.
 */
export function findHalftoneSourceAsset(state: ToolcraftState): ToolcraftMediaAsset | null {
  for (const asset of state.mediaAssets) {
    if (asset.sourceTarget !== halftoneSourceTarget) {
      continue;
    }

    const layer = state.layers.find((candidate) => candidate.id === asset.layerId);

    if (layer && !layer.visible) {
      continue;
    }

    return asset;
  }

  return null;
}

export function loadHalftoneImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();

  image.decoding = "async";
  image.src = dataUrl;

  return image
    .decode()
    .then(() => image)
    .catch(() => {
      // decode() can reject for images that would still paint; fall back to load events.
      return new Promise<HTMLImageElement>((resolve, reject) => {
        if (image.complete && image.naturalWidth > 0) {
          resolve(image);
          return;
        }

        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Halftone source image failed to load."));
      });
    });
}
