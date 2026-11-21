import { v, type Infer } from "convex/values";
import { isRecord } from "@/lib/type-guards";

/**
 * A model in an advertised catalog (OpenCode, Antigravity): the run slug, the picker
 * label and the per-model effort variants. Stored in `cliRuntimeCatalogs` (OS-1721).
 */
export const cliCatalogModelValidator = v.object({
  slug: v.string(),
  name: v.string(),
  variants: v.optional(v.array(v.string())),
});
export type CliCatalogModel = Infer<typeof cliCatalogModelValidator>;

/** Server-side ceiling for a stored catalog; the CLI's cap cannot bind an old or hostile client. */
export const MAX_STORED_CATALOG_MODELS = 1000;
export const MAX_STORED_CATALOG_VARIANTS = 20;
const MAX_CATALOG_STRING_LENGTH = 200;

function isCatalogString(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_CATALOG_STRING_LENGTH;
}

/** One advertised model, or null when malformed. Extra fields from older CLIs are dropped. */
export function toCliCatalogModel(value: unknown): CliCatalogModel | null {
  if (!isRecord(value) || !isCatalogString(value.slug) || !isCatalogString(value.name)) {
    return null;
  }
  if (value.variants === undefined) {
    return { slug: value.slug, name: value.name };
  }
  if (!Array.isArray(value.variants) || value.variants.some((variant) => typeof variant !== "string")) {
    return null;
  }
  return {
    slug: value.slug,
    name: value.name,
    variants: (value.variants as string[]).slice(0, MAX_STORED_CATALOG_VARIANTS),
  };
}

/**
 * Fail-soft: malformed models are skipped and the list is capped, so a version-skewed
 * CLI never fails its registration. Undefined (catalog unknown) when `value` is not an array.
 */
export function toCliCatalogModels(value: unknown): CliCatalogModel[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map(toCliCatalogModel)
    .filter((model): model is CliCatalogModel => model !== null)
    .slice(0, MAX_STORED_CATALOG_MODELS);
}
