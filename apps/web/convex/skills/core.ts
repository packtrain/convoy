import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mutation, query } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { OrgPermission, ProjectPermission } from "../../lib/authz/permissions";
import { getAuthenticatedAccess } from "../lib/access/auth";
import {
  authorizeProjectAccess,
  requireAuthorizedProject,
  requireOrganizationManage,
  requireOrganizationMember,
  type AuthenticatedAccess,
  type OrganizationRecordAccess,
} from "../lib/access/permissions";
import { ensure } from "../lib/shared/ensure";
import { buildPatch, changedFields, mapClearable, mapDefined } from "../lib/shared/patch";
import { countStringOccurrences } from "../lib/shared/strings";
import { errors } from "./errors";
import {
  SKILL_MAIN_FILE_PATH,
  ensureSkillReplacementFits,
  normalizeSkillCategory,
  normalizeSkillDescription,
  normalizeSkillFileSet,
  normalizeSkillName,
  normalizeSkillPath,
  normalizeSkillSource,
  skillNameLookupKey,
  skillPathLookupKey,
} from "./lib/normalize";
import { getSkillFileByPath, insertSkillFile, listSkillFiles, replaceSkillFiles } from "./lib/skillFilesRepo";
import {
  bumpSkillVersion,
  getActiveOrganizationSkillByNormalizedName,
  getActiveProjectSkillByNormalizedName,
  getSkillById,
  insertOrganizationSkill,
  insertProjectSkill,
  listActiveOrganizationSkills,
  listActiveProjectSkills,
  paginateActiveOrganizationSkills,
  paginateActiveProjectSkills,
  softDeleteSkill,
  type SkillUpdatePatch,
} from "./lib/skillsRepo";
import {
  skillDetailValidator,
  skillEditValidator,
  skillFileValidator,
  skillLoadValidator,
  skillSourceValidator,
  skillUpdateResultValidator,
  skillValidator,
  type SkillEdit,
  type SkillFile,
} from "./lib/validators";

type Ctx = QueryCtx | MutationCtx;

const organizationAccess: OrganizationRecordAccess = {
  managePermission: OrgPermission.SKILLS_MANAGE,
  errors: {
    organizationNotFound: errors.SKILL_ORGANIZATION_NOT_FOUND,
    organizationForbidden: errors.SKILL_ORGANIZATION_FORBIDDEN,
    projectScopedKey: errors.SKILL_ORGANIZATION_PROJECT_SCOPED,
    membershipRequired: errors.SKILL_ORGANIZATION_MEMBERSHIP_REQUIRED,
  },
};

/** The stored Skill knows its scope, and the scope picks the permission. */
async function requireSkillManage(ctx: Ctx, principal: AuthenticatedAccess, skill: Doc<"skills">) {
  if (skill.scope === "project") {
    const projectId = await ensure(skill.projectId).notNull(errors.SKILL_NOT_FOUND);
    await requireAuthorizedProject(ctx, principal, projectId, ProjectPermission.SKILLS_MANAGE);

    return;
  }

  await requireOrganizationManage(ctx, principal, skill.organizationId, organizationAccess);
}

/** Uniqueness is per scope owner: one organization, or one project. */
async function getActiveSkillByNormalizedName(ctx: Ctx, skill: Doc<"skills">, normalizedName: string) {
  if (skill.scope === "project") {
    const projectId = await ensure(skill.projectId).notNull(errors.SKILL_NOT_FOUND);

    return getActiveProjectSkillByNormalizedName(ctx, projectId, normalizedName);
  }

  return getActiveOrganizationSkillByNormalizedName(ctx, skill.organizationId, normalizedName);
}

async function requireManageableSkill(ctx: MutationCtx, skillId: Id<"skills">, apiKey?: string) {
  const { user, principal } = await getAuthenticatedAccess(ctx, apiKey);
  const skill = await ensure(getSkillById(ctx, skillId)).notDeleted(errors.SKILL_NOT_FOUND);
  await requireSkillManage(ctx, principal, skill);

  return { user, skill };
}

function additionalFiles(files: Doc<"skillFiles">[]): SkillFile[] {
  return files
    .filter((file) => file.path !== SKILL_MAIN_FILE_PATH)
    .map((file) => ({ path: file.path, content: file.content }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/** A reported failure, minus the batch position its caller knows. */
type SkillEditFailure = {
  code: "old_string_not_found" | "multiple_matches";
  message: string;
  occurrences: number;
};

type SkillFilesSave = { changed: boolean; failure?: never } | { changed?: never; failure: SkillEditFailure & { index: number } };

/**
 * The partial edit an agent iterating on a Skill needs: it reports a miss as a
 * value instead of throwing (docs/specs/skills.md#authoring).
 */
function replaceInSkillFile(file: SkillFile, edit: Extract<SkillEdit, { op: "replace" }>): SkillEditFailure | null {
  ensure(edit.oldString).notEq("", errors.SKILL_OLD_STRING_REQUIRED);

  const occurrences = countStringOccurrences(file.content, edit.oldString);
  if (occurrences === 0) {
    return { code: "old_string_not_found", message: `oldString was not found in ${file.path}`, occurrences };
  }
  if (occurrences > 1 && edit.replaceAll !== true) {
    return {
      code: "multiple_matches",
      message: `oldString matches ${occurrences} locations in ${file.path}; pass replaceAll to replace every occurrence`,
      occurrences,
    };
  }

  ensureSkillReplacementFits(file.content, edit.oldString, edit.newString, occurrences);
  file.content = file.content.split(edit.oldString).join(edit.newString);

  return null;
}

/**
 * Applies one edit to the in-memory set. Path rules, caps, and the `SKILL.md`
 * reservation bind the committed set, so this guards only what the set rules
 * cannot see: a missing target and an ambiguous partial edit.
 */
async function applySkillEdit(files: SkillFile[], edit: SkillEdit): Promise<SkillEditFailure | null> {
  // Paths are normalized on the way in, so a later edit in the same batch finds
  // a file an earlier one wrote or renamed by its canonical path.
  const path = normalizeSkillPath(edit.path);
  const target = files.find((file) => file.path === path);

  if (edit.op === "write") {
    if (target) {
      target.content = edit.content;
    } else {
      files.push({ path, content: edit.content });
    }

    return null;
  }

  const file = await ensure(target).notNull(errors.SKILL_FILE_NOT_FOUND);
  if (edit.op === "replace") {
    return replaceInSkillFile(file, edit);
  }

  ensure(file.path).notEq(SKILL_MAIN_FILE_PATH, errors.SKILL_PATH_RESERVED);
  if (edit.op === "move") {
    file.path = normalizeSkillPath(edit.newPath);
  } else {
    files.splice(files.indexOf(file), 1);
  }

  return null;
}

/**
 * Writes the Skill's whole file set in one go; `undefined` means "leave that
 * part alone". `content` and `files` land first, then `edits` patch the result,
 * so one call can rewrite the body and partially edit it. Reports whether
 * anything changed, so the caller bumps `version` once per save and not at all
 * for a save that wrote nothing.
 */
async function saveSkillFiles(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  content: string | undefined,
  files: SkillFile[] | undefined,
  edits: SkillEdit[] | undefined
): Promise<SkillFilesSave> {
  if (content === undefined && files === undefined && edits === undefined) {
    return { changed: false };
  }

  const existing = await listSkillFiles(ctx, skillId);
  const mainFile = await ensure(existing.find((file) => file.path === SKILL_MAIN_FILE_PATH)).notNull(errors.SKILL_FILE_NOT_FOUND);
  // `SKILL.md` joins the array an edit walks, so a partial edit can reach the
  // body; it is split back out before the set is validated.
  const main: SkillFile = { path: SKILL_MAIN_FILE_PATH, content: content ?? mainFile.content };
  const set = [main, ...(files ?? additionalFiles(existing))];

  for (const [index, edit] of (edits ?? []).entries()) {
    const failure = await applySkillEdit(set, edit);
    if (failure) {
      return { failure: { ...failure, index } };
    }
  }

  const desired = normalizeSkillFileSet(
    main.content,
    set.filter((file) => file !== main)
  );

  return { changed: await replaceSkillFiles(ctx, skillId, existing, desired) };
}

export const listByOrganization = query({
  args: {
    organizationId: v.id("organizations"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(skillValidator),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireOrganizationMember(ctx, principal, args.organizationId, organizationAccess);

    return listActiveOrganizationSkills(ctx, args.organizationId);
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(skillValidator),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_VIEW);

    return listActiveProjectSkills(ctx, args.projectId);
  },
});

/** Project scope reads with `PROJECT_VIEW`, organization scope with membership — same as the unpaginated lists. */
async function requireSkillListAccess(
  ctx: Ctx,
  args: { organizationId: Id<"organizations">; projectId?: Id<"projects">; apiKey?: string }
) {
  const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
  if (!args.projectId) {
    await requireOrganizationMember(ctx, principal, args.organizationId, organizationAccess);

    return;
  }

  const access = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.PROJECT_VIEW);
  ensure(access.project.organizationId).eq(args.organizationId, errors.SKILL_PROJECT_MISMATCH);
}

/**
 * The settings list: one scope's active Skills in name order, 50-ish at a time
 * (docs/specs/skills.md#backend-api). `category: null` filters to uncategorized;
 * omitting it lists every category.
 */
export const list = query({
  args: {
    organizationId: v.id("organizations"),
    projectId: v.optional(v.id("projects")),
    category: v.optional(v.union(v.string(), v.null())),
    paginationOpts: paginationOptsValidator,
    apiKey: v.optional(v.string()),
  },
  returns: paginationResultValidator(skillValidator),
  handler: async (ctx, args) => {
    await requireSkillListAccess(ctx, args);

    return args.projectId
      ? paginateActiveProjectSkills(ctx, args.projectId, args.category, args.paginationOpts)
      : paginateActiveOrganizationSkills(ctx, args.organizationId, args.category, args.paginationOpts);
  },
});

/**
 * The category navigation beside the paginated list: every category with its
 * count, `category` absent for uncategorized Skills. Scans the scope's rows but
 * ships only the counts.
 */
export const listCategories = query({
  args: {
    organizationId: v.id("organizations"),
    projectId: v.optional(v.id("projects")),
    apiKey: v.optional(v.string()),
  },
  returns: v.array(v.object({ category: v.optional(v.string()), count: v.number() })),
  handler: async (ctx, args) => {
    await requireSkillListAccess(ctx, args);

    const skills = args.projectId
      ? await listActiveProjectSkills(ctx, args.projectId)
      : await listActiveOrganizationSkills(ctx, args.organizationId);
    const counts = new Map<string | undefined, number>();
    for (const skill of skills) {
      counts.set(skill.category, (counts.get(skill.category) ?? 0) + 1);
    }

    return [...counts].map(([category, count]) => ({ category, count }));
  },
});

export const get = query({
  args: { skillId: v.id("skills"), apiKey: v.optional(v.string()) },
  returns: v.union(skillDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const { principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const skill = await getSkillById(ctx, args.skillId);
    if (!skill || skill.isDeleted) {
      return null;
    }

    // Read is a project view for a project Skill, organization membership for a
    // template. Viewers read; they just cannot manage (docs/specs/skills.md#permissions).
    // A project Skill out of the caller's reach reads as missing, so a stale URL
    // lands on the not-found card instead of the route error boundary.
    if (skill.scope === "project") {
      if (!skill.projectId) {
        return null;
      }
      const access = await authorizeProjectAccess(ctx, principal, skill.projectId, ProjectPermission.PROJECT_VIEW);
      if (!access) {
        return null;
      }
    } else {
      await requireOrganizationMember(ctx, principal, skill.organizationId, organizationAccess);
    }

    const files = await listSkillFiles(ctx, skill._id);

    return {
      ...skill,
      skillMd: files.find((file) => file.path === SKILL_MAIN_FILE_PATH)?.content ?? "",
      files: additionalFiles(files),
    };
  },
});

/**
 * The agent surface addresses a Skill by name inside one project. Organization
 * templates are never exposed to an agent, and neither is a name no Skill could
 * hold, so both read as missing (docs/specs/skills.md#v1--mcp).
 */
async function findProjectSkillByName(ctx: QueryCtx, projectId: Id<"projects">, name: string, apiKey?: string) {
  const { principal } = await getAuthenticatedAccess(ctx, apiKey);
  await requireAuthorizedProject(ctx, principal, projectId, ProjectPermission.PROJECT_VIEW);

  return getActiveProjectSkillByNormalizedName(ctx, projectId, skillNameLookupKey(name));
}

/**
 * `SKILL.md` plus the paths to read next, never the bundle: loading it all to
 * answer one question defeats on-demand loading. Ceiling: listing the paths reads
 * every file's content, since Convex has no field projection — bounded by the 1 MB
 * per-Skill cap, and paid per explicit call. Revisit with a path manifest on the
 * Skill row if bundles get large.
 */
export const loadByName = query({
  args: { projectId: v.id("projects"), name: v.string(), apiKey: v.optional(v.string()) },
  returns: v.union(skillLoadValidator, v.null()),
  handler: async (ctx, args) => {
    const skill = await findProjectSkillByName(ctx, args.projectId, args.name, args.apiKey);
    if (!skill) {
      return null;
    }

    const files = await listSkillFiles(ctx, skill._id);

    return {
      name: skill.name,
      description: skill.description,
      skillMd: files.find((file) => file.path === SKILL_MAIN_FILE_PATH)?.content ?? "",
      paths: additionalFiles(files).map((file) => file.path),
    };
  },
});

export const readFileByName = query({
  args: { projectId: v.id("projects"), name: v.string(), path: v.string(), apiKey: v.optional(v.string()) },
  returns: v.union(skillFileValidator, v.null()),
  handler: async (ctx, args) => {
    const skill = await findProjectSkillByName(ctx, args.projectId, args.name, args.apiKey);
    if (!skill) {
      return null;
    }

    const file = await getSkillFileByPath(ctx, skill._id, skillPathLookupKey(args.path));

    return file ? { path: file.path, content: file.content } : null;
  },
});

export const createInOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    content: v.string(),
    files: v.optional(v.array(skillFileValidator)),
    source: v.optional(skillSourceValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("skills"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    await requireOrganizationManage(ctx, principal, args.organizationId, organizationAccess);

    const files = normalizeSkillFileSet(args.content, args.files ?? []);
    const name = normalizeSkillName(args.name);
    const description = normalizeSkillDescription(args.description);
    const category = normalizeSkillCategory(args.category);

    const duplicate = await getActiveOrganizationSkillByNormalizedName(ctx, args.organizationId, name);
    await ensure(duplicate).isNullOrDeleted(errors.SKILL_NAME_DUPLICATE);

    const skillId = await insertOrganizationSkill(
      ctx,
      { organizationId: args.organizationId, name, normalizedName: name, description, category, source: normalizeSkillSource(args.source) },
      user._id
    );
    for (const file of files) {
      await insertSkillFile(ctx, { skillId, ...file });
    }

    return skillId;
  },
});

export const createInProject = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    content: v.string(),
    files: v.optional(v.array(skillFileValidator)),
    source: v.optional(skillSourceValidator),
    apiKey: v.optional(v.string()),
  },
  returns: v.id("skills"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const access = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.SKILLS_MANAGE);

    const files = normalizeSkillFileSet(args.content, args.files ?? []);
    const name = normalizeSkillName(args.name);

    const duplicate = await getActiveProjectSkillByNormalizedName(ctx, args.projectId, name);
    await ensure(duplicate).isNullOrDeleted(errors.SKILL_NAME_DUPLICATE);

    const skillId = await insertProjectSkill(
      ctx,
      {
        organizationId: access.project.organizationId,
        projectId: args.projectId,
        name,
        normalizedName: name,
        description: normalizeSkillDescription(args.description),
        category: normalizeSkillCategory(args.category),
        source: normalizeSkillSource(args.source),
      },
      user._id
    );
    for (const file of files) {
      await insertSkillFile(ctx, { skillId, ...file });
    }

    return skillId;
  },
});

/**
 * Install copies, it does not link: the project row is independent afterwards, and
 * deleting the template leaves it alone (docs/specs/skills.md#scope-and-install-model).
 * Only the project permission, matching `copyFromAgent`.
 */
export const copyFromSkill = mutation({
  args: { projectId: v.id("projects"), skillId: v.id("skills"), apiKey: v.optional(v.string()) },
  returns: v.id("skills"),
  handler: async (ctx, args) => {
    const { user, principal } = await getAuthenticatedAccess(ctx, args.apiKey);
    const access = await requireAuthorizedProject(ctx, principal, args.projectId, ProjectPermission.SKILLS_MANAGE);
    const source = await ensure(getSkillById(ctx, args.skillId)).notDeleted(errors.SKILL_NOT_FOUND);
    ensure(source.scope).eq("organization", errors.SKILL_SOURCE_NOT_TEMPLATE);
    ensure(source.organizationId).eq(access.project.organizationId, errors.SKILL_PROJECT_MISMATCH);

    const duplicate = await getActiveProjectSkillByNormalizedName(ctx, args.projectId, source.normalizedName);
    await ensure(duplicate).isNullOrDeleted(errors.SKILL_NAME_DUPLICATE);

    const skillId = await insertProjectSkill(
      ctx,
      {
        organizationId: access.project.organizationId,
        projectId: args.projectId,
        name: source.name,
        normalizedName: source.normalizedName,
        description: source.description,
        category: source.category,
        sourceSkillId: source._id,
        installedVersion: source.version,
        // Git provenance travels with the content it describes.
        source: source.source,
      },
      user._id
    );
    for (const file of await listSkillFiles(ctx, source._id)) {
      await insertSkillFile(ctx, { skillId, path: file.path, content: file.content });
    }

    return skillId;
  },
});

/**
 * Refresh overwrites the copy from its source — file set, columns, installed
 * version — in one save, so it cannot half-apply
 * (docs/specs/skills.md#versioning-and-refresh). Consent for losing local edits is
 * checked here, not trusted from the caller's possibly stale snapshot.
 */
export const replaceFromSkill = mutation({
  args: { skillId: v.id("skills"), overwriteLocalEdits: v.optional(v.boolean()), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, skill } = await requireManageableSkill(ctx, args.skillId, args.apiKey);
    const sourceSkillId = await ensure(skill.sourceSkillId).notNull(errors.SKILL_SOURCE_NOT_FOUND);
    const source = await ensure(getSkillById(ctx, sourceSkillId)).notDeleted(errors.SKILL_SOURCE_NOT_FOUND);
    // Re-checked on every refresh rather than trusted from install time, so the
    // tenancy guard does not depend on `sourceSkillId` staying unwritable.
    ensure(source.scope).eq("organization", errors.SKILL_SOURCE_NOT_TEMPLATE);
    ensure(source.organizationId).eq(skill.organizationId, errors.SKILL_PROJECT_MISMATCH);
    ensure(args.overwriteLocalEdits === true || skill.locallyEdited !== true).isTrue(errors.SKILL_HAS_LOCAL_EDITS);

    // A refresh renames the copy after the template, which can collide with a
    // Skill the project authored in the meantime.
    if (source.normalizedName !== skill.normalizedName) {
      await ensure(getActiveSkillByNormalizedName(ctx, skill, source.normalizedName)).isNull(errors.SKILL_NAME_DUPLICATE);
    }

    const patch: SkillUpdatePatch = {
      name: source.name,
      normalizedName: source.normalizedName,
      description: source.description,
      category: source.category,
      source: source.source,
      installedVersion: source.version,
      locallyEdited: undefined,
    };
    const files = await listSkillFiles(ctx, source._id);
    const changed = await replaceSkillFiles(
      ctx,
      skill._id,
      await listSkillFiles(ctx, skill._id),
      files.map((file) => ({ path: file.path, content: file.content }))
    );

    // A refresh that found nothing to write is a no-op save like any other.
    if (changed || changedFields(patch, skill).length > 0) {
      await bumpSkillVersion(ctx, skill, patch, user._id);
    }

    return null;
  },
});

/**
 * One save of the whole Skill: columns, `SKILL.md`, and the additional-file set.
 * `name` and `description` are columns only — `SKILL.md` is stored verbatim and
 * never parsed or rewritten (docs/specs/skills.md#frontmatter). An omitted
 * `files` leaves the stored set alone; a given one replaces it wholesale;
 * `edits` patch named files instead of resending the set. Everything is one
 * write, so `version` moves at most once and a rejected edit changes nothing.
 */
export const update = mutation({
  args: {
    skillId: v.id("skills"),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    category: v.optional(v.union(v.string(), v.null())),
    content: v.optional(v.string()),
    files: v.optional(v.array(skillFileValidator)),
    edits: v.optional(v.array(skillEditValidator)),
    source: v.optional(v.union(skillSourceValidator, v.null())),
    apiKey: v.optional(v.string()),
  },
  returns: skillUpdateResultValidator,
  handler: async (ctx, args) => {
    const { user, skill } = await requireManageableSkill(ctx, args.skillId, args.apiKey);

    const name = mapDefined(args.name, normalizeSkillName);
    if (name !== undefined && name !== skill.normalizedName) {
      const duplicate = await getActiveSkillByNormalizedName(ctx, skill, name);
      ensure(duplicate === null || duplicate._id === skill._id).isTrue(errors.SKILL_NAME_DUPLICATE);
    }

    const patch = buildPatch<SkillUpdatePatch>({
      name,
      normalizedName: name,
      description: mapClearable(args.description, normalizeSkillDescription),
      category: mapClearable(args.category, normalizeSkillCategory),
      source: mapClearable(args.source, normalizeSkillSource),
    });

    const saved = await saveSkillFiles(ctx, skill._id, args.content, args.files, args.edits);
    if (saved.failure) {
      return { ok: false as const, ...saved.failure };
    }

    const bumped = saved.changed || changedFields(patch, skill).length > 0;
    // Every column above and the file set are template-owned, so any real change
    // makes an installed copy dirty — including a partial edit, which never
    // touches the columns (docs/specs/skills.md#versioning-and-refresh).
    if (bumped && skill.sourceSkillId && !skill.locallyEdited) {
      patch.locallyEdited = true;
    }
    if (bumped) {
      await bumpSkillVersion(ctx, skill, patch, user._id);
    }

    return { ok: true as const, version: skill.version + (bumped ? 1 : 0) };
  },
});

export const deleteSkill = mutation({
  args: { skillId: v.id("skills"), apiKey: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user, skill } = await requireManageableSkill(ctx, args.skillId, args.apiKey);
    await softDeleteSkill(ctx, skill._id, user._id);

    return null;
  },
});
