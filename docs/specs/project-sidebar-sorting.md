# Project Sidebar Sorting Specification

Defines canonical ordering for projects returned by `api.projects.core.listByOrganization`, which drives the sidebar project list and organization landing redirect behavior.

## Overview

- Project ordering is backend-canonical and produced by `api.projects.core.listByOrganization`.
- Sidebar consumers must render projects in the returned order.
- Organization landing page `/o/<organizationSlug>` redirects to `projects[0]`, so redirect target follows this same canonical order.

## Sorting Rules

Projects are sorted using the following deterministic keys:

1. `name` using natural, case-insensitive comparison (`Intl.Collator` with `numeric: true`, `sensitivity: "base"`).
2. `alias` ascending.
3. `_id` ascending as a final deterministic tie-breaker.

Examples:

- `Alpha` comes before `project 2`.
- `project 2` comes before `Project 10`.
- If names compare equal case-insensitively, `A2` alias comes before `B2`.

## Scope and Non-Goals

- Scope:
  - `api.projects.core.listByOrganization` return ordering.
  - Sidebar project ordering via existing query consumers.
  - Org landing redirect target through existing `projects[0]` logic.
- Non-goals:
  - Pagination behavior changes.
  - Last-visited/default-project persistence logic.

## Acceptance Checklist

- `listByOrganization` returns projects in natural, case-insensitive name order.
- Sorting remains deterministic with alias and id tie-breakers.
- Permission-filtered results remain sorted after filtering.
- Sidebar displays projects in the order returned by query.
- `/o/<organizationSlug>` redirect follows the sorted first project.
