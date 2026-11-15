import { query, mutation } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { getOptionalAuthenticatedUser, getAuthenticatedUser } from "../lib/access/auth";
import {
  threadSortByValidator,
  cliFavoriteComboValidator,
  sectionHeaderStyleValidator,
  sectionColorStyleValidator,
  MAX_CLI_FAVORITE_COMBOS,
  type CliFavoriteCombo,
} from "../lib/contracts/validators";
import { buildPatch } from "../lib/shared/patch";
import { getPreferencesByUser, insertPreferences, updatePreferences, type UserPreferencesPatch } from "./lib/userPreferencesRepo";

const DEFAULTS = {
  threadSortBy: "created" as const,
  threadCompactLayout: true,
  threadGroupDone: true,
  pullRequestCompactLayout: false,
  cliFavoriteCombos: [] as CliFavoriteCombo[],
  sectionHeaderStyle: "compact" as const,
  sectionColorStyle: "tint" as const,
};

const preferencesReturnValidator = v.object({
  threadSortBy: threadSortByValidator,
  threadCompactLayout: v.boolean(),
  threadGroupDone: v.boolean(),
  pullRequestCompactLayout: v.boolean(),
  cliFavoriteCombos: v.array(cliFavoriteComboValidator),
  sectionHeaderStyle: sectionHeaderStyleValidator,
  sectionColorStyle: sectionColorStyleValidator,
});

export const get = query({
  args: {},
  returns: preferencesReturnValidator,
  handler: async (ctx) => {
    const user = await getOptionalAuthenticatedUser(ctx);
    if (!user) {
      return DEFAULTS;
    }

    const prefs = await getPreferencesByUser(ctx, user._id);
    if (!prefs) {
      return DEFAULTS;
    }

    return {
      threadSortBy: prefs.threadSortBy ?? DEFAULTS.threadSortBy,
      threadCompactLayout: prefs.threadCompactLayout ?? DEFAULTS.threadCompactLayout,
      threadGroupDone: prefs.threadGroupDone ?? DEFAULTS.threadGroupDone,
      pullRequestCompactLayout: prefs.pullRequestCompactLayout ?? DEFAULTS.pullRequestCompactLayout,
      cliFavoriteCombos: prefs.cliFavoriteCombos ?? DEFAULTS.cliFavoriteCombos,
      sectionHeaderStyle: prefs.sectionHeaderStyle ?? DEFAULTS.sectionHeaderStyle,
      sectionColorStyle: prefs.sectionColorStyle ?? DEFAULTS.sectionColorStyle,
    };
  },
});

export const upsert = mutation({
  args: {
    threadSortBy: v.optional(threadSortByValidator),
    threadCompactLayout: v.optional(v.boolean()),
    threadGroupDone: v.optional(v.boolean()),
    pullRequestCompactLayout: v.optional(v.boolean()),
    cliFavoriteCombos: v.optional(v.array(cliFavoriteComboValidator)),
    sectionHeaderStyle: v.optional(sectionHeaderStyleValidator),
    sectionColorStyle: v.optional(sectionColorStyleValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await getAuthenticatedUser(ctx);

    if (args.cliFavoriteCombos && args.cliFavoriteCombos.length > MAX_CLI_FAVORITE_COMBOS) {
      throw new ConvexError(`At most ${MAX_CLI_FAVORITE_COMBOS} favorites are allowed`);
    }

    const existing = await getPreferencesByUser(ctx, user._id);

    if (existing) {
      await updatePreferences(
        ctx,
        existing._id,
        buildPatch<UserPreferencesPatch>({
          threadSortBy: args.threadSortBy,
          threadCompactLayout: args.threadCompactLayout,
          threadGroupDone: args.threadGroupDone,
          pullRequestCompactLayout: args.pullRequestCompactLayout,
          cliFavoriteCombos: args.cliFavoriteCombos,
          sectionHeaderStyle: args.sectionHeaderStyle,
          sectionColorStyle: args.sectionColorStyle,
        })
      );
    } else {
      await insertPreferences(ctx, user._id, {
        threadSortBy: args.threadSortBy ?? DEFAULTS.threadSortBy,
        threadCompactLayout: args.threadCompactLayout ?? DEFAULTS.threadCompactLayout,
        threadGroupDone: args.threadGroupDone ?? DEFAULTS.threadGroupDone,
        pullRequestCompactLayout: args.pullRequestCompactLayout ?? DEFAULTS.pullRequestCompactLayout,
        cliFavoriteCombos: args.cliFavoriteCombos ?? DEFAULTS.cliFavoriteCombos,
        sectionHeaderStyle: args.sectionHeaderStyle ?? DEFAULTS.sectionHeaderStyle,
        sectionColorStyle: args.sectionColorStyle ?? DEFAULTS.sectionColorStyle,
      });
    }

    return null;
  },
});
