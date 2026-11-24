# App MDXEditor Playground Specification

This document defines the reusable MDX editor in `apps/web` and its playground demo route in the main web app.

## Scope

- Applies to `apps/web/components/mdx-editor/` and `apps/web/app/playground/mdx-editor/`.
- Covers the reusable editor kit plus the web-app playground demo route.
- Does not cover visual parity with the Tiptap UI.

## Project Shape

- Reusable editor code lives under `apps/web/components/mdx-editor/`.
- The editor kit remains self-contained within that folder, including any local UI primitives and its stylesheet.
- Playground-only preview/evaluation UI lives under `apps/web/app/playground/mdx-editor/`.
- The web-app playground shell consumes the shared editor but remains separate from it.

## Routes

- `/playground`
  - Acts as the main playground index for `apps/web`.
  - Links to `/playground/mdx-editor`.
- `/playground/mdx-editor`
  - Hosts the MDX editor playground.
- `/playground/mermaid-diagrams`
  - The shared editor with the artifact panel's props, seeded with one Mermaid diagram of each common type, an invalid diagram, and a plain code block.

## MDX Editor Demo

- The editor runs client-side only.
- The editor shell should clip the toolbar within the same rounded container so the top corners read as one surface rather than a rounded body plus a protruding top bar.
- The page uses a responsive split layout:
  - wide screens: editor left, preview/source right
  - narrow screens: stacked layout
- The editor is seeded with representative starter content.
- Editor state remains local to the playground page.
- Every edit updates:
  - the rendered preview
  - the raw MDX source panel
  - the table of contents surfaces
- The starter document includes a GitHub-flavored Markdown table so rich-text editing, rendered preview, and serialized source are exercised together.
- The playground can show a table of contents outside the editor surface:
  - it is derived from the current serialized markdown value
  - it lists markdown headings with indentation by depth
  - it decodes HTML character references left by editor serialization (e.g. a trailing space serialized as `&#x20;`) so entity residue never shows in ToC titles
  - it ignores headings inside fenced code blocks
  - it assigns stable hash IDs to rendered editor headings
  - long heading titles truncate with an ellipsis inside the panel width; they never overflow onto the editor content (applies to the side panel, the pinned sidebar, and the inline flyout)
  - each item exposes the full heading title as a native `title` tooltip on hover
  - clicking an item scrolls the matching rich-text heading into view
  - clicking an item updates the URL hash so the position can be copied
  - loading the playground with a matching URL hash scrolls directly to that heading
  - a clicked item remains highlighted while its smooth scroll settles, and that hold is released even if the document changes before it expires
  - the active item updates from editor scroll position using the last heading above the viewport threshold
  - it supports both page scrolling and an explicit inner scroll container
  - the playground includes a contained-scroll editor example that passes the scroll container ref
  - the extractor and table-of-contents components live in the reusable editor kit
- The reusable editor can show an inline floating table of contents inside the editor:
  - on mobile, the floating and pinned ToC are not rendered; a ToC button in the editor toolbar opens the headings in a bottom drawer instead
  - selecting a heading from the mobile drawer scrolls to it and closes the drawer
  - mobile artifact content does not reserve the extra left inset used to clear the desktop floating ToC
  - it appears as a marker rail inside the editor, vertically centered in the visible editor area (left by default, configurable per surface)
  - the rail positions absolutely within the editor root rather than fixed to the viewport, so it stays correct inside overlay surfaces with transformed ancestors (e.g. the task artifact panel)
  - it holds its place with CSS sticky rather than scroll-driven repositioning, so it never trails or wobbles behind the content while scrolling
  - every heading gets a marker so the rail maps the whole document; the spacing between markers tightens as headings pile up instead of dropping the tail
  - the editor content reserves right-side padding while the inline table of contents is enabled
  - hovering or focusing the marker rail expands a popover with heading labels
  - it uses the same heading extraction, active-section tracking, URL hash, and scroll-container behavior as the side panel
  - the playground enables the inline ToC on both the main editor and the contained-scroll editor
  - the flyout popover shows a pin button in its top-right corner
  - pinning hides the floating rail/flyout and shows the ToC as a persistent sidebar on the left side inside the editor, regardless of the inline ToC position
  - the pinned sidebar header shows the title and an unpin button (no icon) and tracks the rendered toolbar row height (measured at runtime) so their bottom borders align
  - the pinned sidebar spans the full editor height
  - the unpin button restores the floating rail/flyout
  - while pinned, the editor content does not reserve inline-ToC padding
  - the pinned state persists in `localStorage` as a single shared preference across editors
- The side-panel table of contents header shows only the title (no leading icon)

## Reusable Kit Boundary

- The reusable unit is the editor kit only, not the playground shell.
- The kit exports a single controlled editor component:
  - `MdxEditor`
  - props: `value`, `onChange`, optional `baselineMarkdown`, optional `className`, optional `theme`, optional `showDiffMode`, optional `density`, optional `contentPadding`, optional `contentWidth`, optional `disabled`, optional `inlineTableOfContents`
- The kit must not depend on:
  - `next/link`
  - preview rendering logic
  - demo copy or layout chrome
- Theme-specific MDXEditor and CodeMirror overrides belong in the kit stylesheet; shared theme tokens needed by the editor may be provided by app-global CSS.
- Rich-text spacing keeps a visible gap when a level 1-4 heading is immediately followed by a paragraph.
- Source and diff CodeMirror views use 16px editor text for readability.
- Compact rich-text density keeps compact content padding by default. Artifact editing surfaces opt into spacious `2.5rem` content padding through the editor `contentPadding` prop.
- `contentWidth="narrow"` caps the rich-text content at a centered `60rem` readable measure; source mode always fills the host. The default fills the host in both modes. Artifact surfaces drive this from a persisted header toggle.
- Rich-text import normalizes unsafe raw angle-bracket prose and prose colon-directive markers outside code so literal placeholders such as `<project role>` and command names such as `web:lint` remain visible as text instead of being parsed as MDX/JSX or unsupported directives. Autolinks are no exception: MDX has no autolink syntax, so `<https://example.com>` and `<person@example.com>` are escaped to text rather than left to fail the parse.
- Rich-text export removes editor-only angle-bracket and colon-directive escapes outside code before publishing changes, and decodes the HTML character references the serializer emits for prose (`&amp;`, `&lt;`, `&#x20;`) so `Logging & Audit Trail` is stored as typed. References inside code stay verbatim. Opening and saving unedited Markdown preserves raw angle-bracket placeholders and command names instead of storing escape sequences or HTML entities.
- Rich-text import preserves fenced code blocks as editable code blocks. Unsupported or unlabeled no-metadata fences fall back to plain-text code-block editing instead of failing the whole document.

## Capabilities

- The initial plugin set must support:
  - admonitions via directives
  - admonition insertion from the toolbar for `note`, `tip`, `info`, `caution`, and `danger`
  - headings
  - lists
  - blockquotes
  - thematic breaks / horizontal rules
  - GitHub-flavored Markdown tables, including cell editing, alignment serialization, row/column controls, and a toolbar insertion action
  - links
  - markdown shortcuts
  - source/diff mode
  - a basic formatting toolbar
- The toolbar mode switch is a single cycling button:
  - when `showDiffMode` is `true`, it cycles `rich-text -> diff -> source -> rich-text`
  - when `showDiffMode` is `false`, it cycles `rich-text -> source -> rich-text`
- Mermaid diagrams: see [Mermaid code blocks](#mermaid-code-blocks).
- When source or diff mode returns to rich text, the editor normalizes the current source markdown before MDXEditor re-imports it.

## Mermaid Code Blocks

- A ` ```mermaid ` fence renders as a diagram. `Mermaid` is in the code-block language picker, so switching an existing block to it renders the diagram at once.
- The markdown stays a plain fenced code block: saving, source/diff mode, and CLI/MCP reads see the fence unchanged.
- The source editor is hidden by default. The diagram's **Edit diagram source** button reveals it under the diagram and focuses it. The diagram re-renders as the source changes. When focus moves to another part of the editor, the source folds away again.
- While the source is mid-edit and fails to parse, the last good diagram stays and the parser message shows under it. A diagram that never parsed shows the message, the raw source, and the edit button.
- Rendering uses `mermaid` through `@streamdown/mermaid` (the instance chat uses), loaded lazily on the first diagram. `securityLevel: "strict"` sanitizes the SVG. The theme follows the app theme: `neutral` in light mode, `dark` in dark mode.
- Mermaid's `initialize` is global and persists across client navigation, so every renderer passes its theme on each render. Chat passes the same mapping through Streamdown's `mermaid.config`; without it, chat would draw with whatever theme the editor set last.

### Diagram viewer

- A toolbar in the diagram's top-right corner appears on hover or keyboard focus (always on touch devices): edit source, download, fullscreen, zoom out, zoom in, reset view. The buttons are the app's ghost `icon-sm` buttons with `TooltipExt` labels (see [Panel header icon buttons](../guidelines/frontend-development.md#panel-header-icon-buttons)), in a frame styled like the code block's language toolbar. The toolbar stays visible while its download popover is open.
- Inline, the diagram shows at natural size, scaled down to the content width. Diagrams taller than `40rem` clip at that height; drag to pan, zoom out, or open fullscreen to see the rest.
- Drag pans. The zoom buttons step by 1.25×, clamped to 0.25×–8×. Inline, ctrl/⌘+wheel (and trackpad pinch) zooms, and a plain wheel scrolls the page. Reset restores 1× with no offset.
- Fullscreen opens a dialog portaled to `<body>` (so transformed ancestors such as the artifact panel can't confine it). The diagram fits the screen, and any wheel zooms. Escape or the close button exits. Fullscreen has its own view state and the same download and zoom controls.
- Download opens a popover with three settings and a **Download** button: **Format** (PNG or SVG, default PNG), **Theme** (Light or Dark, default Light) and a **Transparent background** switch (default off). Settings persist while the diagram stays mounted. The file is saved as `diagram-<theme>.<format>`. The export theme ignores the site theme, so a dark-mode user still gets a light diagram for a document or slide unless they pick Dark.
- An export re-renders the diagram with `%%{init: {"theme": …}}%%` appended to its source. Mermaid applies a directive to that render only, inside its render queue, so the export never changes the global config the on-screen diagrams use. A directive the author wrote is overridden for the export. If the source is invalid mid-edit, the export fails with a toast.
- Unless transparent, the export gets the app's background for its theme (`#ffffff` light, `#131313` dark, matching `--background` in `app/globals.css`): a `background-color` on the SVG root, and a canvas fill for PNG. PNG renders at 2×, scaled down when a side would pass the browser's 16384px canvas limit. Both formats give the SVG pixel dimensions from its `viewBox` and re-serialize it as XML so `foreignObject` labels survive rasterizing.
- Read-only surfaces (`disabled`) block pointer events on the editor. The diagram viewport and toolbar opt back in, so viewers can pan, zoom, open fullscreen, and download. The edit button is hidden there.

## Preview Behavior

- Preview rendering is local and playground-only.
- Preview failures must not interrupt editing.
- When preview compilation fails, the page should show inline feedback while keeping the editor interactive.

## Boundaries

- No Convex or backend changes are part of this feature.
- Preview, raw source, and inspection-only UI remain playground-only behavior.
- Task-artifact integration uses the shared editor, but task-artifact preview is replaced with editor-first authoring rather than duplicating the playground's live-preview layout.
- Table support is not configurable: every consumer of the kit renders and edits tables, because every surface shows markdown authored elsewhere (skills, prompts, agents, artifacts) that may contain them.
