# Legacy Backlog Status Notes

Backlog is no longer a current workflow status. OS-907 migrated legacy
`status = Backlog` tasks into the synthetic system List `system:backlog`,
restored their workflow status, and removed the live `statusBeforeBacklog`
task field.

Current behavior is specified in `task-lists.md`:

- Backlog is selected with `list=BACKLOG`.
- The public List shape for Backlog is
  `{ type: "system", key: "backlog", ref: "BACKLOG", name: "Backlog" }`.
- `filter=backlog` is not a supported Backlog selector.
- Status selectors and status filters do not include Backlog.
- Moving tasks into or out of Backlog changes List membership only; it does not
  restore or alter workflow status.
- Subtree moves to Backlog move descendants by List key, not by status cascade.

Historical activity logs may still contain the old `Backlog` status value. Those
logs use a historical status validator so they remain readable while current
task state only accepts workflow statuses.
