import {
  isCliType,
  isSupportedCliEffort,
  isSupportedCliModel,
} from "@/lib/cli-runtime-ui/registry";
import type { CliModel, CliTypeSlug } from "./types";
import { isRecord } from "@/lib/type-guards";
import { readLocalJson, writeLocalJson } from "@/lib/browser/local-storage";

export type RememberedNewThreadCliModels = Partial<
  Record<CliTypeSlug, CliModel>
>;

export type RememberedNewThreadCliEfforts = Partial<
  Record<CliTypeSlug, string>
>;

export interface RememberedCliCombo {
  cliModel: CliModel;
  cliEffort?: string;
}

export type RememberedNewThreadCliCombos = Partial<
  Record<CliTypeSlug, RememberedCliCombo[]>
>;

interface PersistedRememberedNewThreadCliModelsV1 {
  version: 1;
  modelsByCliType: RememberedNewThreadCliModels;
  effortsByCliType?: RememberedNewThreadCliEfforts;
  combosByCliType?: RememberedNewThreadCliCombos;
  lastCliType?: CliTypeSlug;
}

const STORAGE_KEY = "convoy.remembered-new-thread-cli-models";
const STORAGE_VERSION = 1;
const MAX_RECENT_COMBOS = 3;

function sanitizeRememberedModels(
  value: unknown,
): RememberedNewThreadCliModels {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: RememberedNewThreadCliModels = {};

  for (const [cliType, cliModel] of Object.entries(value)) {
    if (!isCliType(cliType)) {
      continue;
    }

    if (!isSupportedCliModel(cliType, cliModel)) {
      continue;
    }

    sanitized[cliType] = cliModel;
  }

  return sanitized;
}

function sanitizeRememberedEfforts(
  value: unknown,
  // The remembered effort for a cliType pairs with the remembered model for
  // that cliType (they are written together on send), so validate with that
  // model as context — per-model effort variants (OpenCode) need it.
  models: RememberedNewThreadCliModels,
): RememberedNewThreadCliEfforts {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: RememberedNewThreadCliEfforts = {};

  for (const [cliType, cliEffort] of Object.entries(value)) {
    if (!isCliType(cliType)) {
      continue;
    }

    if (!isSupportedCliEffort(cliType, cliEffort, { cliModel: models[cliType] })) {
      continue;
    }

    sanitized[cliType] = cliEffort;
  }

  return sanitized;
}

function sanitizeRememberedCombos(
  value: unknown,
): RememberedNewThreadCliCombos {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: RememberedNewThreadCliCombos = {};

  for (const [cliType, combos] of Object.entries(value)) {
    if (!isCliType(cliType) || !Array.isArray(combos)) {
      continue;
    }

    const valid: RememberedCliCombo[] = [];
    for (const combo of combos) {
      if (!isRecord(combo) || !isSupportedCliModel(cliType, combo.cliModel)) {
        continue;
      }
      const cliEffort = isSupportedCliEffort(cliType, combo.cliEffort, {
        cliModel: combo.cliModel,
      })
        ? combo.cliEffort
        : undefined;
      valid.push({ cliModel: combo.cliModel, cliEffort });
    }

    if (valid.length > 0) {
      sanitized[cliType] = valid.slice(0, MAX_RECENT_COMBOS);
    }
  }

  return sanitized;
}

export interface RememberedNewThreadCliSelection {
  modelsByCliType: RememberedNewThreadCliModels;
  effortsByCliType: RememberedNewThreadCliEfforts;
  combosByCliType: RememberedNewThreadCliCombos;
  lastCliType: CliTypeSlug | undefined;
}

const EMPTY_SELECTION: RememberedNewThreadCliSelection = {
  modelsByCliType: {},
  effortsByCliType: {},
  combosByCliType: {},
  lastCliType: undefined,
};

export function loadRememberedNewThreadCliSelection(): RememberedNewThreadCliSelection {
  const parsed = readLocalJson(STORAGE_KEY);
  if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
    return EMPTY_SELECTION;
  }

  const modelsByCliType = sanitizeRememberedModels(parsed.modelsByCliType);
  return {
    modelsByCliType,
    effortsByCliType: sanitizeRememberedEfforts(
      parsed.effortsByCliType,
      modelsByCliType,
    ),
    combosByCliType: sanitizeRememberedCombos(parsed.combosByCliType),
    lastCliType: isCliType(parsed.lastCliType) ? parsed.lastCliType : undefined,
  };
}

export function loadRememberedNewThreadCliModels(): RememberedNewThreadCliModels {
  return loadRememberedNewThreadCliSelection().modelsByCliType;
}

export function loadRememberedNewThreadCliEfforts(): RememberedNewThreadCliEfforts {
  return loadRememberedNewThreadCliSelection().effortsByCliType;
}

export function rememberNewThreadCliModel(
  cliType: CliTypeSlug,
  cliModel: CliModel | undefined,
  cliEffort?: string | undefined,
): RememberedNewThreadCliSelection {
  const current = loadRememberedNewThreadCliSelection();

  const validModel =
    cliModel && isSupportedCliModel(cliType, cliModel) ? cliModel : undefined;
  const validEffort =
    cliEffort !== undefined &&
    isSupportedCliEffort(cliType, cliEffort, { cliModel: validModel })
      ? cliEffort
      : undefined;

  const nextModels = validModel
    ? { ...current.modelsByCliType, [cliType]: validModel }
    : current.modelsByCliType;
  const nextEfforts =
    validEffort !== undefined
      ? { ...current.effortsByCliType, [cliType]: validEffort }
      : current.effortsByCliType;

  let nextCombos = current.combosByCliType;
  if (validModel) {
    const combo: RememberedCliCombo = { cliModel: validModel, cliEffort: validEffort };
    const existing = current.combosByCliType[cliType] ?? [];
    nextCombos = {
      ...current.combosByCliType,
      [cliType]: [
        combo,
        ...existing.filter(
          (entry) =>
            entry.cliModel !== combo.cliModel ||
            (entry.cliEffort ?? "default") !== (combo.cliEffort ?? "default"),
        ),
      ].slice(0, MAX_RECENT_COMBOS),
    };
  }

  const payload: PersistedRememberedNewThreadCliModelsV1 = {
    version: STORAGE_VERSION,
    modelsByCliType: nextModels,
    effortsByCliType: nextEfforts,
    combosByCliType: nextCombos,
    lastCliType: cliType,
  };
  writeLocalJson(STORAGE_KEY, payload);

  return {
    modelsByCliType: nextModels,
    effortsByCliType: nextEfforts,
    combosByCliType: nextCombos,
    lastCliType: cliType,
  };
}
