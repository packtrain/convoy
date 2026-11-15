# One folder per integration provider

Each integration provider gets its own module folder under
`convex/integrations/`, so GitHub is `integrations/github/` and its functions
are `api.integrations.github.<file>.*`. The provider's schema contracts live in
`convex/lib/contracts/<provider>.ts`. `contracts/integrations.ts` keeps only
the validators every provider shares: the provider literal and the setup
status. The UI mirrors this. `components/blocks/integrations/` keeps its single
`index.ts` entry and the catalog page, and each provider's screens, hooks, and
tests sit in its own subfolder. Slack, Jira, Confluence, Asana, and Linear are
planned, and each of them copies the GitHub folder shape.

Nothing is shared yet, so there is no `integrations/lib/`. The OAuth setup
table (`integrationSetups`), `authorizeIntegrationProject`, and token
encryption move up into `integrations/lib/` in the first commit of the
provider that needs them. A catalog query in `integrations/core.ts` that
returns every provider's status for the index page arrives the same way. The
table names (`integrationSetups`, `integrationRepositoryLinks`,
`integrationRepositories`, `integrationPullRequests`) stay put. They already
carry a `provider` field, and renaming them would mean copying data.

We rejected grouping providers by category (`codeHosts/`, `issueTrackers/`).
That bets on sharing that doesn't exist yet. If two issue trackers end up
sharing a table, the capability folder appears when the second one ships. We
also rejected keeping `integrations/github.ts` beside the folder. Convex merges
a file and a same-named folder into one namespace, which would leave GitHub
functions in two places.

The cost: scheduled jobs refer to functions by path, so jobs queued under the
old `integrations/core:*` paths fail after the move. A disconnected link's
pending `purge` is the one that matters, and it has to be re-scheduled under
`integrations/github/core:purge` when the move deploys.
