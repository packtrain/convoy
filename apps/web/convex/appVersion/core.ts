import { v } from "convex/values";
import { query } from "../_generated/server";

function nonEmpty(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

export const get = query({
  args: {},
  returns: v.object({
    buildId: v.string(),
    buildTime: v.union(v.string(), v.null()),
    gitRef: v.union(v.string(), v.null()),
    vercelEnvironment: v.union(v.string(), v.null()),
  }),
  handler: async () => {
    return {
      buildId:
        process.env.CONVOY_BACKEND_BUILD_ID ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        "development",
      buildTime: nonEmpty(process.env.CONVOY_BACKEND_BUILD_TIME),
      gitRef: nonEmpty(
        process.env.CONVOY_BACKEND_GIT_REF ??
          process.env.VERCEL_GIT_COMMIT_REF
      ),
      vercelEnvironment: nonEmpty(
        process.env.CONVOY_BACKEND_VERCEL_ENV ?? process.env.VERCEL_ENV
      ),
    };
  },
});
