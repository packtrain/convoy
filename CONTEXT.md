# Convoy

Convoy is a project management system for organizing project work across task views, workflow states, and planning buckets.

## Language

**Integration**:
A project's configured connection to an external platform, shared with its members and managed by project admins.

**Connected repository**:
A repository explicitly selected for pull request browsing through a project's Integration.
_Avoid_: Working path, Thread worktree

**Pull request**:
A proposed repository change tracked in Convoy independently of a Task.
A Task can link to a Pull request without becoming that Pull request.

**Attached pull request**:
A Pull request a member attached to a CLI thread or one of its messages because the work is about it. It is chosen, never detected.
_Avoid_: Linked PR, thread PR

**Branch pull request**:
The Pull request the CLI found for a CLI thread's Execution branch. It is detected, never chosen.
_Avoid_: PR snapshot as the product term, attached PR

**Linked GitHub account**:
A Convoy user's own GitHub authorization within one Convoy organization. Every change Convoy makes on GitHub acts through it, as that user. The same person may link different GitHub accounts in different organizations.
_Avoid_: GitHub connection, Integration (that is the project's)

**Stack**:
An ordered chain of Pull requests in one repository, each based on the branch of the one below it.
_Avoid_: Series, chain

**Layer**:
One Pull request's place in a Stack, counted from the bottom.

**Archived pull request**:
A Pull request GitHub has closed and locked. It is unrelated to the Archived List.

**Reviewed mark**:
A user's own mark that they have reviewed one file's changes in a Pull request. It clears when a new revision changes that file.
_Avoid_: Viewed

**Guide**:
An agent-written walkthrough of one Pull request revision's changes, split into ordered Guide steps. A Pull request can have several Guides, requested by different members, and every member can read each of them.
_Avoid_: Summary, review

**Guide step**:
One part of a Guide: a title, an explanation, the changed files it owns, and excerpts of the code that carries the idea, with an optional attention flag where a reader should slow down. Every changed file is owned by exactly one Guide step, though other steps may excerpt it.
_Avoid_: Stop

**Guide prompt**:
A project's instructions for the agent that writes Guides. A project without its own uses Convoy's built-in default.
_Avoid_: Guide skill, guide template

**Outdated guide**:
A Guide written for a revision that is no longer the Pull request's head.

**Follow-up guide**:
A Guide built from the newest earlier Guide for the commits since it, rather than from scratch. Each of its Guide steps is Unchanged, Updated, New, or Removed relative to that base.
_Avoid_: Regenerated guide, delta guide

**Task**:
A unit of project work that can be tracked, assigned, ordered, and moved through workflow states.

**Subtask**:
A Task that has another Task as its parent.
_Avoid_: Promoted child task

**Custom task list**:
A project-scoped planning bucket that may contain a task as its single current list membership.
_Avoid_: List, sprint

**List**:
A project-scoped task container that owns task membership and task order.
_Avoid_: Table view, board view, status

**Inbox**:
The target required initial project list where new tasks are placed until the project default list changes. Before default Inbox persistence lands, the header Inbox entry is a compatibility/no-list view.
_Avoid_: Default, All

**List move activity**:
A task history event recording that a task moved from one list to another.
_Avoid_: Historical list tag

**List ref**:
A project-scoped human-readable identifier for a list.
_Avoid_: Alias

**Backlog List**:
The built-in list for deferred tasks.
_Avoid_: Backlog status

**Status**:
A workflow state of a task.
_Avoid_: List, bucket

**Archived List**:
The built-in list for tasks removed from active planning.
_Avoid_: Archive flag as the canonical domain concept

**Recurring List**:
The built-in list that holds Recurring task templates. Hidden from default task queries like archived work; queried explicitly.
_Avoid_: Templates list, schedules

**Recurring task template**:
A Task in the Recurring List whose fields and Subtasks define each Occurrence, and which carries a Recurrence. Agents may create and edit it like any Task.
_Avoid_: Recurring task (ambiguous between template and Occurrence), parent task, series task

**Recurrence**:
The schedule on a Recurring task template that says when the next Occurrence is created, in a fixed timezone.
_Avoid_: Schedule, cron, rule

**Occurrence**:
A Task created from a Recurring task template for one slot of its Recurrence. Work, Artifacts, and threads attach here.
_Avoid_: Instance, copy, child

**Series notes**:
The Artifacts of a Recurring task template, shown on every Occurrence by reference and shared across them as the series memory. Never copied.
_Avoid_: Template artifacts, memory

**Skipped slot**:
A Recurrence slot at which no Occurrence was created because an Agent execution on the previous Occurrence was still unresolved. Occurrences awaiting human review do not cause skips.
_Avoid_: Missed run, pile-up

**Table**:
A rendering mode for viewing tasks in rows.
_Avoid_: List

**Board**:
A rendering mode for viewing tasks in columns, where each column is a Board group.
_Avoid_: Kanban as the canonical product term

**Board group**:
A column in a Board that represents one value or a named set of values from the active grouping dimension.
_Avoid_: Status column as the generic term

**Board grouping**:
The selected dimension used to organize visible tasks into Board groups.
_Avoid_: Filter

**Section**:
A named, ordered part of one List that root tasks can belong to. Sections are not tasks and never span Lists.
_Avoid_: Group (taken by Board group and Thread group)

**Artifact**:
A markdown document associated with a Task, authored by a user or produced by an agent.
_Avoid_: Attachment for this concept; attachments are binary files

**Evidence**:
Files or an Artifact an agent attaches to its reply to show its work. Evidence may answer a Check or stand alone.
_Avoid_: Proof, attachment (unqualified)

**Check**:
A named question about a Task's work from the project catalog, such as "All tests pass" or "Merge risk", with an instruction for the agent.
_Avoid_: Test, gate, Checkpoint

**GitHub check**:
A check run or commit status GitHub reports on a pull request's head commit, such as a Vercel deployment. Not a Check: it comes from CI, not from an agent.
_Avoid_: Check (unqualified) on the pull request page

**Pull request check**:
A Check the project asks about every pull request, answered by an agent for one head revision and published to GitHub as a check run. Not a GitHub check, which comes from CI. A project may still write its own risk Check, answered with a value.
_Avoid_: PR review, verdict, risk score

**Checklist**:
A named, ordered set of Checks. A task type may default to one, and one per project is the Pull request checklist.
_Avoid_: List (that is a task List), check list

**Check result**:
One answer to one Check from one Thread run: passed, warning (holds, but a human should look), failed, or not performed, with an optional value ("High", "+3"), a justification, and Evidence.
_Avoid_: Verdict, approval

**Agent**:
An organization-owned work actor template that can be copied into projects and assigned to project work through a Project agent.
_Avoid_: CLI profile, CLI session, runtime

**Agent prompt**:
The reusable working instructions stored on an Agent or Project agent.
_Avoid_: Instructions

**Slash command**:
Scoped reusable prompt entry selected by a slash-prefixed shortcut key in chat.
_Avoid_: Prompt when referring to the whole entry, workspace prompt

**Slash command key**:
The normalized key that identifies a Slash command after the leading slash, such as `review` for `/review`.
_Avoid_: Prompt shortcut, command name

**Slash command content**:
The markdown prompt body inserted or applied when a Slash command is used.
_Avoid_: Agent prompt, instructions

**Auto-expand**:
A Slash command behavior where selecting or typing the command key inserts the Slash command content into the composer instead of leaving a compact command reference.
_Avoid_: Auto-run, execute

**Agent appearance**:
The visual identity of an Agent or Project agent. In v1 it is a selected color; UI derives avatar initials from the Agent name.
_Avoid_: Visual settings

**Project agent**:
An editable project-local copy of an Agent that is available for use inside a specific project.
_Avoid_: Project member when referring to non-human agents

**Agent execution**:
A run of an Agent's work through a concrete execution environment, such as a user-local or hosted runner.
_Avoid_: Agent when referring only to one run

**Assignee**:
The user or Agent currently responsible for a Task.
_Avoid_: Owner

**Attribution**:
The user or Agent execution credited for creating or changing project work.
_Avoid_: Assignee, actor when precision matters

**Agent trigger**:
The reason an Agent execution started, such as a user action, schedule, or webhook.
_Avoid_: Source

**Execution principal**:
The authority under which an Agent execution is allowed to act, such as a user or organization automation policy.
_Avoid_: System as the canonical actor

**Artifact rewrite**:
A full replacement of an Artifact's content.
_Avoid_: Update as the canonical term when distinguishing from targeted edits

**Artifact replace edit**:
A targeted substitution within an Artifact's content, identified by an exact substring anchor.
_Avoid_: Patch, diff, partial update as the canonical product term

**Artifact comment**:
A remark a user attaches to a selected text range inside an Artifact, shown in a panel beside the Artifact and highlighted in the content. Distinct from a task comment, which is attached to a Task rather than a range of Artifact content.
_Avoid_: Comment (unqualified) when a task comment could be meant; annotation; note

**Comment anchor**:
The stored location of an Artifact comment within Artifact content: the selected text snippet plus surrounding context and character offsets, used to re-find the highlight after the content changes.
_Avoid_: Range, selection as the persisted concept

**Detached comment**:
An Artifact comment whose anchor text no longer occurs in the Artifact, so it is kept and readable but not highlighted anywhere in the content.
_Avoid_: Orphaned, deleted, lost

**Comment reply**:
A follow-up remark attached to a root Artifact comment. Replies are flat (a reply cannot have its own replies).
_Avoid_: Nested comment, sub-thread

**Resolve**:
Marking an Artifact comment (root and its replies) as addressed. Resolved comments are dimmed and can be filtered out, and can be un-resolved.
_Avoid_: Close, archive, delete

**Skill**:
A named bundle of instruction files an agent loads on demand: one required `SKILL.md` entry point plus optional additional files addressed by relative path.
_Avoid_: Slash command, Agent prompt, prompt

**Skill file**:
One file inside a Skill, stored as a relative path plus inline text content.
_Avoid_: Attachment, document

**Organization Skill**:
A Skill owned by an organization. A template: never delivered to an agent until it is installed into a project.
_Avoid_: Global skill, shared skill

**Project Skill**:
A Skill available inside one project, whether installed from an Organization Skill, installed from a Git source, or authored in the project. Only Project Skills reach an agent.
_Avoid_: Local skill, installed skill as the entity name

**Skill install**:
Copying an Organization Skill into a project, producing an independent Project Skill that records its origin.
_Avoid_: Install (unqualified), link, share, enable

**Skill refresh**:
Overwriting a Project Skill from its source, discarding local edits.
_Avoid_: Update (unqualified), sync, merge

**Locally edited**:
The state of an installed copy — a Project Skill or a Project agent — whose template-owned content diverged from the version it was installed at.
_Avoid_: Dirty, modified, out of sync

**Pack**:
A curated bundle of Skills, Slash commands, Agents, and Workflows from one author, vendored into the repository and installable into a project.
_Avoid_: Plugin, skill pack, bundle

**Gallery**:
The in-app catalog of Packs. One global catalog, identical for every organization, changed only by deploying.
_Avoid_: Marketplace, store

**Upstream**:
The third-party Git repository a Pack's content is vendored from, pinned to one commit.
_Avoid_: Source (that is a Skill's recorded Git provenance), origin

**Adaptation**:
A deliberate Convoy-specific change to Upstream content that survives updates to the pinned commit.
_Avoid_: Patch when referring to the concept, customization

**Materialized content**:
A Pack's content after Adaptations are applied — the only content the Gallery serves and installs.
_Avoid_: Patched copy, generated content

**Pack install**:
Copying selected items of a Pack from the Gallery into a project, producing independent project rows that record the Gallery as their source.
_Avoid_: Install (unqualified), import

**Pack prefix**:
The namespace prefix applied to a Pack's item names at Pack install. The Pack proposes a default; the installer may change it.
_Avoid_: Namespace (unqualified), scope

**API key scope**:
A credential-level boundary that limits where an API key can act, in addition to the owning user's permissions.
_Avoid_: MCP project default, URL scope

**MCP client**:
An external tool caller using Convoy's MCP server through an API key.
_Avoid_: Agent when referring only to the MCP caller

**Environment**:
An isolated place that runs an operating system and executes its owner's CLI threads, such as the user's own machine, a VM, a Docker container or a devcontainer. Its owner enrolls it once.
_Avoid_: Machine, runner, host; the composer's choice between working locally and a **Thread worktree**

**CLI profile**:
A user-owned project connection that names a machine/profile identity and its known working paths.
_Avoid_: Agent, runner

**CLI session**:
A live connection from a Convoy CLI process for one CLI profile, including its currently advertised CLI runtimes.
_Avoid_: CLI profile when referring to online state

**CLI runtime**:
A concrete command-line coding tool that can process a CLI thread, such as Claude Code, Codex, Cursor, opencode, or Antigravity.
_Avoid_: Agent

**CLI thread**:
A project conversation routed to one CLI runtime through a selected CLI profile and working path.
_Avoid_: Chat as the product term, Agent execution

**CLI thread context**:
The current CLI thread identity and related metadata supplied by the Convoy CLI runner to the spawned CLI runtime.
_Avoid_: MCP tool argument when referring to injected runtime context

**Thread run**:
One execution of a CLI thread by its CLI runtime, started from the thread's queued user messages and ending when the run completes or fails. A run is what carries a diff stat, a pull request lookup, and an Execution branch.
_Avoid_: Batch as the product term, turn, Agent execution

**Working path**:
The directory on the CLI profile's machine where a CLI thread runs, chosen from that profile's known working paths.
_Avoid_: Repo, project folder

**Forked thread**:
A CLI thread branched from one Thread run of another thread: it owns a copy of that run, resumes the same agent session, and shows the parent's earlier messages by reference.
_Avoid_: Branch (unqualified, which means a git branch), sub-thread, cloned thread

**Thread handoff**:
A new CLI thread started from a Markdown transcript of another thread's conversation through one Thread run. It runs a fresh agent session, so the CLI runtime may differ from the source's. The source is never modified.
_Avoid_: Delegate (that is task delegation to an agent), fork, transfer

**Thread worktree**:
A git worktree requested when a CLI thread is created and created by the CLI on first claim, which then repoints the thread's Working path at it.
_Avoid_: Branch, checkout

**Execution branch**:
The branch actually checked out when the thread's last Thread run started. Absent for detached HEAD, non-Git paths, and threads that never ran.
_Avoid_: Worktree branch, target branch

**Thread queue**:
A CLI thread's unprocessed user messages, waiting for a CLI session to run them.
_Avoid_: Inbox, backlog

**Held queue**:
A Thread queue parked by Stop: the messages survive but no CLI session picks them up until the next send or retry clears the hold.
_Avoid_: Paused thread, canceled queue

**Claim**:
A CLI session's exclusive hold on a CLI thread while it runs, bounded by a lease that expires if the session goes silent.
_Avoid_: Lock, assignment

**Streaming**:
The state of a CLI thread whose current Thread run is producing output into its active assistant message.
_Avoid_: Live, typing

**Unread**:
A CLI thread with activity the user has not opened since it happened.
_Avoid_: New

**Needs attention**:
The state of a CLI thread that stopped and needs the user: it failed, or it asked a question and is waiting for input.
_Avoid_: Waiting as the umbrella term, blocked

**Acknowledge**:
Clearing a thread's Needs attention state by seeing it, without marking the thread read or Done.
_Avoid_: Dismiss, resolve

**Done thread**:
A CLI thread the user explicitly marked as finished with. Newer activity invalidates the mark. Done is the only put-away state for threads; the alternative is deletion.
_Avoid_: Archived, closed, completed

**Watch Tower**:
The cross-project surface listing a user's CLI threads that need review or action.
_Avoid_: Feed, inbox

**Watch status**:
The single bucket a CLI thread falls into on Watch Tower, derived from its state.
_Avoid_: Status (unqualified), which is the thread's own run state

**Settled**:
The Watch status of a thread that finished and has been read. Named apart from Done because a Done thread is an explicit user mark, not a consequence of reading.
_Avoid_: Done for this bucket

**Container thread**:
A CLI thread row with no transcript of its own that represents many child CLI threads as one thread-list item; every container is a group, a Workflow run's container additionally carries the run binding, and it carries a derived Group status.
_Avoid_: Folder, virtual thread

**Thread group**:
A user-created Container thread whose Group children are shown as tabs in the detail area. A plain CLI thread is conceptually a group of one; the container is created lazily when a second thread is added to it.
_Avoid_: Collection, convoy, split view (as the entity name), parent thread

**Group child**:
A CLI thread that belongs to a Thread group. Two children of the same group are siblings — a relation between children, never a name for a member.
_Avoid_: Sub-thread, sibling as a standalone noun

**Manual thread**:
A CLI thread created by a user or agent outside workflow step execution. It can
share a Workflow run's Container thread without belonging to a Lane or Step.
Canceling the run leaves it running. It may leave the container.
_Avoid_: Manual lane, ad hoc step

**Add thread to group**:
Starting a new CLI thread beside an existing one, which forms the Thread group if the source thread is not already in one.
_Avoid_: Split, fork, branch

**Remove thread from group**:
Moving a Group child or a manual thread in a Workflow run container back to the thread list as a standalone CLI thread. Code name: move out.
_Avoid_: Ungroup, delete

**Group status**:
The single status a Thread group displays, derived from its Group children by loudest-wins precedence and never set directly.
_Avoid_: Aggregate status as the product term, container status

**Origin child**:
The oldest live Group child, whose Execution branch and attached task the group row displays.
_Avoid_: First thread, founding thread

**Group cascade**:
The rule that an action on a Thread group applies to every Group child and never moves a child out of the group.
_Avoid_: Children follow, bulk action

**Workflow**:
A project-scoped, reusable definition of staged prompts and actions that drive CLI threads automatically.
_Avoid_: Pipeline, playbook, automation (unqualified); never "workflow" for task Statuses

**Workflow version**:
An immutable snapshot of a Workflow's definition, cut automatically at run start when the freely editable draft has changed since the last version. Version history is exactly the definitions that have run.
_Avoid_: Revision, publish, save point

**Workflow run**:
One execution of a Workflow, pinned to exactly one Workflow version.
_Avoid_: Execution (reserved for Agent execution), job

**Stage**:
A barrier group of Steps in a Workflow; the next Stage starts only when every Step in the current Stage is completed or skipped.
_Avoid_: Phase, row

**Lane**:
A column in a Workflow that maps to one CLI thread per run; a Lane's Steps run sequentially while different Lanes run concurrently within a Stage.
_Avoid_: Track, column, thread (as the authoring term)

**Single lane**:
A Lane that maps to exactly one CLI thread per run and stores that thread's start settings as Lane defaults (runtime, model, effort, mode, optional Project agent).
_Avoid_: Normal lane, sequential lane

**Parallel lane**:
A Lane whose Steps within a Stage run concurrently, each in its own fresh CLI thread carrying its own runtime settings, with no conversation continuity.
_Avoid_: Fan-out lane

**Step**:
A single unit of work in a Workflow: a prompt sent to a CLI thread, a wait for a human, or a predefined script.
_Avoid_: Task (overloaded), action (unqualified)

**Lane hold**:
The blocked state of a run's Lane after a user manually messages its thread; the run sends no further Steps to that Lane until the starting user resumes it.
_Avoid_: Pause (unqualified), interference

**Prompt step**:
A Step that sends a prompt into its Lane's CLI thread and completes when that thread's run completes.
_Avoid_: Message step, agent step

**Wait step**:
A Step that blocks its Lane until the starting user approves; it has no runtime and executes nothing.
_Avoid_: Checkpoint, gate, pause step

**Bash step**:
A Step that runs a predefined script on the connected CLI's machine, held for approval unless the Lane's mode runs it directly.
_Avoid_: Script step, action step, exec

**Kickoff step**:
A run-local Prompt step inserted ahead of Stage 1 when the first Lane has no prompt to prefill, carrying the text typed at start; it exists only in the run, never in the Workflow version.
_Avoid_: Bootstrap step, initial prompt

**Stage barrier**:
The rule that no Step of the next Stage dispatches until every Step of the current Stage is completed or skipped, across all Lanes.
_Avoid_: Sync point, join

**Starting user**:
The user who started a Workflow run; the only one who approves Wait steps, resumes Lane holds, retries or skips failed Steps, and cancels the run.
_Avoid_: Owner, operator, approver

**Run view**:
The threads-page panel for one Workflow run that lists its Steps grouped by Stage with live status and the starting user's controls, and opens the thread each Step ran in; the run's Container thread renders it as the detail pane until Lane threads exist, and every child of the run container, including manual threads, carries it as the Workflow sidebar tab.
_Avoid_: Run navigator, run sidebar, run panel, thread group

**Run rail**:
The collapsed column of Step dots docked at the right edge of a run-bound CLI thread's transcript, centered on the live Step; hovering expands it into a bordered panel with Step titles and the same controls as the Run view. The dot column is also an expand button for click, tap, or Enter/Space after Tab focus. The expanded header has a Pin/Unpin toggle; Escape within the rail closes it and restores focus. An addon to the Run view, not a replacement.
_Avoid_: Workflow preview, minimap, stepper, run navigator

**Run grid**:
The Workflows-section detail of one Workflow run: the Stage × Lane editor grid rendered live with per-Step status and links into each Lane's thread.
_Avoid_: Run detail page, full run view

## Relationships

- A user message may carry one **Task** and one **Attached pull request**. A **CLI thread**'s Attached pull request is the first one sent or attached and is never replaced.
- A **CLI thread** may have both an **Attached pull request** and a **Branch pull request**; when they are the same Pull request it shows once.
- An **Attached pull request**'s state never changes the **CLI thread**'s state; merging it does not make the thread a **Done thread**.
- A **Guide**'s **CLI thread** has the Guide's Pull request as its **Attached pull request**.
- A **Pull request** references a **Task** when its title, branch name, or labels contain the Task's ref, in any case. Its description does not count.
- A **Pull request** may reference several **Tasks**, from any project in the organization; each shows only to members who can open it.
- A **Reviewed mark** belongs to one user and one file of one **Pull request**.
- A **Guide** is written by an agent in a **CLI thread** on the requesting member's CLI profile.
- Choices made when requesting a **Guide** (CLI profile, Working path or Thread worktree, model) are remembered for Guides only and never change the member's CLI thread defaults.
- A **Guide** records who requested it, the model that wrote it, the revision it was written for, and the **Guide prompt** it used.
- A **Guide** whose run failed stays visible as failed; only its requester can retry it.
- Only a **Guide**'s requester or a project admin can delete it.
- A **Guide**'s **CLI thread** stays private to its requester unless they share it.
- A **Follow-up guide** is based on the newest **Guide** on the **Pull request**, whoever requested it, and records that base.
- An Unchanged **Guide step** in a **Follow-up guide** matches its base word for word and covers no file changed since the base.
- What a member has already read is known from their **Reviewed marks**; there is no separate read state for **Guides**.
- Requesting a **Guide** for a revision another member's Guide is still being written for warns first; the member may start their own anyway.
- An API key belongs to one user.
- An **Agent** belongs to one organization.
- An **Agent** has one **Agent prompt**.
- An **Agent** has one **Agent appearance**.
- An **Agent** may have one category string for organization catalog grouping.
- A **Slash command** has one scope: organization or project.
- A **Slash command** belongs to one organization; a project-scoped Slash command additionally belongs to one project in that organization.
- A **Slash command** has one **Slash command key**.
- A **Slash command key** is unique among active Slash commands in the same scope owner (one organization, or one project).
- Typed Slash command usage can disambiguate scope with a leading scope selector such as `/project:` or `/org:`; that selector is separate from the stored key text.
- A **Slash command** has one **Slash command content** body.
- A **Slash command** may have one category string for organization catalog grouping.
- **Auto-expand** is a behavior of a Slash command, not an instruction to start an Agent execution.
- Organization **Agent** templates are managed from organization settings.
- An **Agent** can be copied into many projects in its organization.
- A **Project agent** is created from exactly one **Agent**.
- A **Project agent** may also be created directly inside a project without an Agent source.
- A **Project agent** copies the Agent prompt and Agent appearance at creation and can later change them independently.
- A **Project agent** copies the Agent category string at creation and can later change it independently.
- A **Project agent** name, description, prompt, category, and appearance are local to the project after creation.
- Project members with task write access can create and manage all **Project agents** in their project.
- A **Project agent** means an Agent is available in a project; it is not a project member and does not carry project permissions.
- Project-created **Project agents** do not automatically become organization **Agents**.
- Editing an **Agent** does not automatically change existing **Project agents** copied from it.
- Deleted **Agents** and **Project agents** may leave historical references that display as deleted agent placeholders.
- Removing a **Project agent** from future selection does not clear existing **Task** assignments to that Project agent.
- An **Agent execution** runs work for exactly one **Agent**.
- An **Agent execution** has one **Agent trigger**.
- An **Agent execution** has one **Execution principal**.
- Assigning a **Task** to an **Agent** does not start an **Agent execution** by itself.
- A **Task** has zero or one **Assignee**.
- A **Task** **Assignee** may be a user or an **Agent**.
- A **Task** can be assigned to a **Project agent** from the Task's project.
- Assignee filtering treats user assignees and **Project agent** assignees as one combined **Assignee** dimension.
- Task assignee change history records typed **Assignee** values, while broader **Attribution** remains separate.
- Task assignee selection lists existing **Project agents** but does not create them inline in v1.
- **Attribution** is separate from **Assignee** because it records who performed an action and under what authority, not who owns the work.
- V1 **Agent** and **Project agent** assignment does not include **Agent execution** orchestration.
- A **Task** belongs to exactly one current **List**.
- A **Subtask** is a **Task**.
- A **Subtask** has exactly one parent **Task**.
- A **Task** has one rank, interpreted within its current **List**.
- A **Task** stores its current container as a list key.
- A **List** belongs to one project.
- Every project has a default **List**.
- **Inbox** is created with each project and starts as the project default **List** after the default Inbox slice lands.
- A project must have at least one active **List**.
- New **Tasks** without an explicit **List** are created in the project default **List** after the default Inbox slice lands; before that, they use existing normal task creation behavior.
- During the first project **Lists** phase, task list keys are optional while legacy Backlog and archive behavior still exist.
- During that phase, the project header **Lists** dropdown includes legacy **Backlog List** and **Archived List** entries; list search filters persisted lists only.
- Before project default **List** persistence lands, the header **Inbox** entry clears selected persisted **List** state and uses existing normal task behavior.
- After system **List** migration, every **Task** has a list key.
- Making task list keys required follows a widen-migrate-narrow migration.
- Product/API boundaries expose structured **List** references rather than raw list keys.
- A **Skill** has one scope: organization or project.
- A **Skill** belongs to one organization; a **Project Skill** additionally belongs to one project in that organization.
- A **Skill** has exactly one `SKILL.md` **Skill file**, plus zero or more others.
- A **Skill file** is addressed by its path within its **Skill**, never by an ID.
- A **Skill** name is unique among active Skills in the same scope owner (one organization, or one project).
- A **Project Skill** may share a name with an **Organization Skill**, because Organization Skills are never exposed to agents.
- A **Skill** may have one category string for settings catalog grouping.
- Saving a **Skill** writes its whole file set at once and bumps its version once, however many files changed.
- A **Skill install** creates one **Project Skill** from one **Organization Skill**; the copy is independent afterward.
- Editing an **Organization Skill** does not change installed copies, and deleting it leaves them untouched.
- An installed **Project Skill** whose template-owned content diverged from its installed version is **Locally edited**.
- A **Skill refresh** replaces a **Project Skill**'s whole file set from its source and clears **Locally edited**; local edits are never merged.
- Only **Project Skills** are delivered to agents and mentionable in the composer.
- Mentioning a **Skill** in the composer names it rather than expanding its body.
- An **API key scope** cannot grant access beyond the owning user's permissions.
- An unscoped API key follows the owning user's permissions.
- An **API key scope** may name zero or one organization.
- An organization-scoped API key may name zero or more allowed projects inside that organization.
- An organization-scoped API key with no allowed projects can act in every project in that organization that the owning user can access.
- The owning user can change or clear an **API key scope**.
- An **Environment** belongs to one user and one backend.
- An **Environment** has zero or more **CLI profiles**, one per project set up on it; a **CLI profile** has at most one **Environment**.
- A **CLI profile** belongs to one user and one project.
- A **CLI profile** has one or more known working paths.
- A **CLI session** belongs to one **CLI profile**.
- A **CLI session** reports which **CLI runtimes** are currently available.
- A **CLI thread** is created against one **CLI profile**, one working path, and one **CLI runtime**.
- A **CLI thread** may be created while its **CLI profile** has no online **CLI session**, but it will not run until a matching session claims it.
- A **CLI thread** has one **CLI thread context** while it is being processed by a **CLI runtime**.
- Inside the threads surface, the bare word "thread" means a **CLI thread**.
- A **CLI thread** runs at one **Working path** on its **CLI profile**'s machine.
- A **CLI thread** may request a **Thread worktree** at creation; the CLI creates it on first claim and repoints the thread's **Working path** at it.
- A **Thread run** records the **Execution branch** it started on; a thread that never ran has none.
- A **CLI thread** has one **Thread queue**; a **Claim** by one **CLI session** is required to run it.
- A **Claim** is exclusive and lease-bound: a silent session's lease expires and the thread returns to the queue.
- Stopping a thread leaves a **Held queue**: the messages survive but no **CLI session** picks them up until the next send or retry.
- **Unread**, **Needs attention**, and **Done thread** are independent states: **Acknowledge** clears attention without marking the thread read or done, and reading does not mark it done.
- A **Done thread** stops being done when new activity arrives.
- **Done** is the only put-away state for a **CLI thread**; there is no archived state.
- A **CLI thread** has one **Watch status** on **Watch Tower**, derived from its state.
- The **Watch status** of a finished, read thread is **Settled**, which is not the same as a **Done thread**.
- MCP task tools use `listId` for **List** inputs; the value may be either a
  raw List ID or a bare project-scoped **List ref**.
- MCP rejects scoped **List ref** strings like `OTHER/SPRINT-1` in task
  operations; the project is resolved first, then the **List** inside it.
- MCP exposes `list_task_lists` for **List** discovery and `move_tasks_to_list`
  for moving existing **Tasks** into an active persisted **List**.
- A parent **Task** and its descendants must belong to the same **List**.
- Moving a parent **Task** to another **List** moves its descendants with it.
- Moving a child **Task** to another **List** detaches it from its old parent and moves its descendants with it.
- Moving a subtree to another **List** assigns a new rank only to the moved subtree root; descendants keep their relative child order.
- Moving a **Task** between containers recalculates the moved root rank in the target container.
- Moved root **Tasks** land at the top of the target container, preserving relative root order for bulk moves.
- Bulk move callers pass only moved subtree roots; overlapping parent/descendant roots are rejected.
- Moving selected **Tasks** to a **List** is a v1 operation targeting an
  existing active persisted **List**; inline **List** creation belongs to the
  existing header/settings management flows.
- Moving all tasks matching the current filtered view is deferred beyond v1.
- The **Inbox** is a persisted required **List**.
- The **Backlog List** is a built-in **List**.
- The **Archived List** is a built-in **List**.
- The **Archived List** has archive-specific visual and interaction behavior.
- Required/system **Lists** cannot be deleted by users.
- The last active **List** in a project cannot be archived or deleted.
- Non-required **Lists** can be archived or deleted only when empty.
- **List** names are unique within a project, case-insensitively.
- The project default **List** sorts first in normal List navigation.
- Non-default active **Lists** sort alphabetically in v1; manual **List** ordering is deferred.
- **Lists** are project-wide shared objects, not personal views.
- A **List ref** identifies a **List** in user-facing integrations.
- A **List ref** is uppercase.
- Changing a **List ref** is allowed only as an explicit user choice because it can affect integrations.
- Status, assignee, and search filters apply within the selected **List**.
- New **Tasks** are created in the selected **List**, or the project default **List** when no **List** is selected after default Inbox persistence lands.
- New **Tasks** cannot be created directly in the **Archived List**.
- A **List move activity** records previous list membership when a **Task** changes **List**.
- **Table** and **Board** are rendering modes for tasks in a **List**.
- A **Board** is organized into **Board groups**.
- A **Board group** can represent one value or multiple values from the active grouping dimension.
- **Board grouping** organizes the tasks that remain after List selection and filters are applied.
- Status is one possible **Board** grouping dimension, not the definition of a **Board**.
- The first Lists implementation is **Table**-first; **Board** rendering for Lists is deferred.
- An **Artifact comment** belongs to exactly one **Artifact**.
- An **Artifact comment** is either a root comment or a **Comment reply** to exactly one root.
- A **Comment reply** cannot have its own replies.
- An **Artifact comment** has one **Comment anchor** captured when it is created.
- A **Comment anchor** stores the selected snippet, surrounding context, and character offsets; it is a hint re-validated against current content, not a guaranteed live position.
- An **Artifact comment** becomes a **Detached comment** when its **Comment anchor** text is not found in the current Artifact content, and re-attaches if that text reappears.
- **Resolve** applies to a root **Artifact comment** and covers its replies.
- Any project member who can view the **Artifact** can create, reply to, and **Resolve**/un-resolve comments.
- A user can delete their own **Artifact comments**; project admins can delete any.
- Deleting a root **Artifact comment** deletes its replies.
- **Artifact comments** are supported on markdown Artifacts; HTML Artifacts are out of scope in v1.
- A **Workflow** belongs to one project.
- A **Workflow** is edited by project members with task write access; starting a **Workflow run** requires CLI thread permission.
- A **Workflow** contains ordered **Stages**; a **Stage** contains **Steps**; each **Step** belongs to one **Lane**.
- Vertical Step position inside a Stage is layout only; execution order comes from Lane sequence and Stage barriers.
- A **Workflow run** pins exactly one **Workflow version**; editing or deleting the Workflow never changes a pinned version.
- Deleting a **Workflow** cancels its active **Workflow runs**; run history is kept and renders via pinned versions.
- A **Workflow** may have many concurrent **Workflow runs**.
- Within a **Workflow run**, each Lane maps to exactly one CLI thread (created lazily on the Lane's first executable Prompt or Bash Step), except a **Parallel lane**, where each executable Step gets its own thread.
- A run-created CLI thread belongs to exactly one run and Lane; it remains a normal CLI thread after the run.
- Manual threads may share the run container, including before any lane thread exists or after the run ends. They have the Workflow tab but no Run rail and do not affect workflow execution or cancellation.
- A Workflow run container keeps the run's status even while manual children run. All children contribute unread and attention indicators.
- Run-created CLI threads are children of the run's **Container thread**, so they collapse out of the flat thread list; the run shows as one thread-styled item that opens the Step-by-Stage **Run view**.
- A **Container thread** has one nesting level: a child CLI thread is never itself a container, and a thread belongs to at most one container.
- Deleting a **Container thread** applies to its child threads; children are never promoted to standalone threads.
- A **Container thread** carries a child count and unread/attention indicators maintained when a child changes. Ordinary groups derive **Group status** from their children; Workflow run containers show the run status.
- A **Container thread** has no **Thread queue** and can never be claimed or receive messages.
- **Add thread to group** seeds the new thread from the thread it was added beside — profile, path or **Thread worktree**, runtime, model, effort, mode, **Project agent**, attached **Task** — and every field is changeable before sending.
- **Group children** share no constraints after creation: not runtime, machine, **Working path**, model, or attached **Task**.
- Nested **Thread groups** do not exist: a **Group child** is never itself a group.
- A **CLI thread** joins a **Thread group** only by being added beside another thread; existing standalone threads cannot be moved in.
- **Remove thread from group** returns a **Group child** or a manual child of a Workflow run container to the thread list. Workflow-owned threads stay attached.
- A **Thread group** is deleted automatically when its last **Group child** is removed or deleted.
- **Thread group** membership is capped: every child-creating path rejects at the cap, which counts every row ever parented under the container — removed and deleted children included — not just live members.
- A **Thread group** shows one **Group status**: any failed child wins, then any child that **Needs attention**, then any running child, otherwise idle. A failure masks a sibling's waiting state until acknowledged.
- A **Thread group** is **Unread** or **Needs attention** when any **Group child** is.
- A **Thread group** displays the **Origin child**'s **Execution branch** and attached **Task**; diff stats and pull requests stay per child.
- The **Origin child**'s attached **Task** is a display value only: a **Thread group** is never a participant in that Task's agent thread work.
- **Group cascade**: marking a **Thread group** read, unread, done, or not-done, and deleting it, applies to every **Group child**; cascades skip children already in the target state and never remove a child from the group.
- Done-ness is group-local: a cascade stamps the group's own done mark, and any child activity invalidates it.
- Pin applies to a **Thread group**, not to its children: a **Group child** cannot be pinned, and when a group forms from a pinned thread the pin transfers to the group.
- Thread-list batch actions count a selected **Thread group** as its whole live membership, so both the selected row count and the expanded row count are capped.
- A **Thread group** takes its title from the thread it formed around and is renamed independently afterwards: renaming from the thread list renames the group, renaming inside a thread renames that **Group child**.
- A **Group child**'s automatic title comes from its own prompt, with the attached **Task** name only as a fallback — the reverse of an ungrouped **CLI thread**.
- **Container threads** never appear on **Watch Tower**; their child threads appear there as ordinary **CLI threads**.
- All of a run's CLI threads attach to the run's optional **Task**.
- A **Workflow run** uses one CLI profile and path (or new worktree) shared by all Lanes; each **Single lane** stores its thread's start settings as Lane defaults, and its Steps may override only model, effort, and mode.
- A **Parallel lane** has no Lane defaults; each of its Steps carries its own runtime settings — including the CLI runtime and Project agent — because each runs in its own fresh CLI thread.
- A prompt **Step** completes when its assistant batch completes; a failed batch pauses the run at that Step, resumable or skippable by the starting user.
- A **Lane hold** blocks only its own Lane; other Lanes keep advancing.
- Only the starting user resumes waits, holds, and failed Steps of a **Workflow run**.
- Canceling a **Workflow run** stops advancing and cancels in-flight Steps; canceled runs cannot resume.
- A **Step** is one of **Prompt step**, **Wait step**, or **Bash step**; a **Kickoff step** is a run-local Prompt step.
- A **Wait step** and a held **Bash step** park their Lane's thread as **Needs attention** with an in-thread approval card; Approve there and on the **Run view** row are the same action.
- The **Run rail** shows on every run-bound CLI thread for the run's whole lifetime — collapsed and read-only once the run is completed or canceled — and highlights the Step running in the open thread.
- **Run rail** controls (Approve, Resume, Retry, Skip, Cancel) call the same actions as the **Run view** and render only for the **Starting user**; Cancel keeps its confirmation.
- A **Check result** belongs to the **Task** its thread was attached to when it was reported, or to the **CLI thread** if none; attaching a Task moves the thread's results to it.
- A **Task** shows its **Checklist**'s Checks plus every Check that already has a result; switching the Checklist never removes a result.
- **Check results** on a **Task** are visible to everyone who can see the Task, even when the reporting **CLI thread** is private.
- Checks never block marking a **Task** or **CLI thread** done.

## Example dialogue

> **Dev:** "If a **Task** moves from Inbox to Sprint 2, does it stay in both?"
> **Domain expert:** "No — it has one current **List**. Inbox becomes history."

## Flagged ambiguities

- "agent" was ambiguous: CLI runtime language used it for connected execution surfaces, MCP discussion used it for any tool caller, while task assignment needs an organization-owned actor. Resolved: **Agent** is the organization-owned template, **Project agent** is the editable project-local copy, **Agent execution** is a concrete run, and **MCP client** is the generic tool caller.
- "list" was ambiguous: existing product language used `List` for a table-like rendering mode, while OS-819 used "lists" for task containers. Resolved: use **Table** and **Board** for rendering modes, and **List** for task containers.
- Previous list names are not stored as tags; task list changes are recorded as **List move activity**.
- Backlog and archived work are modeled as built-in **Lists**.
- Backlog is not a **Status** in the target model.
- Done and Canceled remain **Statuses**, not **Lists**.
- During migration from Backlog status to **Backlog List**, leaving the **Backlog List** restores the prior **Status** when known, otherwise `To Do`.
- Project **Lists** and the project default **List** are introduced before replacing existing Backlog and archive behavior with system **Lists**.
- During the first project **Lists** phase, missing task list membership is legacy state interpreted through existing backlog, archive, and normal task behavior.
- During the first project **Lists** phase, a task in a **List** cannot also be in Backlog status.
- "archived" was retired for **CLI threads**: three put-away states (archived, done, deleted) were one too many, so **Done thread** absorbed archive. Older spec text still describes archived threads and archived **Group children** — read those as **Done**.
- "done" is ambiguous across thread surfaces: a **Done thread** is an explicit user mark that newer activity invalidates, while the **Watch status** of a finished, read thread is **Settled**. Never call that bucket done.
- "group" is ambiguous across domains: a **Board group** is a column of tasks, a **Thread group** is a container of **CLI threads**. Neither is called a collection.
- "archived" means three things: the **Archived List** holds Tasks removed from planning, archived **CLI threads** are retired (read as **Done**), and an **Archived pull request** is GitHub's closed-and-locked state.
- "the thread's PR" is ambiguous: the **Attached pull request** is what the work is about, the **Branch pull request** is what the thread's branch opened. Name which.
- "environment" was used twice: the CLI used it for the place threads run, and the composer used it for the local-or-worktree choice. Resolved: **Environment** is the place, and the composer's choice is the worktree choice.
- "reviewed" on a file is a **Reviewed mark**, not GitHub's Viewed flag: anyone can view every file, but only reviewing it earns the mark.
