/**
 * Skill tools. `list_skills` and `create_skill` take a scope the way the prompt
 * tools do, and the rest take a `skillId`, which carries the stored Skill's own
 * scope (docs/specs/skills.md#headless-access-mcp-and-cli). `load_skill` and
 * `read_skill_file` are the agent's read surface and see project Skills only. An
 * API key narrowed to projects is denied organization Skills by the backend.
 */
import { api } from "../../_generated/api";
import type { Skill, SkillDetail, SkillEdit, SkillSource } from "../../skills/lib/validators";
import { InvalidParamsError, should, throwInvalidParams } from "../lib/should";
import type { ToolHandler, ToolResult } from "./context";

function serializeSkill(skill: Skill) {
  return {
    skillId: skill._id,
    scope: skill.scope,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    version: skill.version,
    // Where it was copied from, so a later check can compare against upstream.
    source: skill.source,
  };
}

/**
 * `null` clears the provenance, and every field is optional — record what you know.
 * The backend owns the formats and drops a source with nothing in it.
 */
function parseSkillSource(args: Record<string, unknown>): SkillSource | null | undefined {
  if (args.source === undefined || args.source === null) {
    return args.source as null | undefined;
  }

  const record = should.beRecord(args.source, "source");
  const source: SkillSource = {};
  for (const key of ["repoUrl", "commitSha", "ref", "subpath"] as const) {
    const value = should.beOptionalString(record, key);
    if (value !== undefined) {
      source[key] = value;
    }
  }

  return source;
}

/**
 * Project scope is the default: MCP connections are configured per project. An
 * `organization` alongside it is a contradiction, and project scope would ignore
 * it — a silent write to a different owner under a different permission — so it is
 * rejected rather than dropped. (The prompt tools shipped tolerating this; changing
 * them belongs to their own change.)
 */
function parseSkillScope(args: Record<string, unknown>) {
  const scope = should.beOptionalEnum(args, "scope", ["project", "organization"] as const) ?? "project";
  if (scope === "project" && should.beOptionalString(args, "organization") !== undefined) {
    throwInvalidParams('organization is organization scope only; pass scope: "organization"');
  }

  return scope;
}

export const handleListSkills: ToolHandler = async ({ ctx, apiKey, args, getProjectId, getOrganizationId }) => {
  const skills =
    parseSkillScope(args) === "organization"
      ? await ctx.runQuery(api.skills.core.listByOrganization, {
          organizationId: await getOrganizationId(),
          apiKey,
        })
      : await ctx.runQuery(api.skills.core.listByProject, {
          projectId: await getProjectId(),
          apiKey,
        });

  return skills.map(serializeSkill);
};

export const handleGetSkill: ToolHandler = async ({ ctx, apiKey, args }) => {
  const skill: SkillDetail | null = await ctx.runQuery(api.skills.core.get, {
    skillId: should.beId<"skills">(args, "skillId"),
    apiKey,
  });
  if (!skill) {
    return null;
  }

  return { ...serializeSkill(skill), skillMd: skill.skillMd, files: skill.files };
};

export const handleCreateSkill: ToolHandler = async ({
  ctx,
  apiKey,
  args,
  getProjectId,
  getOrganizationId,
}) => {
  // Scope first: it picks the branch, so a bad scope must not be masked by a
  // missing `name` on the way there.
  const scope = parseSkillScope(args);
  const description = should.beOptionalString(args, "description");
  const category = should.beOptionalString(args, "category");
  const source = parseSkillSource(args);
  const shared = {
    name: should.beString(args, "name"),
    content: should.beString(args, "content"),
    ...(description !== undefined && { description }),
    ...(category !== undefined && { category }),
    // A create has nothing to clear, so a null source is the same as none.
    ...(source && { source }),
    apiKey,
  };

  const skillId =
    scope === "organization"
      ? await ctx.runMutation(api.skills.core.createInOrganization, {
          organizationId: await getOrganizationId(),
          ...shared,
        })
      : await ctx.runMutation(api.skills.core.createInProject, {
          projectId: await getProjectId(),
          ...shared,
        });

  return { skillId };
};

/** Install copies the template into the connection's project (docs/specs/skills.md#scope-and-install-model). */
export const handleInstallSkill: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) => ({
  skillId: await ctx.runMutation(api.skills.core.copyFromSkill, {
    projectId: await getProjectId(),
    skillId: should.beId<"skills">(args, "skillId"),
    apiKey,
  }),
});

/** Reads resolve a name inside the connection's project; templates stay invisible. */
export const handleLoadSkill: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) =>
  ctx.runQuery(api.skills.core.loadByName, {
    projectId: await getProjectId(),
    name: should.beString(args, "name"),
    apiKey,
  });

export const handleReadSkillFile: ToolHandler = async ({ ctx, apiKey, args, getProjectId }) =>
  ctx.runQuery(api.skills.core.readFileByName, {
    projectId: await getProjectId(),
    name: should.beString(args, "name"),
    path: should.beString(args, "path"),
    apiKey,
  });

function parseSkillEdit(edit: Record<string, unknown>): SkillEdit {
  const path = should.beString(edit, "path");
  const op = should.beString(edit, "op");

  switch (op) {
    case "write":
      return { op: "write", path, content: should.bePossiblyEmptyString(edit, "content") };
    case "delete":
      return { op: "delete", path };
    case "move":
      return { op: "move", path, newPath: should.beString(edit, "newPath") };
    case "replace": {
      const replaceAll = should.beOptionalBoolean(edit, "replaceAll");

      return {
        op: "replace",
        path,
        oldString: should.beString(edit, "oldString"),
        newString: should.bePossiblyEmptyString(edit, "newString"),
        ...(replaceAll !== undefined && { replaceAll }),
      };
    }
    default:
      throwInvalidParams(`op must be one of: write, replace, move, delete`);
  }
}

/** Every rejection carries the batch position, or the agent cannot tell which edit is wrong. */
function parseSkillEdits(args: Record<string, unknown>): SkillEdit[] | undefined {
  const raw = args.edits;
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throwInvalidParams("edits must be an array of edit objects");
  }

  return raw.map((item, index) => {
    try {
      return parseSkillEdit(should.beRecord(item, "edit"));
    } catch (error) {
      if (error instanceof InvalidParamsError) {
        throwInvalidParams(`edits[${index}]: ${error.message}`);
      }
      throw error;
    }
  });
}

// No scope argument: the stored Skill knows its scope, and the mutation derives
// permissions from it.
export const handleUpdateSkill: ToolHandler = async ({ ctx, apiKey, args }) => {
  const name = should.beOptionalString(args, "name");
  const content = should.beOptionalString(args, "content");
  const description = should.beNullableString(args, "description");
  const category = should.beNullableString(args, "category");
  const edits = parseSkillEdits(args);
  const source = parseSkillSource(args);

  const result = await ctx.runMutation(api.skills.core.update, {
    skillId: should.beId<"skills">(args, "skillId"),
    ...(name !== undefined && { name }),
    ...(content !== undefined && { content }),
    ...(description !== undefined && { description }),
    ...(category !== undefined && { category }),
    ...(edits !== undefined && { edits }),
    ...(source !== undefined && { source }),
    apiKey,
  });

  // A reported miss is the agent's to recover from, so it comes back as an error
  // result rather than a JSON-RPC failure (docs/specs/skills.md#authoring).
  if (result.ok === false) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    } satisfies ToolResult;
  }

  return result;
};

export const handleDeleteSkill: ToolHandler = async ({ ctx, apiKey, args }) =>
  ctx.runMutation(api.skills.core.deleteSkill, {
    skillId: should.beId<"skills">(args, "skillId"),
    apiKey,
  });
