import { LexoRank } from "lexorank";
import { PRIORITIES, STATUS_OPTIONS } from "@/lib/tasks/constants";
import type { LocalTask } from "@/lib/tasks/types";
import type { Id } from "@/convex/_generated/dataModel";

// Change this number to adjust how many dummy tasks are generated
const TASK_COUNT = 300;

function generateInitialRanks(count: number): string[] {
  const ranks: string[] = [];
  let rank = LexoRank.middle();
  for (let i = 0; i < count; i++) {
    ranks.push(rank.toString());
    rank = rank.genNext();
  }
  return ranks;
}

const ranks = generateInitialRanks(TASK_COUNT);

const taskNames = [
  "Design new landing page mockups",
  "Review pull requests from team",
  "Update project documentation",
  "Fix authentication bug in login flow",
  "Prepare presentation for client meeting",
  "Refactor database queries for performance",
  "Write unit tests for payment module",
  "Set up CI/CD pipeline for staging",
  "Conduct user interviews for feedback",
  "Implement dark mode support",
  "Optimize image loading performance",
  "Add keyboard shortcuts",
  "Create API documentation",
  "Fix mobile responsive issues",
  "Add analytics tracking",
  "Implement search functionality",
  "Review security vulnerabilities",
  "Update dependencies",
  "Add error boundary components",
  "Implement caching strategy",
];

const assignees = ["Sarah Chen", "Mike Johnson", "Emily Davis", "Alex Kim", "Jordan Lee"];
const tagOptions = [["Design", "Frontend"], ["Code Review"], ["Bug", "Backend"], ["Meeting"], ["Backend", "Performance"], ["DevOps"], ["Testing"], []];

export const initialTasks: LocalTask[] = Array.from({ length: TASK_COUNT }, (_, i) => ({
  id: String(i + 1),
  name: `${taskNames[i % taskNames.length]} #${i + 1}`,
  priority: PRIORITIES[i % PRIORITIES.length],
  dueDate: `Dec ${(i % 28) + 1}`,
  status: STATUS_OPTIONS[i % STATUS_OPTIONS.length],
  assignee: {
    type: "user",
    userId: String(i % assignees.length) as Id<"users">,
    name: assignees[i % assignees.length],
    avatarUrl: null,
  },
  tags: tagOptions[i % tagOptions.length],
  rank: ranks[i],
  parentId: null,
}));
