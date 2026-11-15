import type { DevSettingId } from "./constants";
import type { DevSettingsSnapshot } from "./storage";

export interface DevSettingControlledItem<Id extends string = string> {
  id: Id;
  devSettingId?: DevSettingId;
}

export function isDevSettingItemAvailable<Item extends DevSettingControlledItem>(
  item: Item,
  devSettings: DevSettingsSnapshot
): boolean {
  return item.devSettingId ? devSettings[item.devSettingId] : true;
}

export function getAvailableDevSettingItemId<Item extends DevSettingControlledItem>(
  items: readonly Item[],
  requestedId: Item["id"],
  devSettings: DevSettingsSnapshot,
  fallbackId: Item["id"]
): Item["id"] {
  const requestedItem = items.find((item) => item.id === requestedId);
  if (requestedItem && isDevSettingItemAvailable(requestedItem, devSettings)) {
    return requestedItem.id;
  }

  const fallbackItem = items.find(
    (item) =>
      item.id === fallbackId && isDevSettingItemAvailable(item, devSettings)
  );
  if (fallbackItem) {
    return fallbackItem.id;
  }

  const firstAvailableItem = items.find((item) =>
    isDevSettingItemAvailable(item, devSettings)
  );
  return firstAvailableItem ? firstAvailableItem.id : fallbackId;
}
