import { LexoRank } from "lexorank";
import type { Id } from "@/convex/_generated/dataModel";
import { Status } from "@/lib/tasks/status";
import type { LocalTask, Priority } from "@/lib/tasks/types";
import type { SectionPlacement, TaskSection } from "./sections";

// The Milestone 1 list from the landing project preview, as local tasks.
type Seed = [ref: string, name: string, type: string, status: Status, priority: Priority, owner: string, parent?: string];
const SEEDS: Seed[] = [
  ["NS-139", "Review the webhook delivery plan", "epic", Status.IN_REVIEW, "High", "Maya Chen"],
  ["NS-151", "Define retry limits", "task", Status.DONE, "Medium", "Maya Chen", "NS-139"],
  ["NS-152", "Review idempotency rules", "task", Status.IN_PROGRESS, "High", "Alex Morgan", "NS-139"],
  ["NS-142", "Add retry handling for failed deliveries", "bug", Status.IN_PROGRESS, "High", "Alex Morgan"],
  ["NS-136", "Keep delivery filters in the URL", "feature", Status.IN_REVIEW, "Medium", "Maya Chen"],
  ["NS-135", "Add event payload previews", "feature", Status.TODO, "Medium", "Alex Morgan"],
  ["NS-130", "Document webhook setup", "task", Status.TODO, "Low", "Maya Chen"],
  ["NS-134", "Track delivery retry metrics", "feature", Status.IN_PROGRESS, "Medium", "Maya Chen"],
  ["NS-131", "Alert on repeated delivery failures", "feature", Status.TODO, "Medium", "Alex Morgan"],
  ["NS-119", "Fix duplicate event timestamps", "bug", Status.DONE, "High", "Alex Morgan"],
  ["NS-127", "Remove the legacy webhook endpoint", "task", Status.DONE, "Low", "Maya Chen"],
];

let rank = LexoRank.middle();
export const SEED_TASKS: LocalTask[] = SEEDS.map(([ref, name, , status, priority, owner, parent]) => {
  rank = rank.genNext();
  return {
    id: ref,
    name,
    priority,
    dueDate: "",
    status,
    assignee: { type: "user", userId: owner as Id<"users">, name: owner, avatarUrl: null },
    tags: [],
    rank: rank.toString(),
    parentId: parent ?? null,
  };
});

export const TASK_TYPE_BY_ID: Record<string, string> = Object.fromEntries(SEEDS.map(([ref, , type]) => [ref, type]));

export const SEED_SECTIONS: TaskSection[] = [
  { id: "retries", name: "Delivery retries", color: "#f97316", collapsed: false },
  { id: "monitoring", name: "Monitoring", color: "#3b82f6", collapsed: false },
  { id: "docs", name: "Docs and cleanup", color: "#8b5cf6", collapsed: false },
];

export const SEED_PLACEMENT: SectionPlacement = {
  "NS-139": "retries", "NS-142": "retries", "NS-119": "retries",
  "NS-134": "monitoring", "NS-131": "monitoring",
  "NS-130": "docs", "NS-127": "docs",
};
