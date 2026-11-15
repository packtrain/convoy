# Agent Execution V2 Discussion Topics

This document captures unresolved topics for the next Agent phase. V1 is limited to Agent templates, Project agents, and task assignment.

## Tracking Tasks

- OS-1040: high-level V2 Agent execution planning.
- OS-691: revised Assignee vs Attribution planning context.
- OS-1035: v1 Agent assignment foundation that should land before this work starts.

## Execution Model

- Define **Agent execution** as a durable run of a Project agent.
- Decide whether executions are always tied to a task, or can run independently and later attach to tasks.
- Decide whether an execution creates a new CLI/thread record, attaches to an existing thread, or owns a separate execution record linked to one or more threads.
- Decide execution lifecycle states, such as queued, running, waiting for input, completed, failed, canceled, and expired.

## Triggers

- User assignment trigger: assigning a task to a Project agent may optionally start an execution in a later phase.
- Manual trigger: a user starts a Project agent from a task or project surface.
- Schedule trigger: a recurring policy starts a Project agent, such as daily code review.
- Webhook/integration trigger: external events start a Project agent.
- Decide how trigger details are displayed in task/thread history.

## Execution Principals

- Separate the Project agent doing the work from the authority allowing the work.
- User-local execution uses a user principal and may also include a CLI profile/session.
- System-triggered execution should use an explicit organization automation principal or policy, not anonymous "system".
- Cloud execution needs a service/cloud principal with clear organization and project boundaries.
- Decide whether automation policies are organization-scoped, project-scoped, or both.

## Runner Binding

- Map Project agents to available local CLI profiles, hosted runners, or future cloud environments.
- Decide whether Project agents declare compatible runtime types, or execution chooses runtime at start time.
- Decide what happens when an assigned Project agent has no available runner.
- Decide how project members see progress for a run executing on another user's machine.

## Thread and Progress Visibility

- Team members in the project should be able to see progress for task-related Agent executions.
- Decide whether execution threads are project-visible by default or follow the executor user's thread visibility.
- Decide how task-associated threads, execution records, and read state interact.
- Decide how cancellation, retry, and handoff work when the execution runner is local to another user.

## Attribution

- Keep **Assignee** separate from **Attribution**.
- Attribution should explain who or what performed an action and under whose authority.
- Future authored records may need attribution fields for:
  - task comments
  - task artifacts
  - task attachments
  - task activity logs
  - task creation and updates
- A likely shape includes user attribution and agent-execution attribution:

```ts
type Attribution =
  | { type: "user"; userId: Id<"users"> }
  | {
      type: "agentExecution";
      projectAgentId: Id<"projectAgents">;
      executionId: Id<"agentExecutions">;
      principal: ExecutionPrincipalSummary;
    };
```

## Automation Policies

- Define who can create and manage scheduled Project-agent runs.
- Decide whether schedules belong to the organization, project, or Project agent.
- Decide how disabled/archived/deleted Project agents affect schedules.
- Decide how failed scheduled executions notify the team.

## Safety and Permissions

- Define which permissions an execution principal grants and how API key scopes interact.
- Decide whether a Project agent can be constrained to read-only, comments-only, task updates, or code execution.
- Decide how prompt changes are audited before executions start.
- Decide whether cloud runners require explicit project opt-in.

## Product Questions

- Should assigning a task to a Project agent ever auto-run by default, or should it be opt-in per Project agent/project?
- Should Project agents have default trigger policies?
- Should Project agents expose capabilities in the catalog before users add them to a project?
- Should organizations maintain approved runner types or allowed cloud execution policies?
- Should users be able to fork a Project agent configuration from one project to another?
