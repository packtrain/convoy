"use client";

import { useCallback, useMemo } from "react";
import { useUserPreferences } from "@/lib/preferences/use-user-preferences";
import {
  sanitizeCliFavoriteCombos,
  toggleCliFavoriteCombo,
  type CliFavoriteCombo,
} from "../cli-favorite-combos";

const EMPTY_COMBOS: CliFavoriteCombo[] = [];

/**
 * Favorite CLI+model+effort combos for the CLI selector (OS-1208), persisted
 * on userPreferences and sanitized against the runtime registry on read.
 */
export function useCliFavoriteCombos() {
  const { cliFavoriteCombos, setCliFavoriteCombos } = useUserPreferences();

  const favoriteCombos = useMemo(
    () => sanitizeCliFavoriteCombos(cliFavoriteCombos ?? EMPTY_COMBOS),
    [cliFavoriteCombos],
  );

  const toggleFavoriteCombo = useCallback(
    (combo: CliFavoriteCombo) => {
      void setCliFavoriteCombos(toggleCliFavoriteCombo(favoriteCombos, combo));
    },
    [favoriteCombos, setCliFavoriteCombos],
  );

  return { favoriteCombos, toggleFavoriteCombo };
}
