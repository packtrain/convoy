# Ink CLI Playground

Exploring [Ink](https://github.com/vadimdemedes/ink) - a React-based library for building interactive command-line applications.

## What is Ink?

Ink provides a React-like component model for building CLI tools. Instead of manually managing terminal output with escape codes, you write declarative React components that Ink renders to the terminal.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm ink-pg:dev

# Or run specific examples
pnpm ink-pg:dev counter
pnpm ink-pg:dev spinner
pnpm ink-pg:dev input
pnpm ink-pg:dev select
pnpm ink-pg:dev table
pnpm ink-pg:dev progress
```

## Examples

### Counter
Interactive counter demonstrating:
- `useState` for state management
- `useInput` hook for keyboard handling
- Box and Text components for layout

### Spinner
Loading spinner animation showing:
- Async operations with `useEffect`
- Third-party component (`ink-spinner`)
- Sequential step progression

### Text Input
Form input handling with:
- `ink-text-input` component
- Multi-field form flow
- Controlled input state

### Select
Menu navigation featuring:
- `ink-select-input` component
- Multi-step selection wizard
- Item highlighting and selection

### Table
Tabular data display with:
- Custom table rendering
- Column formatting
- Status indicators with colors

### Progress
Animated progress bars showing:
- Multiple concurrent progress indicators
- Custom progress bar component
- Color-coded progress states

## Key Ink Concepts

### Components
- `<Box>` - Flexbox container (like `<div>`)
- `<Text>` - Text output with color/style support
- `<Newline>` - Line break

### Hooks
- `useInput(callback)` - Handle keyboard input
- `useApp()` - Access app instance (for `exit()`)
- `useStdin()` - Raw stdin access
- `useFocus()` / `useFocusManager()` - Focus management

### Styling
```tsx
<Text color="green" bold>Success!</Text>
<Text backgroundColor="blue">Highlighted</Text>
<Box borderStyle="round" padding={1}>Boxed content</Box>
```

### Layout (Flexbox)
```tsx
<Box flexDirection="column" gap={1}>
  <Text>Row 1</Text>
  <Text>Row 2</Text>
</Box>
```

## Development

```bash
# Development with auto-reload
pnpm ink-pg:dev:watch

# Type check
cd playground/ink-pg && pnpm typecheck

# Build for production
pnpm ink-pg:build
```

## Resources

- [Ink Documentation](https://github.com/vadimdemedes/ink)
- [Ink UI Components](https://github.com/vadimdemedes/ink-ui)
- [Awesome Ink](https://github.com/sindresorhus/awesome-ink)
