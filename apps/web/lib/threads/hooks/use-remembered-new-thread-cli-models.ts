"use client";

import { useCallback, useState } from "react";
import type { CliModel, CliTypeSlug } from "@/lib/threads/types";
import {
  loadRememberedNewThreadCliSelection,
  rememberNewThreadCliModel,
  type RememberedNewThreadCliSelection,
} from "@/lib/threads/remembered-new-thread-cli-models";

export function useRememberedNewThreadCliModels() {
  const [selection, setSelection] = useState<RememberedNewThreadCliSelection>(
    () => loadRememberedNewThreadCliSelection(),
  );

  const rememberCliModel = useCallback(
    (cliType: CliTypeSlug, cliModel: CliModel | undefined, cliEffort?: string | undefined) => {
      setSelection(rememberNewThreadCliModel(cliType, cliModel, cliEffort));
    },
    [],
  );

  return {
    rememberedCliModels: selection.modelsByCliType,
    rememberedCliEfforts: selection.effortsByCliType,
    rememberedCliType: selection.lastCliType,
    rememberCliModel,
  };
}
