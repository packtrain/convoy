import { describe, expect, test } from "vitest";
import { ESLint } from "eslint";

// Lints snippets against the real eslint.config.mjs (virtual file paths, so
// the type-aware project service is switched off — no-restricted-imports is
// purely syntactic). Guards the domain/module lib privacy globs at every
// folder depth; see docs/adr/0009-module-folders-inside-convex-domains.md.
const eslint = new ESLint({
  cwd: import.meta.dirname,
  overrideConfig: [
    {
      files: ["convex/**/*.ts"],
      languageOptions: { parserOptions: { projectService: false } },
    },
  ],
});

async function restrictedImportErrors(filePath: string, specifier: string) {
  const code = `import { probe } from "${specifier}";\nexport { probe };\n`;
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

async function expectBlocked(filePath: string, specifier: string) {
  expect(await restrictedImportErrors(filePath, specifier)).not.toHaveLength(0);
}

async function expectAllowed(filePath: string, specifier: string) {
  expect(await restrictedImportErrors(filePath, specifier)).toHaveLength(0);
}

describe("domain lib privacy globs", () => {
  test("cross-domain import of a domain lib is blocked", async () => {
    await expectBlocked("convex/tasks/core.ts", "../organizations/lib/validators");
  });

  test("cross-domain import of a module lib is blocked", async () => {
    await expectBlocked("convex/tasks/core.ts", "../cli/threads/lib/enrichment");
  });

  test("sibling-module import of a module lib is blocked", async () => {
    await expectBlocked("convex/cli/messages.ts", "./threads/lib/itemShape");
  });

  test("deep-source cross-domain import of a domain lib is blocked", async () => {
    await expectBlocked(
      "convex/mcp/lib/tasks/lists/resolution.ts",
      "../../../../tasks/lib/searchText"
    );
  });

  test("same-module lib import is allowed", async () => {
    await expectAllowed("convex/cli/threads/lists.ts", "./lib/enrichment");
  });

  test("module file importing its domain lib is allowed", async () => {
    await expectAllowed("convex/cli/threads/lists.ts", "../lib/constants");
  });

  test("domain file importing its own lib is allowed", async () => {
    await expectAllowed("convex/cli/messages.ts", "./lib/constants");
  });

  test("*Repo import at module depth is allowed", async () => {
    await expectBlocked("convex/tasks/core.ts", "../cli/threads/lib/enrichment");
    await expectAllowed("convex/tasks/core.ts", "../cli/threads/lib/cliThreadsRepo");
  });

  test("nested *Repo import inside a domain lib is allowed", async () => {
    await expectAllowed("convex/tasks/core.ts", "../cli/lib/login/requestsRepo");
  });

  test("root convex/lib import is allowed at every source depth", async () => {
    await expectAllowed("convex/cli/messages.ts", "../lib/shared/ensure");
    await expectAllowed("convex/cli/threads/lists.ts", "../../lib/shared/ensure");
    await expectAllowed(
      "convex/mcp/lib/tasks/lists/resolution.ts",
      "../../../../lib/shared/ensure"
    );
  });
});

describe("UI deep modules", () => {
  test("the integrations module is importable only through its index", async () => {
    await expectBlocked("app/o/page.tsx", "@/components/blocks/integrations/github/pull-requests-page");
    await expectAllowed("app/o/page.tsx", "@/components/blocks/integrations");
  });
});

describe("migrations carve-out", () => {
  test("migrations may reach cli/lib and tasks/lib but no other domain lib", async () => {
    await expectAllowed("convex/migrations.ts", "./cli/lib/runtimes/shared/parsing");
    await expectAllowed("convex/migrations.ts", "./tasks/lib/searchText");
    await expectBlocked("convex/migrations.ts", "./organizations/lib/validators");
  });

  test("migrations may not reach a module lib except via *Repo", async () => {
    await expectBlocked("convex/migrations.ts", "./cli/threads/lib/enrichment");
    await expectAllowed("convex/migrations.ts", "./cli/threads/lib/cliThreadsRepo");
  });
});

describe("transitional cli/lib carve-out", () => {
  test("registerBody.ts may reach cli/lib but not other domain libs", async () => {
    await expectAllowed(
      "convex/lib/http/registerBody.ts",
      "../../cli/lib/runtimes/shared/contracts"
    );
    await expectBlocked("convex/lib/http/registerBody.ts", "../../tasks/lib/searchText");
  });

  test("apps/web lib (outside convex/) stays importable", async () => {
    await expectAllowed("convex/lib/contracts/validators.ts", "../../../lib/tasks/status");
  });

  test("the carve-out does not extend to module libs", async () => {
    await expectBlocked(
      "convex/lib/contracts/validators.ts",
      "../../cli/threads/lib/enrichment"
    );
  });
});

describe("caught error messages in UI code", () => {
  async function rawMessageErrors(filePath: string, code: string) {
    const [result] = await eslint.lintText(code, { filePath });
    return result!.messages.filter((m) => m.ruleId === "no-restricted-syntax");
  }

  const ternary = `export function f(error: unknown) {\n  return error instanceof Error ? error.message : "Failed";\n}\n`;
  const catchBlock = `export function f(run: () => void, show: (m: string) => void) {\n  try {\n    run();\n  } catch (err) {\n    show((err as Error).message);\n  }\n}\n`;
  const promiseCatch = `export function f(p: Promise<void>, show: (m: string) => void) {\n  return p.catch((error) => show(error.message));\n}\n`;
  const helper = `import { getErrorMessage } from "@/lib/errors";\nexport function f(run: () => void, show: (m: string) => void) {\n  try {\n    run();\n  } catch (error) {\n    show(getErrorMessage(error, "Failed"));\n  }\n}\n`;

  test.each([
    "components/blocks/x/row.tsx",
    "app/o/page.tsx",
    "hooks/ui/use-x.ts",
    "providers/x-provider.tsx",
  ])("flags an instanceof Error ternary in %s", async (filePath) => {
    expect(await rawMessageErrors(filePath, ternary)).toHaveLength(1);
  });

  test("flags a message read inside a catch block", async () => {
    expect(await rawMessageErrors("components/blocks/x/row.tsx", catchBlock)).toHaveLength(1);
  });

  test("flags a message read inside a promise .catch callback", async () => {
    expect(await rawMessageErrors("components/blocks/x/row.tsx", promiseCatch)).toHaveLength(1);
  });

  test("allows getErrorMessage", async () => {
    expect(await rawMessageErrors("components/blocks/x/row.tsx", helper)).toHaveLength(0);
  });

  test("leaves non-UI code and tests alone", async () => {
    expect(await rawMessageErrors("lib/errors.ts", ternary)).toHaveLength(0);
    expect(await rawMessageErrors("components/blocks/x/row.test.tsx", ternary)).toHaveLength(0);
  });
});

describe("hand-composed empty states", () => {
  async function emptyStatePartErrors(filePath: string, names: string) {
    const code = `import { ${names} } from "@/components/custom/empty-state";\nexport { ${names} };\n`;
    const [result] = await eslint.lintText(code, { filePath });
    return result!.messages.filter((m) => m.ruleId === "no-restricted-syntax");
  }

  test.each(["EmptyMedia", "EmptyHeader", "EmptyTitle", "EmptyDescription"])("flags importing %s", async (name) => {
    const errors = await emptyStatePartErrors("components/blocks/x/section.tsx", name);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("EmptyState");
  });

  test("flags the parts in app routes too", async () => {
    expect(await emptyStatePartErrors("app/o/page.tsx", "EmptyTitle")).toHaveLength(1);
  });

  test("allows EmptyState, Empty, EmptyContent and EmptyMessage", async () => {
    expect(
      await emptyStatePartErrors("components/blocks/x/section.tsx", "EmptyState, Empty, EmptyContent, EmptyMessage")
    ).toHaveLength(0);
  });

  test("leaves tests and the playground alone", async () => {
    expect(await emptyStatePartErrors("components/blocks/x/section.test.tsx", "EmptyMedia")).toHaveLength(0);
    expect(await emptyStatePartErrors("app/playground/x/page.tsx", "EmptyMedia")).toHaveLength(0);
  });

  test("keeps the caught error rule in the playground", async () => {
    const code = `export function f(error: unknown) {\n  return error instanceof Error ? error.message : "Failed";\n}\n`;
    const [result] = await eslint.lintText(code, { filePath: "app/playground/x/page.tsx" });
    expect(result!.messages.filter((m) => m.ruleId === "no-restricted-syntax")).toHaveLength(1);
  });
});
