import { describe, expect, test } from "vitest";
import { extractedCostModelUsageValidator, hydrateAvailableClis, splitAdvertisedCatalogs } from "./validators";

const PROFILE = "profile_1" as never;
const OTHER_PROFILE = "profile_2" as never;

// The two halves of the OS-1721 split: what a registration stores on the hot rows
// versus in `cliRuntimeCatalogs`, and how a reader puts them back together.
describe("advertised catalog projections", () => {
  test("splits advertised catalogs off the runtimes stored on the hot rows", () => {
    expect(
      splitAdvertisedCatalogs([
        {
          type: "opencode",
          version: "1.14.19",
          models: [{ slug: "openai/gpt-5", name: "GPT-5", variants: ["high"] }],
          defaultModel: "openai/gpt-5",
        },
        // Claude advertises a catalog nothing reads: dropped, not stored (OS-1721).
        {
          type: "claude-code",
          version: "2.1.52",
          provider: "bedrock",
          models: [{ slot: "opus", label: "Opus" }],
        },
        { type: "codex", version: "0.9.0" },
      ]),
    ).toEqual({
      runtimes: [
        { type: "opencode", version: "1.14.19" },
        { type: "claude-code", version: "2.1.52", provider: "bedrock" },
        { type: "codex", version: "0.9.0" },
      ],
      catalogs: [
        {
          cliType: "opencode",
          models: [{ slug: "openai/gpt-5", name: "GPT-5", variants: ["high"] }],
        },
      ],
    });
  });

  // The CLI reports three distinct states and the stored catalog must follow all
  // three: a 20s inventory timeout means "unknown", not "none" (OS-1721).
  test("keeps the three advertised states apart: known, empty, and unknown", () => {
    const catalogsFor = (cli: { type: "opencode"; version: string; models?: [] }) =>
      splitAdvertisedCatalogs([cli]).catalogs;

    // Inventory succeeded with nothing connected: an explicit empty catalog.
    expect(catalogsFor({ type: "opencode", version: "1.14.19", models: [] })).toEqual([
      { cliType: "opencode", models: [] },
    ]);

    // Inventory failed (`loadAdvertisedModels` returns undefined): no claim
    // about the catalog at all, so `models` stays absent.
    expect(catalogsFor({ type: "opencode", version: "1.14.19" })).toEqual([{ cliType: "opencode" }]);
  });

  test("hydration puts a catalog back on its runtime and leaves the rest alone", () => {
    expect(
      hydrateAvailableClis(
        [
          { type: "opencode", version: "1.14.19" },
          { type: "codex", version: "0.9.0" },
        ],
        [{ profileId: PROFILE, cliType: "opencode", models: [{ slug: "openai/gpt-5", name: "GPT-5" }] }],
        PROFILE,
      ),
    ).toEqual([
      {
        type: "opencode",
        version: "1.14.19",
        models: [{ slug: "openai/gpt-5", name: "GPT-5" }],
      },
      { type: "codex", version: "0.9.0" },
    ]);
  });

  // Callers batch catalogs for several profiles in one query, so scoping belongs
  // here rather than in a filter each of them has to remember.
  test("hydration ignores catalogs belonging to another profile", () => {
    expect(
      hydrateAvailableClis(
        [{ type: "opencode", version: "1.14.19" }],
        [{ profileId: OTHER_PROFILE, cliType: "opencode", models: [{ slug: "openai/gpt-5", name: "GPT-5" }] }],
        PROFILE,
      ),
    ).toEqual([{ type: "opencode", version: "1.14.19" }]);
  });

  test("hydration is a no-op without catalogs, so a loading subscription reads as unadvertised", () => {
    const runtimes = [{ type: "opencode" as const, version: "1.14.19" }];
    expect(hydrateAvailableClis(runtimes, [], PROFILE)).toEqual(runtimes);
  });
});


test("extraction contracts do not accept recorder-owned provenance", () => {
  expect(extractedCostModelUsageValidator.fields).not.toHaveProperty("costMetadata");
});
