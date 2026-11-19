import { ConvexError, v } from "convex/values";
import { action } from "../../_generated/server";
import { errors } from "./errors";
import { writeAs } from "./accounts";
import { githubFetch, githubGraphql } from "./lib/github";
import { list as asList, record, str } from "./lib/parsers";
import { assigneeValidator, type Assignee } from "./lib/validators";

// PR assignees, read and written as the member's own Linked GitHub account (ADR 0012).

const target = { projectId: v.id("projects"), repositoryId: v.string(), number: v.number() };
const options = { refused: errors.PULL_REQUEST_WRITE_REFUSED };

function toAssignee(raw: unknown): Assignee {
  const user = record(raw);
  return { login: str(user.login), avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null };
}

/** GitHub's assignees after a write; it answers 200 even when it drops the change (an unassignable login, say). */
function assigneesAfter(issue: unknown, applied: (logins: string[]) => boolean): Assignee[] {
  const assignees = asList(record(issue).assignees ?? []).map(toAssignee);
  if (!applied(assignees.map((person) => person.login))) throw new ConvexError(errors.PULL_REQUEST_WRITE_REFUSED);
  return assignees;
}

const ASSIGNABLE_USERS = `query($owner: String!, $name: String!, $query: String) {
  repository(owner: $owner, name: $name) { assignableUsers(query: $query, first: 20) { nodes { login avatar_url: avatarUrl } } }
}`;

/** The first 20 people GitHub can assign on the PR's repository, matching `query` (login or name) when given. */
export const list = action({
  args: { ...target, query: v.optional(v.string()) },
  returns: v.array(assigneeValidator),
  handler: async (ctx, { query, ...args }): Promise<Assignee[]> =>
    writeAs(
      ctx,
      args,
      async (token, _repository, _githubUserId, { owner, name }) => {
        const data = record(await githubGraphql(token, ASSIGNABLE_USERS, { owner, name, query: query?.trim() || null }));
        return asList(record(record(data.repository).assignableUsers).nodes).map(toAssignee);
      },
      options
    ),
});

/** Assigns or unassigns one person, leaving the others; returns the PR's assignees after. */
export const update = action({
  args: { ...target, login: v.string(), assigned: v.boolean() },
  returns: v.array(assigneeValidator),
  handler: async (ctx, { login, assigned, ...args }): Promise<Assignee[]> =>
    writeAs(
      ctx,
      args,
      async (token, repository) =>
        assigneesAfter(
          await githubFetch(`${repository}/issues/${args.number}/assignees`, { token }, { method: assigned ? "POST" : "DELETE", body: { assignees: [login] } }),
          (logins) => logins.includes(login) === assigned
        ),
      { ...options, refresh: true }
    ),
});

/** Assign to nobody. */
export const clear = action({
  args: target,
  returns: v.array(assigneeValidator),
  handler: async (ctx, args): Promise<Assignee[]> =>
    writeAs(
      ctx,
      args,
      async (token, repository) =>
        assigneesAfter(
          await githubFetch(`${repository}/issues/${args.number}`, { token }, { method: "PATCH", body: { assignees: [] } }),
          (logins) => logins.length === 0
        ),
      { ...options, refresh: true }
    ),
});
