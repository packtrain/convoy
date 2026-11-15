# Triage role mapping

Despite this file's conventional name, Convoy triage roles are stored as task tags, not task labels.

Task labels are reserved for project-defined stages and must remain untouched.

## Category roles

| Canonical role | Convoy tag |
| --- | --- |
| `bug` | `triage:bug` |
| `enhancement` | `triage:enhancement` |

## State roles

| Canonical role | Convoy tag |
| --- | --- |
| `needs-triage` | `triage:needs-triage` |
| `needs-info` | `triage:needs-info` |
| `ready-for-agent` | `triage:ready-for-agent` |
| `ready-for-human` | `triage:ready-for-human` |
| `wontfix` | `triage:wontfix` |

## Rules

- A triaged task carries exactly one category tag and one state tag.
- Changing a role removes conflicting tags from the same role group.
- Every unrelated task tag must be preserved.
- “Unlabeled” means a task has no triage state tag. It does not refer to Convoy task labels or the absence of unrelated tags.
- Search results must be post-filtered using exact tag equality.
- Applying `wontfix` also requires an explanatory comment and status `Canceled`.
- Tasks carrying `wayfinder:map` or any `wayfinder:<type>` tag are excluded from routine triage discovery unless explicitly requested.
