# Progressive Web App Appearance

This specification defines browser chrome and launch-surface colors for the
installed Convoy web app.

## Theme colors

- The document advertises theme colors for both system preferences:
  - light: `#ffffff`
  - dark: `#131313`
- These colors match the exact 8-bit sRGB values used by the app's large
  background surface. Installed-app browser chrome, including Android's status
  bar, must not contrast with the active Convoy theme.
- Once the app resolves its appearance setting (`light`, `dark`, or `system`),
  every document `theme-color` meta element is synchronized to that resolved
  theme. This lets an explicit in-app choice override the device preference and
  keeps browser chrome current when the setting changes at runtime.
- The manifest's light theme and background colors remain the fallback for
  user agents that do not support media-specific document theme colors.

## Verification

- Unit coverage verifies both light/dark viewport metadata and runtime
  synchronization of all `theme-color` meta elements.
- Device verification should install Convoy from Chrome on Android, select
  each appearance option, and confirm that the status bar matches the app
  before and after changing the theme.
