import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type PullRequestSummary = FunctionReturnType<typeof api.integrations.github.pullRequests.list>["page"][number];
export type PullRequestDetail = NonNullable<NonNullable<FunctionReturnType<typeof api.integrations.github.pullRequests.get>>["pullRequest"]>;
/** What the reader shows: the stored row, or the live PR when Convoy never stored it. */
export type PullRequestView = FunctionReturnType<typeof api.integrations.github.pullRequests.readDiff>["pullRequest"];
export type PullRequestOverview = FunctionReturnType<typeof api.integrations.github.pullRequests.readOverview>;
export type GithubCheck = PullRequestOverview["checks"][number];
export type ReferencedTask = FunctionReturnType<typeof api.integrations.github.pullRequests.referencedTasks>[number];
