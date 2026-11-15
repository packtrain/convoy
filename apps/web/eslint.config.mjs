import { defineConfig, globalIgnores } from "eslint/config";
import convexPlugin from "@convex-dev/eslint-plugin";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { sharedIgnores } from "../../eslint-shared.mjs";

const navigationImportPaths = [
  {
    name: "next/navigation",
    message:
      "Use @/lib/navigation wrappers so URL state and transport stay consistent.",
  },
  {
    name: "next/link",
    message:
      "Use AppLink from @/lib/navigation so route construction stays centralized.",
  },
  {
    name: "@/lib/routing/urls",
    message:
      "Use @/lib/navigation route builders and URL-state adapters.",
  },
];

// Deep modules (docs/guidelines/architecture.md → Deep modules): outside the
// module's folders only its index is importable.
const watchTowerModuleFiles = ["components/blocks/watch-tower/**/*", "lib/watch-tower/**/*"];
const worktreesModuleFiles = ["components/blocks/worktrees/**/*", "lib/worktrees/**/*"];
const editLastMessageModuleFiles = ["components/blocks/thread/edit-last-message/**/*"];
const backgroundTasksModuleFiles = ["components/blocks/background-tasks/**/*"];

// `.message` on an identifier (`error.message`) or a cast (`(error as Error).message`).
const caughtErrorMessage =
  'MemberExpression[property.name="message"]:matches([object.type="Identifier"], [object.type="TSAsExpression"])';

// A caught error's raw `message` can carry the "[CONVEX M(...)] Server
// Error" prefix; getErrorMessage returns the clean ConvexError data.
const caughtErrorMessageRule = {
  selector: [
    `CatchClause ${caughtErrorMessage}`,
    `CallExpression[callee.property.name="catch"] > :function ${caughtErrorMessage}`,
    `ConditionalExpression[test.operator="instanceof"][test.right.name="Error"] > ${caughtErrorMessage}.consequent`,
  ].join(", "),
  message:
    "Show caught errors through getErrorMessage or showConvexErrorToast from @/lib/errors, not error.message.",
};

// docs/guidelines/frontend-development.md#empty-states
const emptyStatePartsRule = {
  selector:
    'ImportDeclaration:matches([source.value="@/components/custom/empty-state"], [source.value="./empty-state"]) > ImportSpecifier[imported.name=/^Empty(Media|Header|Title|Description)$/]',
  message: "Render empty states with EmptyState from @/components/custom/empty-state; its parts are internal.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/navigation/**/*", ...worktreesModuleFiles, ...watchTowerModuleFiles, ...backgroundTasksModuleFiles, ...editLastMessageModuleFiles],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: navigationImportPaths,
          patterns: [
            { group: ["@/components/blocks/watch-tower/*", "@/lib/watch-tower/**"], message: "Import Watch Tower through @/components/blocks/watch-tower." },
            { group: ["@/components/blocks/task-grouping/*"], message: "Import task grouping through @/components/blocks/task-grouping." },
            {
              group: ["@/components/blocks/account-usage/*"],
              message: "Import account usage through @/components/blocks/account-usage.",
            },
            {
              group: ["@/components/blocks/thread/edit-last-message/*", "../edit-last-message/*"],
              message: "Import the edit-last-message module through its index.",
            },
            {
              group: ["@/components/blocks/checks/*"],
              message: "Import the checks module through @/components/blocks/checks.",
            },
            {
              group: ["@/components/blocks/integrations/*"],
              message: "Import the integrations module through @/components/blocks/integrations.",
            },
            {
              group: ["@/components/blocks/evidence/*"],
              message: "Import the evidence module through @/components/blocks/evidence.",
            },
            {
              group: ["@/components/blocks/background-tasks/*"],
              message: "Import the background tasks module through @/components/blocks/background-tasks.",
            },
            {
              group: ["@/app/playground/github-integration/prototype/*"],
              message: "Import the GitHub playground through its prototype index.",
            },
            {
              group: ["@/components/blocks/worktrees/*", "@/lib/worktrees/**"],
              message:
                "The worktrees module is a deep module: import only from @/components/blocks/worktrees.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [...worktreesModuleFiles, ...watchTowerModuleFiles, ...backgroundTasksModuleFiles, ...editLastMessageModuleFiles],
    rules: {
      "no-restricted-imports": ["error", { paths: navigationImportPaths }],
    },
  },
  {
    files: ["{components,app,hooks,providers}/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", caughtErrorMessageRule, emptyStatePartsRule],
    },
  },
  {
    // Prototypes may hand-compose empty states; they share no-restricted-syntax, so restate the error rule.
    files: ["app/playground/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", caughtErrorMessageRule],
    },
  },
  {
    files: ["convex/**/*.ts", "convex-testing/**/*.ts"],
    plugins: {
      "@convex-dev": convexPlugin,
    },
    rules: {
      "@convex-dev/explicit-table-ids": "error",
    },
  },
  {
    // The `tasks` table has a single write chokepoint so derived fields can't
    // be forgotten. Direct ctx.db.insert/patch/replace("tasks", ...) is banned
    // everywhere except the helper module itself, the one-time migration, and
    // tests (which deliberately set up partial/edge states).
    files: ["convex/**/*.ts", "convex-testing/**/*.ts"],
    ignores: [
      "convex/tasks/lib/tasksRepo.ts",
      "convex/migrations.ts",
      "convex/**/*.test.ts",
      "convex-testing/**/*.test.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(insert|patch|replace)$/][arguments.0.value='tasks']",
          message:
            "Write to the tasks table via insertTask/patchTask from convex/tasks/lib/tasksRepo.ts.",
        },
      ],
    },
  },
  {
    // Private lib boundary: a `lib/` folder belongs to the domain or module
    // folder that contains it, at any depth (convex/lib → <domain>/lib →
    // <domain>/<module>/lib). A sanctioned import names an ANCESTOR's lib —
    // no path segment between the leading dots and "lib" — so those stay
    // allowed; anything else crosses into foreign lib and is blocked, EXCEPT
    // `*Repo` files (each domain's cross-domain data-access surface). See
    // docs/guidelines/convex/backend-development.md (Module folders,
    // Cross-Domain Imports) and docs/adr/0009-module-folders-inside-convex-domains.md.
    files: ["convex/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Validator-first typing inside the deployment bundle: every convex
          // module is part of the generated `api` type, so deriving types via
          // FunctionReturnType<typeof api...> here is self-referential (TS2456
          // degrades to a silent any-cascade). Shapes come from domain
          // validators (`Infer`-ed named types); FunctionReturnType belongs to
          // code OUTSIDE convex/ (CLI, frontend, convex-testing).
          paths: [
            {
              name: "convex/server",
              importNames: ["FunctionReturnType"],
              message:
                "Inside convex/, derive types from domain validators (named Infer types in validators.ts), not from the generated api — FunctionReturnType<typeof api...> is circular here.",
            },
          ],
          patterns: [
            {
              group: [
                // Block `lib/` behind ANY named segment, at every source depth
                // (deepest source today is convex/cli/lib/runtimes/<runtime>/).
                "./**/lib/**",
                "../**/lib/**",
                "../../**/lib/**",
                "../../../**/lib/**",
                "../../../../**/lib/**",
                // Ancestor libs — own module, own domain, root convex/lib.
                "!./lib/**",
                "!../lib/**",
                "!../../lib/**",
                "!../../../lib/**",
                "!../../../../lib/**",
                "!../../../../../lib/**",
                // Re-include directories: gitignore semantics cannot re-include
                // a file whose parent directory is excluded, and *Repo files
                // nest inside lib/ (cli/lib/login/requestsRepo).
                "!./**/lib/**/",
                "!../**/lib/**/",
                "!../../**/lib/**/",
                "!../../../**/lib/**/",
                "!../../../../**/lib/**/",
                // *Repo files, wherever they sit inside a lib tree.
                "!./**/lib/**/*Repo",
                "!../**/lib/**/*Repo",
                "!../../**/lib/**/*Repo",
                "!../../../**/lib/**/*Repo",
                "!../../../../**/lib/**/*Repo",
                // Shared normalized event expansion for notification previews.
                "!../cli/lib/chunks/normalizedEvents",
                // The one seam deciding who can view a thread; checks gate thread-owned results on it (OS-2293).
                "!../cli/lib/permissions",
              ],
              // Types are part of the domain's contract; only runtime logic is
              // private. (Also: deriving types via FunctionReturnType<typeof
              // api...> inside convex modules is circular, so type-only imports
              // are the sanctioned alternative.)
              allowTypeImports: true,
              message:
                "lib/ folders are private to the domain or module that owns them, except *Repo data-access files and type-only imports. Use the owning domain's repo or callable functions, or promote the helper to the domain's lib/ or root convex/lib/.",
            },
          ],
        },
      ],
    },
  },
  {
    // Production Convex modules route DB access through repo files. The auth
    // boundary and one-time migrations are explicit exceptions; tests and
    // convex-testing helpers deliberately create edge states directly.
    files: ["convex/**/*.ts"],
    ignores: [
      "convex/**/lib/*Repo.ts",
      "convex/**/lib/**/*Repo.ts",
      "convex/lib/access/auth.ts",
      "convex/migrations.ts",
      "convex/**/*.test.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='ctx'][property.name='db']",
          message:
            "Access ctx.db only from repo files. Add/use a *Repo helper instead.",
        },
      ],
    },
  },
  {
    // PERMANENT migrations carve-out. Backfills are cross-domain data surgery by
    // nature, so migrations may reach into any domain's `lib/**`. (The former
    // `convex/tasks.ts` god-module exception is gone: the task domain moved to
    // `convex/tasks/core.ts` + `core/*`.)
    files: [
      "convex/migrations.ts",
      "convex/migrations.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "convex/server",
              importNames: ["FunctionReturnType"],
              message:
                "Inside convex/, derive types from domain validators (named Infer types in validators.ts), not from the generated api — FunctionReturnType<typeof api...> is circular here.",
            },
          ],
          patterns: [
            {
              group: [
                // migrations.ts sits at the convex root, so "./" is the only
                // depth that can name a domain lib.
                "./**/lib/**",
                "!./lib/**",
                "!./**/lib/**/",
                "!./**/lib/**/*Repo",
                "!./tasks/lib/**",
                "!./cli/lib/**",
              ],
              message:
                "lib/ folders are private to the domain or module that owns them, except *Repo data-access files. migrations may additionally reach tasks/lib and cli/lib (cross-domain backfills).",
            },
          ],
        },
      ],
    },
  },
  {
    // TRANSITIONAL carve-out (docs/refactoring/convex-backend.md item 10).
    // All callable cli modules (item 13) have now moved into convex/cli/, so the
    // only remaining consumers of convex/cli/lib/* from OUTSIDE the cli domain
    // are these two cross-domain files: registerBody.ts and contracts/validators.ts
    // depend on the cli runtime parsing/contracts subsystem (cli/lib/runtimes/*)
    // that previously lived under the shared root convex/lib/. Their dependency
    // is revisited (promote the runtime contracts to root convex/lib or expose
    // them via a cli public surface) as the final item-13 cleanup; delete this
    // block then. See docs/refactoring/convex-cli-threads.md ("Follow-up").
    files: [
      "convex/lib/http/registerBody.ts",
      "convex/lib/contracts/validators.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "convex/server",
              importNames: ["FunctionReturnType"],
              message:
                "Inside convex/, derive types from domain validators (named Infer types in validators.ts), not from the generated api — FunctionReturnType<typeof api...> is circular here.",
            },
          ],
          patterns: [
            {
              group: [
                // Both files sit at convex/lib/<sub>/, so "../../" is the only
                // depth that can name a domain lib.
                "../../**/lib/**",
                "!../../lib/**",
                // apps/web/lib — "**" also swallows extra ".." segments.
                "!../../../lib/**",
                "!../../**/lib/**/",
                "!../../**/lib/**/*Repo",
                "!../../cli/lib/**",
              ],
              allowTypeImports: true,
              message:
                "lib/ folders are private to the domain or module that owns them, except *Repo data-access files and (transitionally) convex/cli/lib/* from these two cross-domain files.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["convex/**/*.ts", "convex-testing/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...convexPlugin.configs.recommended,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ...sharedIgnores,
    "coverage/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
