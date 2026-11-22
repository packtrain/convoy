import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { toPricingRates, type PricingCatalog } from "../convex/costs/lib/pricing/validators";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BEDROCK_KEY = /^((global|us|eu|apac|au|jp)\.|bedrock_mantle\/)(anthropic\.claude-|openai\.gpt-\d)[^/ ]*$/;
// Direct Gemini API rows (OS-2481), priced for Antigravity runs.
const GEMINI_KEY = /^gemini\/gemini-\d[^/ :]*$/;

export function pricingSourceUrl(revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("A full upstream commit SHA is required");
  return `https://raw.githubusercontent.com/BerriAI/litellm/${revision}/model_prices_and_context_window.json`;
}

export function buildPricingCatalog(sourceText: string, revision: string, retrievedOn: string): PricingCatalog {
  const sourceUrl = pricingSourceUrl(revision);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(retrievedOn) ||
    !Number.isFinite(Date.parse(retrievedOn)) ||
    new Date(retrievedOn).toISOString().slice(0, 10) !== retrievedOn
  ) {
    throw new Error("retrievedOn must be a valid YYYY-MM-DD date");
  }
  const source: unknown = JSON.parse(sourceText);
  if (!isRecord(source)) throw new Error("Expected an upstream model map");
  const models: PricingCatalog["models"] = {};
  for (const key of Object.keys(source).sort()) {
    const direct = /^(claude-|gpt-\d|o\d|codex-)/.test(key) && !/[/ :]|audio|realtime|search/.test(key);
    // AWS rows (OS-2105): geo/global inference profiles and Mantle, never region-pinned spellings.
    const bedrock = BEDROCK_KEY.test(key) && !/audio|realtime|search/.test(key);
    const gemini = GEMINI_KEY.test(key) && !/audio|realtime|search|tts|computer-use|image|live/.test(key);
    if (!direct && !bedrock && !gemini) continue;
    const entry = source[key];
    // Pointer rows (`claude-fable-latest`) carry no rates; the target row does.
    if (isRecord(entry) && "alias_of" in entry) continue;
    if (!isRecord(entry) || typeof entry.litellm_provider !== "string" || typeof entry.mode !== "string") {
      throw new Error(`Invalid model entry: ${key}`);
    }
    const providers = direct ? ["openai", "anthropic"] : gemini ? ["gemini"] : ["bedrock_converse", "bedrock_mantle"];
    if (!providers.includes(entry.litellm_provider) || !["chat", "responses"].includes(entry.mode)) continue;
    models[key] = toPricingRates(entry);
  }
  if (Object.keys(models).length === 0) throw new Error("No supported models in source");
  return {
    snapshotVersion: `litellm-v3-${revision}`,
    sourceUrl,
    sourceRevision: revision,
    sourceSha256: createHash("sha256").update(sourceText).digest("hex"),
    retrievedOn,
    units: "USD/token",
    tariffBasis: "standard-short-context-api-equivalent",
    models,
  };
}

export async function refreshModelPricing(options: {
  revision: string;
  retrievedOn: string;
  destination: string;
  readSource?: (url: string) => Promise<string>;
}) {
  const url = pricingSourceUrl(options.revision);
  const source = await (
    options.readSource ??
    (async (sourceUrl) => {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Pricing download failed: HTTP ${response.status}`);
      return response.text();
    })
  )(url);
  const catalog = buildPricingCatalog(source, options.revision, options.retrievedOn);
  const temporary = await mkdtemp(join(dirname(options.destination), ".pricing-"));
  try {
    const path = join(temporary, "catalog.json");
    await writeFile(path, JSON.stringify(catalog, null, 2) + "\n");
    await rename(path, options.destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return catalog;
}

async function main() {
  const [revision, retrievedOn, sourceFile] = process.argv.slice(2);
  if (!revision || !retrievedOn)
    throw new Error("Usage: pnpm exec tsx apps/web/scripts/refreshModelPricing.ts <commit-sha> <YYYY-MM-DD> [source-file]");
  const catalog = await refreshModelPricing({
    revision,
    retrievedOn,
    destination: join(__dirname, "../convex/costs/lib/pricing/catalog.json"),
    readSource: sourceFile ? () => readFile(sourceFile, "utf8") : undefined,
  });
  console.log(`Wrote ${Object.keys(catalog.models).length} models (${catalog.snapshotVersion})`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
