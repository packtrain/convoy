import type { ToolcraftMediaAsset, ToolcraftState } from "@/toolcraft/runtime";

export const asciiSourceTarget = "source.image";

export function getAsciiSourceAsset(state: ToolcraftState): ToolcraftMediaAsset | null {
  const hiddenLayerIds = new Set(
    state.layers.filter((layer) => !layer.visible).map((layer) => layer.id),
  );

  return (
    state.mediaAssets.find(
      (asset) =>
        asset.sourceTarget === asciiSourceTarget && !hiddenLayerIds.has(asset.layerId),
    ) ?? null
  );
}

export function loadAsciiSourceImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}
