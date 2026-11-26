# Manual Test Cases: One-shot CLI Commands

Prerequisites:
- Build the CLI if you want to use the built entrypoint: `pnpm --filter @useconvoy/cli build`
- Have at least one profile configured: `convoy setup`
- Run commands from this workspace root: `/src`

Run CLI in dev mode with:

```bash
pnpm --filter @useconvoy/cli run dev -- ...
```

Or after building:

```bash
node apps/cli/dist/bin/convoy.js ...
```

Built-script forwarding through pnpm also works:

```bash
pnpm --filter @useconvoy/cli run start -- tasks search --help
```

Examples below use the dev-mode form.

---

## Placeholders

Replace these values for your environment:
- `<projectId>`: Convex project ID
- `<taskId>`: Convex task ID
- `<userId>`: Convex user ID
- `<projectAgentId>`: Convex Project-agent ID
- `<listId>`: Convex List ID
- `<threadId>`: Convex CLI thread ID
- `<containerId>`: Convex CLI thread ID of a thread group container
- `<profileId>`: Convex CLI profile ID (from `profiles list`)
- `<pathId>`: Working-path ID on that profile (from `profiles list`)
- `<cursor>`: Pagination cursor returned by a previous search page
- `WEB`: example project alias
- `acme`: example organization slug

---

## `orgs list`

```bash
pnpm --filter @useconvoy/cli run dev -- orgs list
pnpm --filter @useconvoy/cli run dev -- orgs list --profile work
pnpm --filter @useconvoy/cli run dev -- orgs list --json
pnpm --filter @useconvoy/cli run dev -- orgs list --output json
```

---

## `projects list`

```bash
pnpm --filter @useconvoy/cli run dev -- projects list
pnpm --filter @useconvoy/cli run dev -- projects list --profile work
pnpm --filter @useconvoy/cli run dev -- projects list --org acme
pnpm --filter @useconvoy/cli run dev -- projects list --org org_abc123
pnpm --filter @useconvoy/cli run dev -- projects list --json
pnpm --filter @useconvoy/cli run dev -- projects list --output json
```

---

## `task-types list`

```bash
pnpm --filter @useconvoy/cli run dev -- task-types list --project WEB
pnpm --filter @useconvoy/cli run dev -- task-types list --project WEB --org acme
pnpm --filter @useconvoy/cli run dev -- task-types list --project <projectId> --json
```

---

## `project-agents`

```bash
pnpm --filter @useconvoy/cli run dev -- project-agents list --project WEB
pnpm --filter @useconvoy/cli run dev -- project-agents list --project WEB --json
pnpm --filter @useconvoy/cli run dev -- project-agents create --project WEB --name "Reviewer" --color "#3b82f6"
pnpm --filter @useconvoy/cli run dev -- project-agents create --project WEB --name "Planner" --color "#8b5cf6" --automation enabled --automation-cli-type codex --automation-workspace worktree
pnpm --filter @useconvoy/cli run dev -- project-agents update <projectAgentId> --description "Reviews pull requests"
pnpm --filter @useconvoy/cli run dev -- project-agents update <projectAgentId> --automation disabled
pnpm --filter @useconvoy/cli run dev -- project-agents update <projectAgentId> --clear-automation --json
```

---

## `worktree-setups`

Run inside a checkout of a repo the project has registered.

```bash
printf 'cp "$CONVOY_PARENT_PATH/.mcp.json" .\npnpm i\n' > /tmp/setup.sh
pnpm --filter @useconvoy/cli run dev -- worktree-setups set --project WEB --file /tmp/setup.sh
pnpm --filter @useconvoy/cli run dev -- worktree-setups list --project WEB
pnpm --filter @useconvoy/cli run dev -- worktree-setups get --project WEB > /tmp/got.sh && diff /tmp/setup.sh /tmp/got.sh
pnpm --filter @useconvoy/cli run dev -- worktree-setups set packtrain/convoy --project WEB --script "pnpm i" --json
pnpm --filter @useconvoy/cli run dev -- worktree-setups delete packtrain/convoy --project WEB
```

After `set`, open the printed link: the row shows "Needs your approval" (or
"Changed since you approved"). Approve it, start a "New worktree" thread, and
watch the script run before the agent starts.

---

## `tasks list`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks list
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB
pnpm --filter @useconvoy/cli run dev -- tasks list --project <projectId>
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org acme
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org org_abc123
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org acme --archived
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org acme --list BACKLOG
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org acme --status Triage
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org acme --status "Plan Review"
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org acme --archived --status "Plan Review"
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org acme --json
pnpm --filter @useconvoy/cli run dev -- tasks list --project WEB --org acme --output json
```

---

## `tasks search`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug"
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project <projectId>
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --org acme
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --archive-mode archived
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --status "Plan Review"
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --assignee-id <userId>
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --unassigned
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --limit 5
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --limit 5 --cursor <cursor>
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --json
pnpm --filter @useconvoy/cli run dev -- tasks search "billing bug" --project WEB --output json
```

---

## `tasks get`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks get <taskId>
pnpm --filter @useconvoy/cli run dev -- tasks get <taskId> --json
pnpm --filter @useconvoy/cli run dev -- tasks get <taskId> --output json
# Runs section: use a task with threads from more than one user
pnpm --filter @useconvoy/cli run dev -- tasks get <taskId>   # expect "Runs: <n>" + one row per thread
```

---

## `tasks refs`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks refs WEB-12 WEB-42 --project WEB --org acme
pnpm --filter @useconvoy/cli run dev -- tasks refs WEB-12 WEB-42 --project <projectId>
pnpm --filter @useconvoy/cli run dev -- tasks refs WEB-12 WEB-42 --project WEB --org org_abc123
pnpm --filter @useconvoy/cli run dev -- tasks refs WEB-12 WEB-42 --project WEB --org acme --json
pnpm --filter @useconvoy/cli run dev -- tasks refs WEB-12 WEB-42 --project WEB --org acme --output json
```

---

## `tasks artifacts list`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks artifacts list <taskId>
pnpm --filter @useconvoy/cli run dev -- tasks artifacts list <taskId> --json
pnpm --filter @useconvoy/cli run dev -- tasks artifacts list <taskId> --output json
```

---

## `tasks artifacts get`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks artifacts get <artifactId>
pnpm --filter @useconvoy/cli run dev -- tasks artifacts get <artifactId> --json
pnpm --filter @useconvoy/cli run dev -- tasks artifacts get <artifactId> --output json
```

---

## `tasks artifacts create`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks artifacts create <taskId> --name "Implementation plan"
pnpm --filter @useconvoy/cli run dev -- tasks artifacts create <taskId> --name "Implementation plan" --content "# Plan"
pnpm --filter @useconvoy/cli run dev -- tasks artifacts create <taskId> --name "Implementation plan" --content-file ./tmp/plan.md
pnpm --filter @useconvoy/cli run dev -- tasks artifacts create <taskId> --name "Run summary" --content-file ./tmp/summary.md --run-id run_123
pnpm --filter @useconvoy/cli run dev -- tasks artifacts create <taskId> --name "JSON artifact" --content "# Plan" --json
pnpm --filter @useconvoy/cli run dev -- tasks artifacts create <taskId> --name "JSON artifact" --content "# Plan" --output json
```

---

## `tasks artifacts update`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks artifacts update <artifactId> --name "Updated artifact"
pnpm --filter @useconvoy/cli run dev -- tasks artifacts update <artifactId> --content "# Updated markdown"
pnpm --filter @useconvoy/cli run dev -- tasks artifacts update <artifactId> --content-file ./tmp/updated.md
pnpm --filter @useconvoy/cli run dev -- tasks artifacts update <artifactId> --clear-content
pnpm --filter @useconvoy/cli run dev -- tasks artifacts update <artifactId> --run-id run_456
pnpm --filter @useconvoy/cli run dev -- tasks artifacts update <artifactId> --clear-run-id
pnpm --filter @useconvoy/cli run dev -- tasks artifacts update <artifactId> --name "JSON update" --json
pnpm --filter @useconvoy/cli run dev -- tasks artifacts update <artifactId> --name "JSON update" --output json
```

---

## `tasks artifacts delete`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks artifacts delete <artifactId>
pnpm --filter @useconvoy/cli run dev -- tasks artifacts delete <artifactId> --json
pnpm --filter @useconvoy/cli run dev -- tasks artifacts delete <artifactId> --output json
```

---

## `tasks create`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks create --name "CLI manual test"
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "CLI manual test"
pnpm --filter @useconvoy/cli run dev -- tasks create --project <projectId> --name "CLI manual test by id"
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "Typed task" --task-type-key bug
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "Plan review task" --status "Plan Review"
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "High priority task" --priority High
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "Task with tags" --tags cli,test
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "Task with assignee" --assignee-id <userId>
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "Subtask" --parent-id <taskId>
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "Due date seconds" --due-date 1700000000
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "Due date milliseconds" --due-date 1700000000000
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "Due date string" --due-date 2026-03-31
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "JSON create" --json
pnpm --filter @useconvoy/cli run dev -- tasks create --project WEB --org acme --name "JSON create" --output json
```

---

## `tasks update`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --name "Updated task name"
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --description "Updated from CLI"
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --clear-description
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --task-type-key feature
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --priority Critical
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --status "Plan Review"
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --assignee-id <userId>
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --unassign
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --tags alpha,beta
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --clear-tags
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --due-date 1700000000
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --due-date 1700000000000
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --due-date 2026-03-31
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --clear-due-date
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --status Triage --priority Low
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --name "JSON update" --json
pnpm --filter @useconvoy/cli run dev -- tasks update <taskId> --name "JSON update" --output json
```

---

## `tasks delete`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks delete <taskId>
pnpm --filter @useconvoy/cli run dev -- tasks delete <taskId> --cascade delete_all
pnpm --filter @useconvoy/cli run dev -- tasks delete <taskId> --cascade keep_children
pnpm --filter @useconvoy/cli run dev -- tasks delete <taskId> --json
pnpm --filter @useconvoy/cli run dev -- tasks delete <taskId> --output json
```

---

## `tasks comments add`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks comments add WEB-12 --project WEB --message "Ready for review"
pnpm --filter @useconvoy/cli run dev -- tasks comments add acme/WEB-12 --message-file ./tmp/comment.md
pnpm --filter @useconvoy/cli run dev -- tasks comments add <taskId> --message "JSON comment" --json
```

---

## `tasks move-to-list`

```bash
pnpm --filter @useconvoy/cli run dev -- tasks move-to-list WEB-12 WEB-42 --project WEB --list SPRINT-1
pnpm --filter @useconvoy/cli run dev -- tasks move-to-list <taskId> --project <projectId> --list <listId>
pnpm --filter @useconvoy/cli run dev -- tasks move-to-list WEB-12 --project WEB --list BACKLOG --json
```

---

## `threads list`

```bash
pnpm --filter @useconvoy/cli run dev -- threads list --project WEB
pnpm --filter @useconvoy/cli run dev -- threads list --project WEB --include-done
pnpm --filter @useconvoy/cli run dev -- threads list --project WEB --limit 5
pnpm --filter @useconvoy/cli run dev -- threads list --project WEB --limit 5 --cursor <cursor>
pnpm --filter @useconvoy/cli run dev -- threads list <containerId>
pnpm --filter @useconvoy/cli run dev -- threads list <containerId> --json
```

---

## `threads get`

```bash
pnpm --filter @useconvoy/cli run dev -- threads get <threadId>
pnpm --filter @useconvoy/cli run dev -- threads get <containerId>
pnpm --filter @useconvoy/cli run dev -- threads get <threadId> --json
```

---

## `threads messages`

```bash
pnpm --filter @useconvoy/cli run dev -- threads messages <threadId>
pnpm --filter @useconvoy/cli run dev -- threads messages <threadId> --limit 3
pnpm --filter @useconvoy/cli run dev -- threads messages <threadId> --json
```

---

## `threads create`

Get `<profileId>` and `<pathId>` from `profiles list` — the two halves of a
target.

```bash
pnpm --filter @useconvoy/cli run dev -- threads create --profile-id <profileId> \
  --path-id <pathId> --cli-type claude-code --content "Say hello and stop"
pnpm --filter @useconvoy/cli run dev -- threads create --profile-id <profileId> \
  --path-id <pathId> --cli-type claude-code --content "Hello" --title "Manual test" --json

# Inherits the source's profile/path/runtime and groups the two threads.
pnpm --filter @useconvoy/cli run dev -- threads create --source <threadId> --content "Review my work"
# A container joins the existing group instead of making a second one.
pnpm --filter @useconvoy/cli run dev -- threads create --source <containerId> --content "Another angle"

# --attach on the first message.
pnpm --filter @useconvoy/cli run dev -- threads create --profile-id <profileId> \
  --path-id <pathId> --cli-type claude-code --content "What is in this file?" --attach ./README.md

# Expect "Model: opus-5-5 (effort: high)"; without the flags, "machine default".
pnpm --filter @useconvoy/cli run dev -- threads create --source <threadId> \
  --cli-model opus-5-5 --cli-effort high --content "Say hello and stop"

# Expect an error naming the valid runtimes, with no mutation attempted.
pnpm --filter @useconvoy/cli run dev -- threads create --profile-id <profileId> \
  --path-id <pathId> --cli-type claude --content "Hello"

# Expect the thread to start in a new worktree on branch feat/try-cli-worktree.
pnpm --filter @useconvoy/cli run dev -- threads create --profile-id <profileId> \
  --path-id <repoPathId> --cli-type claude-code --content "Run git branch --show-current" \
  --worktree-branch feat/try-cli-worktree --base-ref main
```

---

## `threads send`

```bash
pnpm --filter @useconvoy/cli run dev -- threads send <threadId> "Ship it"
pnpm --filter @useconvoy/cli run dev -- threads send <threadId> --content-file ./message.md --json
pnpm --filter @useconvoy/cli run dev -- threads send <threadId> --attach ./screenshot.png

# Expect "Groups and workflow runs cannot receive messages".
pnpm --filter @useconvoy/cli run dev -- threads send <containerId> "Hello"

# Cleanup after a *successful* upload: a container passes the getSummary read, so
# the upload happens and `send` then rejects it. Expect the rejection, and verify
# neither the `cliMessagePendingUploads` row nor the blob survives. Targeting a
# deleted thread would not test this — it fails at getSummary, before any upload.
pnpm --filter @useconvoy/cli run dev -- threads send <containerId> --attach ./README.md
```

---

## `profiles list`

```bash
pnpm --filter @useconvoy/cli run dev -- profiles list
pnpm --filter @useconvoy/cli run dev -- profiles list --project WEB
pnpm --filter @useconvoy/cli run dev -- profiles list --project WEB --org acme
pnpm --filter @useconvoy/cli run dev -- profiles list --json
```
