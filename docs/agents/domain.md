# Domain docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- Relevant ADRs under `docs/adr/`.
- Relevant behavior specifications under `docs/specs/`.

If a referenced document does not exist, proceed silently. Domain documentation is created or extended when terminology and decisions are actually resolved.

## File structure

Convoy uses a single-context layout even though it contains multiple applications:

```text
/
├── CONTEXT.md
├── docs/
│   ├── adr/
│   └── specs/
├── apps/
└── playground/
```

The root context describes shared product language across the web, CLI, desktop, and documentation applications. Do not introduce a `CONTEXT-MAP.md` or per-app context files unless the project deliberately adopts a multi-context model later.

## Use the glossary's vocabulary

When output names a domain concept—in a task title, proposal, specification, test, or implementation—use the term defined in `CONTEXT.md`.

Do not substitute terms listed under `_Avoid_`. If a required concept is absent, reconsider whether existing vocabulary already covers it; otherwise record the gap for domain-modeling work.

## Respect specifications

Before implementing a feature or behavior change:

1. Search `docs/specs/` for related specifications.
2. Follow the existing source of truth.
3. Update it when behavior, defaults, edge cases, or user-visible interactions change.
4. Create a specification when no related one exists.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
