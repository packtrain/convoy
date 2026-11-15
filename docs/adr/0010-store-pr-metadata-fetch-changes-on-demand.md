# Store PR metadata and fetch changes on demand

Convoy stores PR metadata and renders its PR list from the database, with
backend integration keeping those records current. It fetches diffs and
whole changed-file contents when opened. Persistent PR records give future
CLI-driven review, priority, and review layers a PR to reference even when
no user has the page open; that processing is outside V1.

We considered fetching all PR data on page open with visible-page polling.
That simplifies read-only browsing, but does not provide the persistent PR
records the planned processing needs. Storing full changes is unnecessary
for V1. Live search and opening a search result do not write PR metadata;
open-PR synchronization and closed-history page imports populate stored
records. The [integration specification](../specs/github-integration.md)
defines the persistence boundaries and proposed synchronization details.
