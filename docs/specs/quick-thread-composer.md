# Quick Thread Composer (OS-2336)

Start a thread from any page without opening the new-thread page.

## Related Specs

- Shortcut table and guards: [keyboard-navigation.md](keyboard-navigation.md#shift--n-quick-thread)
- Draft persistence: [cli-thread-drafts.md](cli-thread-drafts.md)
- Full-page composer: [thread-groups.md](thread-groups.md) → Page structure

## Opening

- `Shift + N` opens the quick-thread dialog anywhere in the organization shell.
- The project is the current route's project, else the last project visited
  (the same rule as `G, T`). With no project, or without `CLI_THREAD` on it,
  the key does nothing.
- Ignored while a text field or the editor has focus, while focus is in a
  dialog, popover, menu or listbox (the task panel excepted), and with Cmd,
  Ctrl or Alt held.

## Composer

- The same new-thread composer as `/threads`: profile, working directory,
  agent, model, effort, mode, attachments and the task picker. The workflow
  picker is omitted.
- The draft lives under its own key, `quick`, in the project's draft storage.
  It doesn't share text with the `/threads` composer. Closing the dialog keeps
  the draft, and a successful send clears its text.
- Without a CLI profile the composer is disabled and links to the CLI setup docs.
- Opening focuses the message input, not the first pill, so typing starts
  right away. The dialog cancels Radix's open autofocus, and the composer
  (`autoFocus`) focuses its own editor each time it becomes editable, which is
  after profiles load.
- The editor takes focus through TipTap's `commands.focus`, one frame after
  mount. A DOM `.focus()` during mount is lost in development: React StrictMode
  detaches and re-attaches the editor's DOM, and Radix then moves focus to the
  dialog container.

## Sending

| Key | Result |
|-----|--------|
| `Enter` / send button | Creates the thread, closes the dialog, stays on the current page. A "Thread started" toast offers **Open**. |
| `Cmd/Ctrl + Enter` | Creates the thread, closes the dialog, navigates to the thread. |
| `Shift + Enter` | Inserts a newline. |

- The footer shows both send keys with `Kbd` hints.
- A failed create keeps the dialog open with its text; the shared submit
  pipeline shows the error toast.
- In other composers `Cmd/Ctrl + Enter` keeps sending like `Enter`.
