import type { DeltaPage } from "./types";

/** Returns true when the server signals the client should re-bootstrap. */
export function shouldRebootstrap(deltaPage: DeltaPage): boolean {
  return deltaPage.resetRequired;
}
