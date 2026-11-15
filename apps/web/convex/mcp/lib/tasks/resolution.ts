import type { ActionCtx } from "../../../_generated/server";
import { api } from "../../../_generated/api";
import type { Id } from "../../../_generated/dataModel";
import { is } from "@/lib/type-guards";
import { should, throwInvalidParams } from "../should";
import { isConvexIdError } from "../protocol/guards";

/**
 * The `getByRefs` validator deliberately returns the task as a loose record,
 * so `_id`/`refId` presence is genuine narrowing — unlike result-shape
 * re-validation of returns-validated queries, which we don't do.
 */
export type TaskRecordWithId = Record<string, unknown> & {
  _id: Id<"tasks">;
  refId: string;
};

export function isTaskRecordWithId(value: unknown): value is TaskRecordWithId {
  return is.record(value) && is.string(value._id) && is.string(value.refId);
}

export type BatchTaskLookupResult = {
  identifier: string;
  task: TaskRecordWithId | null;
  error?: string;
};

export type TaskIdentifierClassification =
  | { kind: "rawId"; identifier: string }
  | { kind: "bareRef"; identifier: string; ref: string }
  | { kind: "invalid"; identifier: string };

export type TaskRefLookupResult = {
  task: TaskRecordWithId | null;
  error?: string;
};

// Keep in sync with the CLI task ref parser.
export const TASK_REF_PATTERN = /^[A-Z][A-Z0-9]{1,4}-\d+$/i;
export const SCOPED_TASK_REF_PATTERN = /^([^/\s]+)\/([A-Z][A-Z0-9]{1,4}-\d+)$/i;

export function classifyTaskIdentifier(identifier: string): TaskIdentifierClassification {
  // Scoped refs like "org-slug/ABC-5" — strip the org prefix, treat as bare ref
  const scopedMatch = identifier.match(SCOPED_TASK_REF_PATTERN);
  if (scopedMatch) {
    return { kind: "bareRef", identifier, ref: scopedMatch[2].toUpperCase() };
  }

  if (TASK_REF_PATTERN.test(identifier)) {
    return { kind: "bareRef", identifier, ref: identifier.toUpperCase() };
  }

  if (identifier.includes("/")) {
    return { kind: "invalid", identifier };
  }

  return { kind: "rawId", identifier };
}

export async function lookupTaskRefsByProject(
  ctx: ActionCtx,
  apiKey: string,
  refs: string[],
  projectId: Id<"projects">
): Promise<Map<string, TaskRefLookupResult>> {
  const result = await ctx.runQuery(api.tasks.core.getByRefs, {
    refs,
    projectId,
    apiKey,
  });

  return new Map(
    result.results.map((item) => [
      item.ref,
      {
        task: isTaskRecordWithId(item.task) ? item.task : null,
        ...(!isTaskRecordWithId(item.task) && item.error !== undefined
          ? { error: item.error }
          : {}),
      },
    ] as const)
  );
}

export async function resolveTaskRef(
  ctx: ActionCtx,
  apiKey: string,
  ref: string,
  projectId: Id<"projects">,
  label: string
): Promise<Id<"tasks">> {
  const byRef = await lookupTaskRefsByProject(ctx, apiKey, [ref], projectId);
  const match = byRef.get(ref);
  if (!isTaskRecordWithId(match?.task)) {
    throwInvalidParams(`${label} ref "${ref}" not found`);
  }

  return match.task._id;
}

export async function resolveTaskIdOrRef(
  ctx: ActionCtx,
  apiKey: string,
  value: string,
  label: string,
  projectIdGetter?: () => Promise<Id<"projects">>
): Promise<Id<"tasks">> {
  const classified = classifyTaskIdentifier(value);

  if (classified.kind === "bareRef") {
    const ref = classified.ref;
    if (!projectIdGetter) {
      throwInvalidParams(
        `${label} ref "${ref}" requires projectId or a scoped MCP connection`
      );
    }
    const projectId = await projectIdGetter();
    return resolveTaskRef(ctx, apiKey, ref, projectId, label);
  }

  if (classified.kind === "invalid") {
    throwInvalidParams(`${label} must be a task ID or ref (e.g. "ABC-5")`);
  }

  return should.beId<"tasks">({ [label]: value }, label);
}

export async function resolveTaskById(
  ctx: ActionCtx,
  apiKey: string,
  identifier: string
): Promise<BatchTaskLookupResult> {
  try {
    const task = await ctx.runQuery(api.tasks.core.getById, {
      id: identifier as Id<"tasks">,
      apiKey,
    });
    return isTaskRecordWithId(task)
      ? { identifier, task }
      : { identifier, task: null, error: `task "${identifier}" not found` };
  } catch (error) {
    if (error instanceof Error && isConvexIdError(error.message)) {
      return { identifier, task: null, error: `task "${identifier}" not found` };
    }
    throw error;
  }
}

export async function resolveTasksByIdentifiers(
  ctx: ActionCtx,
  apiKey: string,
  identifiers: string[],
  projectIdGetter?: () => Promise<Id<"projects">>
): Promise<BatchTaskLookupResult[]> {
  const unique = [...new Set(identifiers)];
  const classified = unique.map(classifyTaskIdentifier);
  const results = new Map<string, BatchTaskLookupResult>();

  const dbIds: string[] = [];
  const refs: Array<{ identifier: string; ref: string }> = [];

  for (const item of classified) {
    switch (item.kind) {
      case "rawId":
        dbIds.push(item.identifier);
        break;
      case "bareRef":
        refs.push({ identifier: item.identifier, ref: item.ref });
        break;
      case "invalid":
        results.set(item.identifier, {
          identifier: item.identifier,
          task: null,
          error: `invalid identifier "${item.identifier}"`,
        });
        break;
    }
  }

  if (dbIds.length > 0) {
    const resolved = await Promise.all(
      dbIds.map(async (id) => [id, await resolveTaskById(ctx, apiKey, id)] as const)
    );
    const byId = new Map(resolved);
    for (const id of dbIds) {
      results.set(id, byId.get(id) ?? {
        identifier: id, task: null, error: `task "${id}" not found`,
      });
    }
  }

  if (refs.length > 0) {
    let projectId: Id<"projects"> | undefined;
    let projectError: string | undefined;
    if (projectIdGetter) {
      try {
        projectId = await projectIdGetter();
      } catch (error) {
        projectError = error instanceof Error ? error.message : "project context required for refs";
      }
    }

    if (projectId) {
      const byRef = await lookupTaskRefsByProject(ctx, apiKey, refs.map(({ ref }) => ref), projectId);
      for (const { identifier, ref } of refs) {
        const resolved = byRef.get(ref);
        const task = resolved?.task ?? null;
        results.set(identifier, {
          identifier,
          task,
          ...(task ? {} : { error: resolved?.error ?? `"${identifier}" not found` }),
        });
      }
    } else {
      const error = projectError ?? "project context required for refs";
      for (const { identifier } of refs) {
        results.set(identifier, { identifier, task: null, error });
      }
    }
  }

  return identifiers.map((id) =>
    results.get(id) ?? { identifier: id, task: null, error: `"${id}" not found` }
  );
}
