# ADR 0004: Share Task Rank Between Table And Board

## Status

Accepted

## Context

Task Table and Board are two rendering modes for tasks in a selected List. Board
groups can represent status, assignee, priority, or task type, and users can drag
cards within and between groups. A Board could appear to need per-column ordering,
but a separate Board ordering model would diverge from the Table order and make
rank behavior harder to reason about.

## Decision

Table and Board share one List-scoped root-task rank. Board groups are a
projection over the selected List's task order, not separate rank containers.

Dragging a Board card within a group updates the same List rank used by Table.
Dragging a card between groups updates the active grouping field and the same
List rank from the drop position. Board rank planning uses the full loaded
root-task List order, not only the visible cards in a group.

## Consequences

Switching between Table and Board preserves the same manual order. Board does
not store a per-group or per-Board ordering model in v1. Future Board sorting or
view configuration must preserve the invariant that persisted manual order is
owned by the selected List rank unless a later ADR explicitly replaces that
model.

The v1 Board drag implementation follows this decision: in-group drops reuse
the same rank mutations as Table (`tasks.updateRank` / `tasks.batchUpdateRanks`),
and cross-group drops persist the grouping field and the shared List rank
together through one atomic `tasks.update` call.
