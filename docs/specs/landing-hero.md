# Landing hero

## HTML preview playground

Develop the replacement hero at `/playground/hero` in `apps/landing` before
changing the homepage. The route is a no-index review page with an isolated
`components/product-preview` module. Its public entry exports `HeroPreview`.
Use fictional Northstar project data consistently across selectable threads.

The preview follows the product's Inter font, dark theme, 256px navigation,
320px thread list, 56px header and 768px conversation width. Port presentation
from the current product source without importing auth, Convex or editors.
Users can select a thread and expand tool calls. The composer is read-only;
the demo cannot execute agents. No looping animation or network requests.
Below 1100px omit navigation; below 760px replace the list with a native thread
picker. Keep conversation text at a readable fixed size.

Validate the isolated rendering and interactions in a browser when possible.
The existing hero PNG is an older reference. A matching capture of the current
product is still required before declaring visual parity or moving the preview
onto the homepage. This playground is the first slice of OS-2079.

Reference sources in `apps/web`: `app/globals.css`, `app/layout.tsx`,
`components/ui/sidebar.tsx`, `lib/threads/constants.ts`, and the components in
`components/blocks/thread`: `thread-sidebar.tsx`, `compact-thread-row-content.tsx`,
`thread-header.tsx`, `thread-view/thread-message-list.tsx`, `thread-composer.tsx`
and `message-parts/tool-group-part.tsx`. Message padding follows
`components/ai-elements/message.tsx`. The preview intentionally omits app
mutations, resizing and context menus. Mobile layout is a marketing crop.

Run `pnpm --filter @convoy/landing test:hero` with Playwright Chromium and its
system libraries installed. The test bundles only the preview and opens a
temporary local HTML file; it does not start an app server. It covers thread
selection, keyboard disclosure, state reset, read-only composition, mobile
overflow and reduced-motion operation. Route integration and current-product
visual comparison are separate checks.

The supplied `CleanShot 2026-10-09 at 17.56.00.png` is the reference for the
second playground pass. Notifications use normal navigation contrast. The workspace links have no muted global Threads entry; Threads lives under each project. The
composer has the product's bordered context strip, workspace, local execution,
branch, sample cost and usage indicator. Model and mode selectors use 12px,
half-opacity chevrons, the OpenAI runtime icon and the Act pointer icon.
Task fixtures use the product's red Bug, purple Epic and green Feature icons.

A task sidebar follows the selected thread and shows metadata, read-only
description chrome, resource chips and subtasks. It opens by default on wide
desktop, with a close/reopen control. Below 1100px it opens over the right side
on demand and closes without changing the selected thread. The sidebar stays
inside the preview frame and scrolls independently. All mutations remain
disabled in this fictional example. The homepage remains unchanged.

## Source fidelity

Use the product SVG wordmark from `components/custom/logo/logo-text.tsx`.
Navigation reproduces the Connected CLIs, Pinned, Active and Done sections,
runtime SVGs, unread indicators, project Threads entry and collapsed projects.
Fixtures contain fifteen selectable threads. Section and project expansion is
local state only. Compact rows follow the product's 36px height and icon slots.

The shared preview composer follows `thread-composer.tsx`, `prompt-input.tsx`,
`input-group.tsx`, `button.tsx` and `context-window-meter.tsx`. Its context bar
is 45px tall, overlaps the input by 8px, and uses 28px controls. The meter is a
20px SVG ring with radius 7.5 and stroke 2.5, never a gauge or check icon.
The send button uses primary background and primary foreground, with the
full-opacity appearance shown in the supplied screenshot. It cannot submit.
Remove invented completion badges and demo footer text from inside the app.

Task Activity follows `task-timeline`: composer with task attachment, add-comment
row, artifact-update history and an avatar-attributed comment. It reuses the
same composer component as the conversation. Keep the activity below subtasks
in the independently scrollable task panel.

The reference crops are CleanShot captures at 18.10.04, 18.11.08 and 18.12.32
on 2026-10-09. Compare actual rendered navigation, composer and activity crops
against them. Passing interaction tests alone does not establish visual parity.

The landing hero in `apps/landing` introduces Convoy as a shared way for teams
to make their work with AI repeatable.

There is no Get started action. The header, hero and closing CTA each have one
GitHub button with the GitHub mark, and no star count appears anywhere. The
hero button says Open source; the header and CTA buttons say View on GitHub.
Each button is a glass pill: a fully rounded, translucent white fill
with a thin light border and backdrop blur. The hero and CTA buttons end in an
arrow that nudges right on hover; the smaller header button has no arrow.

The headline uses two lines at every screen size: "Your best way of" above
"working with AI." Only working alternates with building; the period
stays after AI. Fixed font sizes at responsive breakpoints keep all lines within
320px screens. The words roll up letter by letter in a pure-CSS eight-second
loop, holding each for about three seconds. Working is blue `#09a7de` and
building is amber `#f5a524`. The slot reserves the widest word's width and
clips the roll without changing line height. A letter that leaves the top jumps
back below the slot in a single step, so no frame shows it crossing the slot.
Reduced motion uses a short fade
without movement or letter stagger. Screen readers get the stable headline
"Your best way of working with AI." The halftone background keeps its own colours.

The supporting copy reads "Turn your team's expertise into reusable workflows
for AI agents. Assign tasks, guide the work, and review results in one place."

The headline and description precede the hero's button. A process
strip sits between that button and the product screenshot. The three steps are:

| Title | Description |
| --- | --- |
| Build your process | Turn your team's expertise into reusable workflows. |
| Share your workflows | Let teammates reuse the workflows you've saved. |
| Make it better | Bring what you learn into the next run. |

The strip uses three equal columns from the `md` breakpoint and a vertical
stack on smaller screens. Muted descriptions and thin dividers match the
existing hero palette. It is a semantic ordered list without visible numbers.
The steps are static content.

The process titles do not also appear as a standalone slogan below the hero
description. The screenshot retains its overlap with the following section.
The hero fills at least the initial viewport below the 62px header, using
`min-height: calc(100svh - 62px)`. The process strip and screenshot have a fixed
28px gap. On taller screens, extra space goes above the hero content so the
screenshot still overlaps the hero boundary. On shorter screens,
content can grow the hero beyond the viewport. The dark area beside the
screenshot appears only after scrolling past that boundary.

The animated background ends at the hero section boundary. The screenshot
extends below that edge onto the solid dark background by 140px on mobile,
220px from `sm`, and 300px from `lg`. Clip only the animation, not the image.

## Product content

The first product section is titled "Your team's software factory". Its
introduction reads "Turn your team's expertise into a shared process for
building software with AI. Bring agents, skills, and workflows together so
teammates can put that process to work and improve it across projects."

The sections below the hero describe implemented capabilities with concrete
examples. Use "coding agent" when asking visitors to choose a tool, and explain
runtime-dependent controls in the feature index. The shared-workflow step says
"Let teammates reuse the workflows you've saved."

The workflow card reads "Turn a proven process into a repeatable workflow".
Its paragraph reads "Define how work moves from planning to review, with agent
instructions, automated checks, and human approvals along the way. Save the
workflow so your team can use it on the next task."

The Skills card reads "Stop making every team start from scratch". Its paragraph
reads "Turn what works for your most successful teams into a way of working
others can adopt. Share agents, skills, and workflows that cover how you plan,
build, test, and review software with AI. Give teams a proven starting point
they can adapt and improve together." Workflows here include the team's broader
AI software development process, not only saved workflow runs.

The coding-agent introduction reads "Use Claude Code, Codex, OpenCode, Cursor, or
Antigravity with your team's workflows. Agents run on your connected machines. Follow their
work and review results in Convoy's web UI." The feature index retains the runtime
differences in steering and approvals. Below it, the logo wall shows the five runtimes in
`app/cli-logos.tsx`: two columns with the fifth cell spanning the last row on
screens below the `lg` breakpoint, one row of five from `lg`.

The closing CTA reads "Build your team's way of working with AI." Its supporting
paragraph reads "Start with one workflow. Give your team a process they can reuse
and improve."

The site title reads "Convoy | The open-source software factory for AI coding agents". The
metadata description reads "Run Claude Code, Codex, OpenCode, Cursor and
Antigravity from one web UI. Share agents, skills and workflows across your team,
assign tasks and review results." Why these words:
[landing-seo.md](landing-seo.md#search-terms).

The phone card body reads "Your agent works on your code on a computer or server
you connect to Convoy. Control it remotely from your phone's browser: see what
the agent has done, answer its questions or ask for changes." The "Run Convoy
yourself" paragraph opens "Self-host Convoy's web app and backend on your own
infrastructure."

The Watch Tower heading says "See which agents need your attention." The
organization heading says "Keep tasks, files and pull requests together."

The feature cards cover:

- Saved workflows with stages, parallel lanes, agent prompts, Bash checks,
  human approvals, and retry or skip controls.
- Skills for reusable procedures, agent instructions for ongoing responsibilities,
  and slash commands for reusable messages. Organization Skills and agent
  templates install as project copies that can be adapted independently.
- Watch Tower for the user's runs across projects in an organization, with
  List and Board views and batch triage.
- Artifact review: an agent writes a plan, a teammate comments on a passage,
  and the agent revises it. Inline comments apply to Markdown; HTML artifacts
  provide rendered reports and interactive outputs.
- Related threads in groups and optional read-only sharing with project
  teammates who have thread access.
- Coding agents working on a connected computer or server, with progress and
  replies available in a phone browser. The remote-thread card leads with this
  use case and leaves Git worktree details to the dedicated feature copy.

The task section uses "Assign a task to an agent" without promising execution
on assignment. It also describes Lists, subtasks, Board and Table views,
priorities, comments, attachments, related pull requests and task artifacts.
Workflows are available content, without a coming-soon label. The feature
index includes dedicated Skills, reusable agents, thread groups, thread sharing
and artifact-comment entries.

Worktrees are an optional feature for keeping a thread's changes apart from
its main checkout. Copy must not promise a worktree per parallel thread or
collision-free work. Thread copy must not promise universal team access or
permanent retention. Supported runtimes are named, with steering and approval
options dependent on the runtime.

Self-hosting means running Convoy's web app and backend on the user's own
infrastructure. Do not advertise a magic installation script, a one-command
setup or a guarantee that code never reaches external servers.

Supporting screenshots remain labeled stubs until a separate screenshot task.
Use the shared ScreenshotPlaceholder component with a title and description
of the intended capture. Do not load stock photos. The existing hero screenshot
remains in place. The self-hosting section also uses a stub instead of a typed
installer command.

Content regression checks: `node --test apps/landing/lib/copy.test.mjs` on Node
22.18 or newer, which can load the TypeScript copy module directly.

Assistant result lists use the product Markdown renderer's ordinary disc
bullets, inside positioning and 20px left padding. Do not render these as
green check icons or a separate completion-status widget.

Activity composer corrections: keep an 8px gap before Add comment, with the product trigger’s 4px vertical padding and 10px icon gap. The short Local Dev fixture uses intrinsic width to avoid empty space in the sidebar strip. Composer focus follows prompt-input.tsx: a neutral ring-color border, no textarea outline or outer halo. Other keyboard controls use a neutral focus outline.


## Workflow section playground

OS-2080 develops the workflow visual at `/playground/workflows` before homepage
replacement. Render a focused Stage × Lane grid using `workflow-grid.tsx` and
`workflow-wait-card.tsx` as presentation references. The stage column takes
the frame's spare width, at least 160px, so both lanes fit the homepage frame
with no blank strip after them. Keep 320px lanes, 12px cell padding, 8px card corners and 14px prompt text.
The Engineering lane carries implementation, human review and a Bash check;
the parallel Review lane contains two independent review prompts in Verify.
No wait is the first step of a lane. Do not draw an invented node graph or
suggest that parallel reviews wait for the Bash check within the same stage.

The marketing frame adds background, inset and a bottom fade over empty grid
space. Narrow marketing frames crop out the stage column and scroll the two lanes horizontally at the same readable scale; accessible row labels remain. The unframed view preserves the stage column. A native
disclosure shows the same grid without framing for inspection. All content is
static server-rendered HTML, with no APIs, run simulation or editable controls.
Use existing runtime artwork. The landing workflow stub stays until review.

The landing app's `/playground` index links to the hero, workflow, and Skills/agents previews
with descriptive cards. It is server-rendered and excluded from indexing,
matching the individual playground pages.


## Skills and agents playground

OS-2081 renders `/playground/skills-agents`, linked from the playground index.
Two separate frames show `/review-webhooks` from SkillReadonlyDetail and a
project agent configuration crop from AgentForm. The Skill is a reusable review
procedure with a supporting file; the agent has an ongoing review responsibility
and an instruction to use that Skill. Do not invent Skill binding controls.

Use the actual Agent name, Description and Content labels, editor typography,
Skill heading and Files row. The agent frame includes Category and crops out the form’s
save/cancel actions. Its toolbar is a clipped static excerpt of the compact
MDX toolbar. No editing or file-opening behavior is offered. Preserve readable
16px document text. At narrow widths stack the frames, Skill first. The outer
frames, offset and shadow are marketing composition, not a combined app screen.
No backend queries, editor dependency or agent execution. Homepage wiring waits
for review. Compare source markup and desktop/mobile renders before delivery.

## Watch Tower playground

OS-2082 adds `/playground/watch-tower` and a Watch Tower destination to the
hero. Both use the same list rows, board cards and fictional fixtures. Threads
remain the initial hero view. Sidebar Watch Tower defaults to the full Board; its
View settings dropdown switches List/Board and hides sections. Returning to
Threads preserves selection; opening a run selects its matching transcript.
View preference survives local navigation. No live queries or mutations run.

The dedicated scene omits Running and Done, keeping Waiting for your input,
Failed and Needs your review in product order. It is a 500px scrollable crop
with no bottom border; a mask fades its last 120px into the page, like the
workflow and project cards, and stays fixed while the crop scrolls. It keeps
source text sizes, 1024px list maximum, 24px section gaps, 320px board
columns and 40px column headers. Narrow containers hide redundant list columns
and scroll board columns without shrinking text. Frames and headings outside
the application are marketing composition. At widths where the hero sidebar
is hidden, preview navigation sits outside the application frame. It is an
inspection control, not a replica of the product's mobile bottom navigation.

Fixtures include Northstar, Documentation and Website. Waiting/failed/running
transcripts describe their actual state. The dedicated scene has static rows;
hero rows open local conversations. Homepage wiring remains a separate review
step. The shared module lives under product-preview/watch-tower; the hero and
playground route import its index. Bulk mutations and task navigation are not
part of this preview.

Watch Tower task glyphs retain the task-type colors in both list and board.
Board card SVGs use the product’s 70% saturation. Each board column header
has an 8px status dot with an 8px gap before its label: blue for Running and
Needs your review, amber for Waiting for your input, red for Failed, and
emerald for Done. Header dots are filled circles, not the card status glyphs.

## Artifact review playground

OS-2083 adds /playground/artifact-review and an index link. The isolated
product-preview/artifact-review module exports ArtifactReviewPreview.
The scene crops a Markdown implementation plan and its 288px comments rail,
using task-artifact-panel, artifact-comments-rail, artifact-comment-thread,
comment-overlay and MdxEditor as references. A fictional webhook retry policy
has one anchored comment and one reply. The rail starts open. Its header toggle
hides/shows comments; activating the highlighted passage opens them.

The document keeps 16px text, source heading sizes and 40px desktop padding.
Comments retain 14px bodies, 24px avatars, 12px thread padding and a 32px
body indent. Highlight colors derive from the product dark highlight token.
Below 700px container width, comments stack below the document and document
padding becomes 24px. This deliberate marketing reflow keeps text readable.
The crop omits the editing toolbar, filter, resize handles and mutation controls.
There is no editor, submission, product request or agent execution. Static
HTML includes the document and feedback. Neutral keyboard outlines and no
animation support keyboard use and reduced motion. Homepage wiring is separate.
Live product screenshot comparison remains required before claiming parity.

## Task artifacts playground

OS-2088 adds /playground/task-artifacts and an index link. The isolated
product-preview/task-artifacts module exports TaskArtifactsPreview. Where the
artifact review scene shows feedback on one passage, this scene shows how a
task organizes its outputs. A 320px task column holds the reference, title and
Resources: two Markdown artifacts and one HTML report, then the dashed create
control. Every pill is clickable; the crop shows no file attachments. The
selected document opens beside it.

Source references are task-artifacts-section, Pill and task-artifact-panel.
Pills keep the 28px height, 220px cap, md/html badge and selected border. The
panel keeps the 41px header and the artifact review document typography. HTML
artifacts show "HTML" where Markdown shows the save status.

Pills are buttons with aria-pressed; selection switches the document locally.
The create control and header actions are display-only. Below
700px container width the document stacks below the resources, its padding
becomes 24px and only the close action remains. There is no editor, product
request or agent execution. Static HTML includes the plan. No animation is
used. Live product screenshot comparison remains required before claiming
parity. Homepage wiring is separate.

## Thread groups playground

OS-2084 adds /playground/thread-groups and an index link. The isolated
thread-groups module exports ThreadGroupsPreview. Following the user's
CleanShot 2026-10-09 at 23.41.18 reference, one container has three thread tabs
directly at the top, a 56px strip, active underline and trailing plus.
Each tab leads with its attached task: NS-142 is a red Bug, NS-145 a green
Feature and NS-146 a slate Task. References use a 14px type glyph,
6px gap and 12px medium monospace reference, following ThreadTaskRefLink
and TaskRefWithType. The reference is display-only in this crop.
There is no separate group title header, sharing card, Read-only badge or
stopped-status dot. Sharing presentation is deferred.

The three fictional webhook conversations switch locally using pointer or
Arrow/Home/End keys. Conversation text is 14px and the existing PreviewComposer
sits below it. The plus is a static icon; the composer remains display-only.
Narrow containers scroll the tabs without shrinking their text or showing a
scrollbar. Composer
control padding drops to 4px below 500px so the send button stays inside
the smaller crop. No mutations,
network requests, clipboard writes or agent execution occur. The scene is a
shortened crop of the screenshot's tall conversation area. Homepage wiring
stays separate.


## Agent threads preview

`/playground/agent-threads` and the homepage card "Let agents work together",
placed after thread groups, show agents starting threads for other agents
(MCP `create_thread`) and messaging them (`send_thread_message`). The isolated
`product-preview/agent-threads` module exports `AgentThreadsPreview`.

One thread sits in the centre: NS-142, a person's request, two "Started thread"
tool rows, then messages from the Planner and Reviewer threads with the lead
agent's replies between them. Those messages follow
`cli-thread-agent-sent-messages.md`: the `--thread-message-foreign` tint
(#1b2431) and an icon-only `CornerDownLeft` badge in the footer, with no sender
name. The person's message keeps the secondary background.

Four fictional agent threads surround it: Planner and Docs Writer on the left,
Reviewer and Tester on the right. Each box shows the agent, its thread title,
a status and a runtime icon. From an 800px container a 32px line joins each box
to the thread, with a highlight travelling toward the thread that stops under
reduced motion. Below 800px the thread comes first and the agents follow in a
two-column grid without lines. The scene is static: no controls, network
requests or JavaScript state.

`node --test components/product-preview/agent-threads-preview.test.mjs` in
`apps/landing` covers the layout on both sides, line geometry, the foreign
message styling, the narrow layout at 320–780px, reduced motion and no network
requests. The homepage test checks the side layout at 1560px.

## Remote thread playground

OS-2085 adds `/playground/remote-thread` and a playground index entry. The
`remote-thread` module exports only `RemoteThreadPreview`. A 390px-wide,
740px-tall portrait frame shows the mobile web conversation at normal text
size. The frame narrows to its host; the transcript scrolls independently.
The rounded outer frame is marketing decoration, not product chrome.

Use the mobile 56px header with back control, task reference, title, add-thread
and overflow actions. Conversations have no global bottom navigation. Reuse
the reviewed composer, including machine context and usage ring. Below 360px
reduce static control padding to keep the send button visible. This compact
padding is a deliberate preview accommodation. Below 320px use the product's
compact icon-only mode selector. Preserve 14px message text.

The fictional webhook-retry conversation is settled. A native tool disclosure
reveals a command and three passing tests; no scripts, requests or timers
drive the interaction. Header controls and composer are display-only. Source
references are `thread-header.tsx`, `thread-mobile-back-button.tsx`,
`thread-workspace.tsx`, `thread-composer.tsx`, `message.tsx`, and
`collapsible-tool-part.tsx`. The output body is a shortened marketing crop.

Keep homepage integration deferred. Compare the rendered preview at phone
width with product source, document any lack of a live mobile reference, and
do not claim full visual parity without that reference.


## Task assignment playground

OS-2086 adds `/playground/task-assignment` and an index card. The isolated
`task-assignment` module exports `TaskAssignmentPreview`. Render a task metadata
crop with reference, title, List, Type, Status, Priority and Assignee. Continue
with Threads, Due date, Tags and Created, then Description. The picker stays
open, since it is what the section is about, showing Unassigned, AI Agents and
People in product order. In frames 760px and wider the card steps left under a
dark gradient overlay; only the Assignee row stays above it. The picker, 300px
wide, sits to the right overlapping the card's edge, centred on the card. Its
roster of four agents and four people shows without scrolling. Narrower frames place the 256px picker in flow below Assignee
so it never covers later fields. Initial load does not steal focus; the trigger
focuses the picker's search field.

Filter fictional names locally. Selecting an agent preserves the human owner;
selecting the current agent or Clear delegation clears only delegation. Selecting
Unassigned clears the owner only. Render overlapping avatars and executor-first
text when both are present. Each selection clears the search and leaves the picker open. Arrow keys cycle
through search and options; Enter or Space activates an option. Escape returns
focus to the trigger. Add/invite controls are display-only.
No API calls, task-status changes or agent execution occur.

Source references: task-detail-metadata.tsx, assignee-selector.tsx, AgentAvatar,
SearchablePicker and DropdownSearchInput. Preserve 20px avatars, 14px menu
text and 12px group labels. Clamp the menu within the crop at narrow widths.
The initial open menu remains meaningful in server-rendered HTML. Homepage
integration waits for review; record source-comparison limits when a current
product capture cannot be obtained.

Assignment preview spacing follows the shared 16px metadata gap, including
the space after Threads. The picker has 4px padding below its search divider.
Threads contains two fictional working rows with the compact product layout,
Codex/Claude icons, relative time and the 3×4 pixel snake loader. This is
fixture activity, independent of assignment selection. CSS animates only the
loader pixels; reduced motion freezes them. Titles truncate within narrow
metadata columns. No threads run or navigate.

Thread rows share one width so runtime icons and timestamps align vertically.
The add-thread control sits outside the list at its top right, reserving the
same space beside every row, including narrow crops.

## Project organization playground

OS-2087 adds one shared `ProjectOrganizationPreview` module, mounted in the
hero through the Northstar project and Milestone 1 navigation, and at
`/playground/project-organization`. Compact hero navigation also exposes it.
The hero still starts in Threads; Watch Tower retains its Board default.
Project views start in Table and provide a local Kanban toggle and search. The
homepage "Keep tasks, files and pull requests together" section opens on the Kanban board
instead, through `initialMode="board"`.

Six top-level Northstar tasks reuse hero identities. The delivery plan has
two expandable subtasks. Table columns show Task, Status, Runs, Priority and
Assignee. Kanban groups top-level tasks by status; subtasks stay in task details. Cards
follow product KanbanCard, rather than Watch Tower thread cards. Colored type
icons, status dots, owner avatars and subtask counts retain product geometry.

Task selection opens a right detail overlay with matching metadata,
description, resources and subtasks. Close and Escape restore trigger focus.
The underlying preview is inert while details are open. The preview contains
no editing, drag/drop, agent execution or product API calls. Search and view
switching are local; useful task content exists in initial HTML.

Source references are task-table, KanbanCard, kanban-board, task-detail-sidebar
and task-sidebar-overlay. Keep 14px task text, 12px metadata, 40px table header,
44px rows, 320px Kanban columns and a 41px detail header. The scene deliberately
crops optional table columns and app navigation. On narrow hosts the toolbar
wraps, table/board scroll horizontally, and details occupy the preview width.
No animation is needed. Standalone crop height is 560px; hero fills its frame.
Homepage integration remains separate. Document source-rendered comparison
limits when the live product is unavailable; do not claim live parity.

Project preview search keeps its rounded field border when focused, without an
inner outline or focus shadow. Buttons and the scroll region retain their
keyboard focus outlines. This applies to both hero and dedicated hosts.

Project task details reuse the existing `TaskSidebar` from the hero thread
preview. The project variant changes only the header, omitting workspace tabs
and putting Close in the action strip. Optional task data supplies status,
priority, owner, description, parent and subtasks. Metadata spacing, description
editor, resource chips, Activity and its composer share one implementation.
The project overlay is 420px wide, clamped to its host. Tab stays within the
open details; Escape and Close restore focus to the selected task.

Shared sidebar Parent fields keep their type icon and reference together on one
20px line, with a truncated title capped at 200px. Labels center against values.
Type and Status pills use the product badge geometry: 12px medium text, 16px
line height, 2px vertical and 6px horizontal padding, and 6px icon gap.

Project table Runs and Priority cell contents are horizontally centered,
including empty run dashes. Their headers retain product left alignment.

Project table assignees show their full name beside the avatar, with an 8px
gap, 16px cell padding and 12px muted text. Names truncate within the column.
All landing preview avatars show only the uppercase first letter of the name,
including assignment choices, project cards and artifact-review authors.

All five Northstar lists in the hero are clickable: Backlog, Inbox, Milestone 1,
Milestone 2 and Ideas. The new lists each contain eight fixture tasks; Milestone 1
retains its existing tasks. List selection updates its active marker, toolbar
identity and task metadata. Switching lists resets search/details and preserves
the hero Table/Kanban mode. Dedicated project preview defaults to Milestone 1.

The toolbar List pill and the task details List field are dropdown triggers,
like the product List selector. They show the List dot and name with no
chevron. The toolbar pill uses the product trigger geometry: 28px tall like the
view toggle buttons, fully rounded, 8px left and 12px right padding, an 8px gap,
a 14px dot and 14px medium text. Both open one shared `ListPicker` menu that follows the product
picker: a bordered "Search lists..." field, Backlog and Archived, a divider,
then Inbox, Milestone 1, Milestone 2, Milestone 3, Desktop App, Ideas,
Refactoring, References and Followups. Those rows scroll in a 17rem viewport
with half of the last row showing. The current List is marked by a row
highlight, not a checkmark. Search filters the rows. The menu is a mock.
Picking a List, pressing Escape or clicking outside closes it without changing
the List; the sidebar navigation still switches Lists in the hero. The menu
aligns to the trigger's right edge so it stays inside the preview at 320px.

Milestone 1 has nine top-level tasks and two subtasks, enough rows to run
under the homepage frame's fade. Backlog, Inbox, Milestone 2 and Ideas each have eight top-level tasks with
varied task types, owners, priorities and statuses. Working/review tasks include
runtime indicators. Each task has its own description for the detail sidebar.

## Self-hosting diagram

OS-2089 replaces the self-hosting stub with an explanatory architecture
diagram. No product screen shows that an instance is self-hosted, so this is
not a product crop or a dashboard. The isolated `product-preview/self-hosting`
module exports `SelfHostingPreview`; `/playground/self-hosting` shows it in
the homepage section layout and the playground index links to it.

Three tiers, top to bottom: Your team in the browser; a dashed Your
infrastructure boundary holding the Web app and Convex backend; three
fictional machines with runtime icons. A `convoy connect` connector labelled
"outbound connection" joins the machines to the boundary, matching the CLI's
Convex client. Services follow `self-hosted/docker-compose.yml`; the Convex
dashboard is omitted. Below the machines, a line from each one meets a shared line that
drops into a row of model providers: Anthropic, OpenAI, Amazon Bedrock and
Google Vertex AI, labelled "model API calls". Each card shows the provider's
monochrome mark and wordmark from Lobehub Icons (MIT), named for screen readers,
and no other text. Agents call whichever provider
their runtime is configured for, so the diagram does not imply an air-gapped
stack. No install script, Docker command or
`start.sh` appears.

Static server-rendered HTML in the landing register: square corners, hairline
borders, monospace labels. There are no controls and no JavaScript. A CSS
highlight travels along the two connectors and is removed under reduced
motion. The services sit side by side from 480px container width and stack
below it. Machines use three columns from 480px and compact one-line rows
below. Homepage wiring replaces the `ScreenshotPlaceholder` after review.

`node --test components/product-preview/self-hosting-preview.test.mjs` in
`apps/landing` covers the boundary, machines, provider fan-out, absence of
installer commands, overflow at 320–1000px, layout switch, reduced motion and
no network requests.

## Homepage integration, OS-1753

All eleven reviewed previews now replace the hero PNG and feature stubs on `/`.
This supersedes the playground-only restrictions in earlier implementation notes.
The playground routes remain available for isolated review. The homepage imports
these same components, including the completed task-artifact and self-hosting
scenes, rather than maintaining a second implementation.

Product scenes inherit Inter and Geist Mono variables. Marketing copy retains
Manrope. The hero has a 1760px outer limit and a 960px desktop frame, with its
existing 780px mobile conversation. It remains interactive and overhangs the
halftone animation by 240px (120px below lg). A spacer of the same height
pushes the next section down, so the frame never covers it. No downscaling of product text is used. Feature rows give 320px to
copy and the remaining width to the preview; narrow screens stack them. Copy
sits at the top of its column. Task assignment has copy on the left, task
artifacts on the right. Project organization puts its copy above a full-width
preview, since the table needs the width. "Run Convoy yourself" sits above the
feature index, its copy at the top of a 320px left column, like the platform rows, and the diagram on the right. The agents
heading breaks after "Your process."
Project organization has a 520px frame for Table, Board and its task sidebar.
It has no bottom border and fades into the page over its last 120px.
Other scenes retain their reviewed native crops and local interactions.

Feature cards no longer pin over one another: visitors can scroll and operate
the taller interactive scenes without later cards covering their controls.
Each card puts its title above the body text in the copy column, matching the
platform rows; there is no separate title bar. The copy sits at the top of its column
and scrolls with the card.

The remote-thread card places a dimmed, blurred desktop app behind the phone so
the scene reads as "laptop and phone". It reuses `HeroPreview` at 1440×900 (a
16:10 laptop screen) scaled to half size, inert and hidden from assistive
technology. It is shorter than the phone and is omitted when the frame is
narrower than 600px.
No live product requests or actual agent execution are introduced. Verify all
slots on the assembled homepage, responsive overflow, hero navigation and
independent scene interactions. Repository links, metadata and crawler files
follow [landing-seo.md](landing-seo.md).


## Environment management preview

Immediately before "Run Convoy yourself", a section titled "Manage where your
agents run." introduces `convoy tui`. Copy describes local and Docker
environments, connected projects, service status and keyboard shortcuts. The
feature index includes Environment management under Open & extensible.

The isolated `product-preview/environments` module exports only
`EnvironmentsPreview`; the homepage import and section mount are its wiring
points. It recreates the CLI 0.138 environment Details screen (OS-2316) in
server-rendered HTML/CSS. Preserve the charcoal sidebar, blue selected row,
monospace text and bottom shortcut/status bars. Follow the TUI layout in
[cli-tui.md](cli-tui.md): client and service versions in the header, a 30-column
sidebar whose environment rows right-align transport and status dot, Actions,
Credentials and Add project as rows under the expanded environment, and a
"Details" title with the host lifecycle note and `[s]`/`[f]`/`[+]` toolbar.
Detail lines copy the TUI's `detailLines` labels and muted text up to the first
colon; lines too long for the pane end in an ellipsis. Use fictional sandbox,
Web app and API fixtures; omit long identifiers (epoch, project IDs) and
project notices. This is a static preview: labels are text, with no simulated
commands or network requests.

Copy occupies the 320px right column and stacks above the preview on
small screens. The terminal keeps readable 12px text and a 760px minimum width
inside a keyboard-focusable horizontal scroll region. It must not widen the
page. No animation or client JavaScript is required.

The selected environment highlight spans the full sidebar width. Its 8px
horizontal padding aligns its chevron with the unselected Local row.
The status bar has 6px vertical padding and unit line-height. Its labels trim
font space above capitals and below the baseline with `text-box`, keeping the
visible text vertically balanced. The inline `convoy tui` in marketing
copy inherits its paragraph font; the standalone command and terminal retain
monospace typography.


## Checks and evidence, OS-2315

A section after task artifacts and before environments introduces Checks with
"See what passed. Inspect the proof." Copy explains checklists, reported
results, evidence, and rerunning pending/failed checks. Product overview and
the feature index include checks as shipped functionality.

The isolated `product-preview/checks` folder exports `ChecksPreview` and
`TaskChecksPreview`. The homepage and shared task sidebar are its wiring points.
The compact Checks section sits before Subtasks in hero and project scenes.

The Checks scene follows the user's CleanShot 2026-11-09 at 21.34.30 reference:
Changes, Tasks, Checks and a task tab with icons; one Checks heading with a
help link, 3/6 count and Run checks; six rows with leading status glyphs,
an Added badge only on Mobile layout, report times and trailing chevrons.
Mobile layout appears last, after the checklist checks.
Labels stay on one line, truncate with an ellipsis, and expose the complete
label through a title on hover. Other files has a timestamp
and a file card. No context header, "Interactive demo" label or instructional
card. Notes and text evidence expand locally. The collapsed initial state
matches the supplied reference. Warnings count as passed.

A clipped thread sits on the left of the Checks panel, using the existing
thread styles and composer. It fades into the landing's black background and
is inert and hidden from assistive technology. The desktop Checks sidebar
is capped at 480px; the thread crop fills the remaining scene width. At narrow widths, omit the
crop so the panel keeps readable text. Run checks contains both request scopes,
a separator, a Switch checklist label and direct choices for No checks, Bug fix,
Chore, Feature and Investigation. Feature shows Default; the selected choice
has a checkmark. Arrow keys and Home/End move focus, Escape closes the menu,
and selecting a choice returns focus to Run checks. Pending and failed and All checks only dismiss the menu and restore focus.
They do not add text, change results or send requests.
Reported results remain when switching checklists; unanswered checks outside
the chosen checklist disappear. No backend subscriptions or requests.

The sections following task artifacts alternate: Checks copy left,
environments copy right, self-hosting copy left. Mobile keeps copy above the
preview. The full-width project view remains unchanged.

Verify native disclosures and keyboard access, menu Escape and focus return,
result preservation, both request scopes, the reference row structure, and
320px/390px layouts without page overflow. Check section geometry in the
assembled homepage. Product behavior remains defined in [task-checks.md](task-checks.md).

## Pull request reviews, OS-2382

A section after Checks and before environments introduces pull request
reviews under a "Guided reviews" label with "Review pull requests chapter by
chapter." The copy sits above a full-width preview. It explains how chapters and notes help reviewers follow changes across files
and how reviewers can pick up where they left off. The feature index lists GitHub pull requests as shipped, replacing the
"Git-forge integration" /soon entry, and gives Guided reviews its own entry
under Documents & review.

The isolated `product-preview/pull-request` folder exports
`PullRequestPreview`. The homepage section and `/playground/pull-request` are
its wiring points. `PreviewComposer` accepts an optional chip icon so the
Activity composer shows a pull request chip.

The scene follows the user's CleanShot 2026-11-19 at 18.40.09 and 18.40.24
references. The header has the PR title, Merge status, Submit review with a
count, and icon actions. Overview, Guide and Diff tabs switch locally; the scene opens on Guide. The
right side of the tab row shows `main → sha` on Overview and Diff, and the
Guide's model, sha and age on Guide.

Overview shows the title with its number, author and branches, the
description, a Pull request checks card with four expandable check rows (one
Outdated badge), GitHub checks and Commits cards that expand to their lists,
and Activity: the embedded composer, Add comment, a comment, a thread group,
a commit and an approval. A sidebar lists Status, Threads, Tasks, Reviewers,
Assignees and Branch. Below 940px the sidebar is hidden.

Guide shows two chapters, each with numbered notes (summary, optional Product
callout, file rows with per-file notes, optional question) beside that
chapter's diffs. Diff lists every file's diff. Each file header has a
disclosure, path, +/- counts and a Reviewed checkbox. Reviewed marks are shared
between Guide and Diff, and the Guide's file row shows a check. Below 760px
notes stack above diffs. Code lines scroll inside their block; the page never
overflows at 320px or 390px. No requests or backend state.
