import { APP_URL_FALLBACK, getAppUrlBase } from "../../../lib/shared/appUrl";

export const TASK_URL_BASE_FALLBACK = APP_URL_FALLBACK;

export function getTaskUrlBase(): string {
  return getAppUrlBase();
}
