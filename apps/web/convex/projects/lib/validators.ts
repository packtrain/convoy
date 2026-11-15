import { v, type Infer } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import {
  statusValidator,
  taskTableColumnValidator,
  projectViewModeValidator,
  boardGroupByValidator,
  listGroupByValidator,
  boardRowGroupByValidator,
  projectRoleValidator,
} from "../../lib/contracts/validators";
import { pinnedSystemTaskListValidator } from "@/lib/task-lists/system-lists";

export const projectValidator = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  organizationId: v.id("organizations"),
  name: v.string(),
  alias: v.string(),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
  disabledStatuses: v.optional(v.array(statusValidator)),
  hiddenTaskTableColumns: v.optional(v.array(taskTableColumnValidator)),
  defaultViewMode: v.optional(projectViewModeValidator),
  defaultBoardGroupBy: v.optional(boardGroupByValidator),
  defaultListGroupBy: v.optional(listGroupByValidator),
  defaultBoardRowGroupBy: v.optional(boardRowGroupByValidator),
  showArtifactsCount: v.optional(v.boolean()),
  defaultListId: v.optional(v.id("taskLists")),
  pinnedSystemLists: v.optional(v.array(pinnedSystemTaskListValidator)),
  isArchived: v.boolean(),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  isDeleted: v.boolean(),
  deletedAt: v.optional(v.number()),
  deletedBy: v.optional(v.id("users")),
});

export type Project = Infer<typeof projectValidator>;

/**
 * Sidebar/nav rows: the project doc, the caller's role in it, and its default
 * List's own default-view override (OS-1566). Entry links that omit the `list`
 * param land on that List, so they must resolve its override before falling
 * back to the project default. Absent when the default List inherits.
 */
export const projectNavRowValidator = v.object({
  ...projectValidator.fields,
  myRole: projectRoleValidator,
  defaultListView: v.optional(
    v.object({
      defaultViewMode: projectViewModeValidator,
      defaultBoardGroupBy: v.optional(boardGroupByValidator),
      defaultListGroupBy: v.optional(listGroupByValidator),
      defaultBoardRowGroupBy: v.optional(boardRowGroupByValidator),
    })
  ),
});

export type ProjectNavRow = Infer<typeof projectNavRowValidator>;

/**
 * Management metadata for the org-settings Projects surfaces (OS-1534).
 * Metadata only — listing a project there is a management handle, not an
 * access grant. Spec: docs/specs/permissions-system.md
 */
export const orgManagedProjectValidator = v.object({
  _id: v.id("projects"),
  name: v.string(),
  alias: v.string(),
  color: v.optional(v.string()),
  description: v.optional(v.string()),
  isArchived: v.boolean(),
  createdAt: v.number(),
  creator: v.union(
    v.object({
      _id: v.id("users"),
      name: v.string(),
      email: v.string(),
      avatarUrl: v.optional(v.string()),
    }),
    v.null()
  ),
});

export type OrgManagedProject = Infer<typeof orgManagedProjectValidator>;

/** Left-join projection for `orgManagedProjectValidator`: creator may be gone. */
export function toOrgManagedProject(
  project: Doc<"projects">,
  creator: Doc<"users"> | null
): OrgManagedProject {
  return {
    _id: project._id,
    name: project.name,
    alias: project.alias,
    color: project.color,
    description: project.description,
    isArchived: project.isArchived,
    createdAt: project.createdAt,
    creator: creator
      ? {
          _id: creator._id,
          name: creator.name,
          email: creator.email,
          avatarUrl: creator.avatarUrl,
        }
      : null,
  };
}
