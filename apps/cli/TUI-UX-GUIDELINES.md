# TUI interaction guidelines

Accepted 2026-10-19 for OS-2064 and older TUI flows. Read these shared interaction rules before changing the CLI UI. The current behavior and validation contract are recorded in [the terminal browser spec](../../docs/specs/cli-tui.md#unified-interactions-cli-01032).

## What went wrong

The implementation gave environment management two competing entry points: an Actions tab and an Environment popup containing another action list. It put important failure information in a transient footer and relied on shortcut hints to reveal creation. It also shows project and run actions when neither is selected.

The earlier playground specification already placed setup in the right panel. Later CLI popup conventions contradicted that direction. We need one rule across these flows, and must update those conflicting documents together when this proposal is accepted.

## Names and navigation

Call the sidebar **Environments**. An environment is where a service and its projects run. Local is an environment too, even though the TUI does not manage its host lifecycle. Docker and local socket are transport details, shown as secondary labels. A connection describes how this TUI reaches an environment; Connected, Reconnecting and Disconnected describe that connection.

Use **+ Add environment** as a permanent top-level sidebar row. For the current delivery this opens managed Docker setup directly. Do not offer an inert SSH choice or a redundant one-option picker. When an existing remote connection can actually be added, the same entry can offer Create managed environment and Connect existing environment.

Within each expanded environment list Actions, Credentials, + Add project, then registered projects. The environment row itself shows Details. Add rows activate on Enter or Space; moving focus through them never starts setup. The empty sidebar still offers Add environment. Successfully creating or resuming an environment selects its Details view and offers Add project.

Environment views are sidebar rows, not tabs. Project selection offers Runs and Actions tabs. Project-specific controls require selecting a project; environment controls live on the environment's rows. A busy project row shows a spinner, driven by the selected environment's pushed status. A selected run has its own labeled controls in run history/detail. Do not carry a remembered run selection into unrelated environment actions.

Keep selection distinct from expansion. Up/Down selects rows, Enter/Space on an environment toggles its children. In the sidebar, Right expands a collapsed environment, Left collapses an expanded one, and Left on a child selects its environment; otherwise Left/Right move between panes outside inputs. Moving the selection opens the selected row's view; project rows open Runs.

## Which surface to use

| Surface | Responsibility | Examples |
| --- | --- | --- |
| Sidebar | Select scope and start creation | Environment, project, Add environment, Add project |
| Details / Runs panel | Show persistent state and browsable content | Health, versions, projects, run history, logs |
| Actions panel | List operations for the selected scope | Update CLI, pause project, open shell |
| Workflow in the right panel | Collect several inputs or show an operation across steps | Setup, update preparation, progress, recovery |
| Compact popup | Ask one bounded question or collect one short value | Stop confirmation, export path, overwrite confirmation |
| Footer | Explain keys available in the current context and summarize connection state | Enter activate, Esc back, reconnecting |

No popup contains a second management menu. There is no separate Environment popup or global e destination. The a shortcut opens the same visible Actions tab. E may remain an accelerator for the visible Add environment row.

A contextual recovery button can invoke an existing action, such as Update CLI in a compatibility notice. It must use the same preparation, confirmation and execution flow, bound to the same target. This is a shortcut into one operation, not another management surface.

Use the right panel for multi-field forms. Keep the sidebar visible but inactive while a form or operation owns the target. The panel title always names that target. Do not build a general overlay manager or a background-job system to achieve this.

## State belongs beside the affected content

Group shared notices by project with a short status row. Combine repeated runtime
login notices and keep full diagnostics in a scrollable details view. Show how many
projects are omitted from a compact summary; never silently drop their warnings.

Environment Details starts with a useful summary: name, transport, connection state, service state, management support and versions when known. Endpoint, container identity and diagnostic fields follow below. Avoid a screen filled with repeated unknown values.

Connection health, service health and lifecycle support are separate facts. A disconnected TUI does not prove that the service or container has stopped. An unmanaged local host can still support service actions.

Use these states consistently:

| State | Main-panel presentation |
| --- | --- |
| Connected | Current service/version summary and ordinary content |
| Reconnecting | Persistent banner, last successful observation marked stale, Retry connection |
| No observation yet | Explain what is being checked; do not show zero projects or zero active work as established facts |
| Service known stopped | Explain that projects cannot run; offer the supported Start action |
| Container known stopped | Offer Start environment; show service health as unavailable until checked |
| Local host not lifecycle-managed | Explain that service controls are available here, but host/container lifecycle and managed updates are unavailable |
| Docker unavailable or ownership check failed | Show the specific blocker and Retry check; never assume ownership or offer an operation that bypasses it |
| Required capability missing | Name the blocked action and show Update CLI if supported; preserve actions that still work |
| Compatible version difference | Show both versions without blocking supported work |

Environment-level blockers remain visible at the top of Details and Actions and as a compact banner on affected project views. Detailed diagnostics can scroll below. Errors are never visible only in the footer.

Hide actions that do not apply to this type of target or selected scope. Keep temporarily unavailable actions visible with a short reason beside the row, such as "Service already stopped" or "Check connection first". More detail appears in the panel when focused, without requiring a failed activation. A shortcut to an unsupported operation produces that same explanation in the panel.

## Action inventory

| Action | Home and behavior |
| --- | --- |
| Add/resume environment | Sidebar Add environment → panel form → review → progress → Details. Detect resume before review and show saved settings and the actual version. Final Create or Resume button is the confirmation; do not add another modal. |
| Add/link project | Environment's Add project row → panel form → review → progress → selected project's Runs. Keep inputs through recoverable failures. |
| Refresh status / retry connection | Details header or error banner. Read-only, no confirmation. Keep connection retry distinct from Start. |
| Service status | Details is its canonical display. A refresh updates that display; do not open a status popup. |
| Saved service logs | Environment Actions → panel log viewer with environment title and Back. No confirmation. Failure stays in that viewer with Retry. |
| Start service | Environment Actions, where supported. Explain that registered projects resume. Compact confirmation because starting can launch work. |
| Stop service | Environment Actions. Confirm that all project connections and active work on this service are affected. Container and private files remain. |
| Restart service | Environment Actions, where supported. Confirm interruption to all projects; display progress and reconnect in the panel. |
| Start/recover environment | Managed environment Actions, in a clearly labeled Container section. Explain that it starts or rebuilds the container and starts the service. Show this as the recovery action when the container is stopped or missing; do not also suggest starting an unreachable service. |
| Stop environment | Managed environment Actions, Container section. Confirm that the whole container and its projects stop, while volumes remain. Keep progress and result in the same compact popup. An absent container is already stopped. |
| Delete environment | Managed environment Actions, including incomplete/stopped targets. Confirm permanent removal of the container and all saved data. Default to Cancel. Keep progress/result in the popup and remove the sidebar target on success. |
| Update CLI | Environment Actions, Maintenance section. Prepare in panel, then show installed → proposed version, exact environment and interruption impact. Explicit Update button confirms once. Progress and failure/recovery remain in panel. |
| Install/update agent runtimes | Managed environment Actions, Maintenance section, opened in the Actions panel. Checklist of runtimes with installed and offered versions in the panel. One compact popup confirms the checked batch, then shows per-runtime progress and failures. Close returns to the refreshed list; Esc returns to Actions. |
| Verify runtime boundaries | Environment Actions, Maintenance section. Explain what probes and runtime-enablement steps run and require confirmation for their changes. Show results in panel. Passing probes does not claim real provider acceptance. |
| Pause project | Selected project's Actions. Confirm affected project/work, then inline result. |
| Reload project | Selected project's Actions. Confirm interruption and configuration reconciliation, including any broader effects reported by the existing operation. |
| Private project shell | Selected project's Actions. Show required pause and target before terminal handoff. Shell owns all input until exit. Return to the same project with explicit Reload; do not silently resume work. |
| Remove project from environment | Selected project's Actions. Confirm exact registration and interruption. Explicitly say that private files remain and the remote project is not deleted. |
| Cancel run | Selected run's controls in history/detail. Confirm exact run and thread. Completed runs show the action as unavailable with a reason. |
| View run logs / execution history | Runs → history → log viewer in main panel. Preserve selection and scroll position on Back. |
| Export logs | Log viewer toolbar. Compact path prompt, overwrite confirmation only when needed, progress/result beside the log viewer. Explain partial-file retention on failure/cancel. |
| Detach TUI | Global quit control. Never label it Stop. During a pending mutation, state that the operation continues and the process will finish before exit. |

Group service controls, maintenance and container controls within one environment Actions panel. Do not require a submenu to reach them. Only render supported controls. Start service and Start environment must explain their different effects; state determines which is the primary recovery action.

Runtime credentials (OS-2065) belong to the environment: its Credentials row adds, rotates, rolls back, disables and deletes named entries and edits each entry's project checklist. Project Actions keeps an assignment shortcut. Native provider login stays in the private project shell. See [runtime credentials](../../docs/specs/cli-tui.md#runtime-credentials-cli-01070).

## Forms, confirmations and operation results

Forms have labeled fields, visible focus, masked secrets, inline validation and explicit Back, Cancel and Review buttons. Tab/Shift+Tab moves between fields. Enter submits only a focused button. No global letter shortcut fires while editing.

A review step already provides confirmation if it names the target, proposed change and impact and has an explicit final action button. Do not follow it with another "Are you sure?" popup.

A compact confirmation defaults to Cancel and names the action in its affirmative button. It must fit completely before execution can be confirmed. If resizing makes it unreadable, preserve it and allow cancel; never interpret Enter as implicit approval.

Back preserves the draft. Cancel closes it; ask before discarding a nonempty draft. Clearing the draft also clears credentials from memory. A compatibility-repair step preserves the Add project draft while updating or starting the target. Successful repair returns to the draft after a support check and never registers automatically. No stacked modals.

Once an operation starts, show its target, phase, recent bounded output and elapsed state in the right panel. Keep failure diagnostics visible with specific recovery controls. A retry repeats only an operation safe to retry under the existing controller. Do not offer Cancel unless the underlying operation supports cancellation; Esc must not suggest that it undoes submitted work.

On success, refresh observed state and show the result inline. Keep long-operation results until Done or navigation. Avoid a separate success popup. Health-check failures remain failures even when installation itself completed.

Restore focus to the invoking control on return. A completed setup may deliberately select the newly created environment or project. Explain that transition through the destination title.

## Terminal layout and keys

At ordinary widths keep both panes visible. At narrow widths use the existing sidebar/drawer pattern and keep the current environment/project in the content title. Avoid shrinking a form into a thin column or stretching a question across the whole terminal.

Scrollable panel content must keep its title, current state and available buttons reachable. If there is insufficient room to show an operation's target, impact and controls, require resize before confirmation. Preserve inputs and operation state through resize.

Lists stop at their first and last item; arrow keys never wrap around. This includes the inquirer `select` and `checkbox` prompts in one-shot commands, which pass `loop: false`.

Show key hints beside visible controls and a short context-specific footer. Use d, a and c for environment views and r and a for project tabs. Add shortcuts accelerate controls users can already find; they are never the only entry point. Terminal shortcuts stay out of the independently released web shortcuts dialog.

The mouse is a shortcut too. A click on a row, tab or button does what its key does, and the wheel scrolls what ↑/↓ scrolls. Never put an action behind a click alone. Make a new control clickable by wrapping it in `Clickable` from `dialog/` (or `useClick` from `mouse.ts` on an existing ref), and give a scrollable view `useWheel`. A click calls the same function as the key, so the two can't drift apart. While keys are locked, such as during a workflow, a pending action or an edit, clicks are locked too. `m` turns the mouse off so users can select text; keep its footer hint visible, and leave `m` to text inputs while one has focus. A click on a form field only moves focus; it never clears what was typed.

## Manual acceptance walkthrough

1. Empty installation: find Add environment without reading the footer, configure it, review once, cancel without side effects, then complete creation and find Add project.
2. Connected managed Docker target: find every supported service/container/maintenance action in one panel, with different effects explained.
3. Local socket target: see why managed operations do not apply while still finding supported service controls.
4. Unreachable target: identify the problem and next action from the right panel without using the footer. Stale data remains visibly stale.
5. Old incompatible target: enter Add project, repair through Update CLI, return with fields intact, and submit explicitly.
6. Project selection: find only project operations. Select a run to find Cancel run. Switching environments never retargets a prepared operation.
7. Update failure: inspect retained diagnostics, retry or return to saved logs, and never see false success.
8. Stop, removal, export and shell: check exact target/impact, one confirmation, return path and focus restoration.
9. Keyboard and small terminal: reach every control, type without triggering shortcuts, resize safely, back out without losing a draft unexpectedly.
10. Detach during maintenance: clearly distinguish leaving the TUI from stopping the environment or canceling the operation.

## Adoption and cost

Keep frontend-development.md, cli-tui.md and the playground reference aligned with these rules. The production terminal must be verified in addition to browser prototypes.

Implement in usable vertical slices: first coherent environment navigation, Actions and inline state; then creation and project setup in the panel with retained repair; then align remaining project/run/log interactions with the same rules. Each slice includes tests and a real-terminal walkthrough. Existing lifecycle controllers remain the operation owners.

Presentation changes reuse observed state and existing action adapters, without adding status polling per panel. Fetch fresh information explicitly where confirmation correctness requires it; report those calls and reconnect traffic when implementation is measured.


## Internet access and form actions

Environment creation explicitly offers Unrestricted or Restricted Internet access.
Explain research access beside the choice and show advanced allowlist settings only
for Restricted. Repeat the effective policy in review. Put related form buttons on
one horizontal row; support Left/Right between them and Tab across all controls.

Stop and Delete are lifecycle popup flows throughout confirmation, progress and result. Creation and update remain panel workflows. Show retained failed creations in the sidebar immediately; preflight failures before saving a record must not create ghost entries.
