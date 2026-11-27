import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { migrations } from "./migrations";
import { createTestContext } from "../convex-testing/context";

describe("migrations.runAll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Every deploy calls it with no arguments (docs/specs/automatic-migrations.md).
  test("runs every migration to completion, and a second deploy changes nothing", async () => {
    const { t } = createTestContext();
    const deploy = async () => {
      await t.mutation(internal.migrations.runAll, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      return await t.run((ctx) => migrations.getStatus(ctx, {}));
    };

    const first = await deploy();
    expect(first.length).toBeGreaterThan(0);
    expect(first.filter((m) => !m.isDone || m.error)).toEqual([]);

    expect(await deploy()).toEqual(first);
  });
});
