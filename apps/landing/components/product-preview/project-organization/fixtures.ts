import { threads } from "../fixtures";

export type ProjectTask = {
  id: string; title: string; type: "bug" | "epic" | "feature" | "task";
  status: "To Do" | "In Progress" | "In Review" | "Done";
  priority: "High" | "Medium" | "Low"; owner: string; description: string;
  runtime?: "codex" | "claude-code"; parent?: string;
};

export const tasks: ProjectTask[] = [
  { ...threads[1], status: "In Review", priority: "High", owner: "Maya Chen", runtime: "claude-code", description: "Define the delivery lifecycle, retry limits and idempotency rules before implementation." },
  { ...threads[0], status: "In Progress", priority: "High", owner: "Alex Morgan", runtime: "codex", description: "Retry failed webhook deliveries with exponential backoff. Record each attempt in the delivery history." },
  { ...threads[2], status: "In Review", priority: "Medium", owner: "Maya Chen", runtime: "codex", description: "Preserve status and date filters when sharing a link to the delivery list." },
  { id: "NS-135", title: "Add event payload previews", type: "feature", status: "To Do", priority: "Medium", owner: "Alex Morgan", description: "Show the event payload alongside the delivery response." },
  { id: "NS-130", title: "Document webhook setup", type: "task", status: "To Do", priority: "Low", owner: "Maya Chen", description: "Explain endpoint setup, signing secrets and delivery retries." },
  { id: "NS-134", title: "Track delivery retry metrics", type: "feature", status: "In Progress", priority: "Medium", owner: "Maya Chen", runtime: "claude-code", description: "Chart retry counts and final outcomes for each endpoint." },
  { id: "NS-131", title: "Alert on repeated delivery failures", type: "feature", status: "To Do", priority: "Medium", owner: "Alex Morgan", description: "Notify the endpoint owner after three failed deliveries in a row." },
  { id: "NS-119", title: "Fix duplicate event timestamps", type: "bug", status: "Done", priority: "High", owner: "Alex Morgan", description: "Keep the original event timestamp when a delivery is retried." },
  { id: "NS-127", title: "Remove the legacy webhook endpoint", type: "task", status: "Done", priority: "Low", owner: "Maya Chen", description: "Retire the v1 endpoint once every subscriber has moved to v2." },
  { id: "NS-151", title: "Define retry limits", type: "task", status: "Done", priority: "Medium", owner: "Maya Chen", parent: "NS-139", description: "Document retry limits and the maximum delay between attempts." },
  { id: "NS-152", title: "Review idempotency rules", type: "task", status: "In Progress", priority: "High", owner: "Alex Morgan", parent: "NS-139", runtime: "codex", description: "Check that every retry uses the original idempotency key." },
];

export const projectLists: { name: string; color: string; tasks: ProjectTask[] }[] = [
  { name: "Backlog", color: "#898989", tasks: [
    { id: "NS-129", title: "Improve endpoint validation", type: "task", status: "To Do", priority: "Medium", owner: "Alex Morgan", description: "Check endpoint URLs before saving a webhook subscription." },
    { id: "NS-126", title: "Add delivery search", type: "feature", status: "To Do", priority: "Low", owner: "Maya Chen", description: "Find webhook deliveries by event ID or endpoint." },
    {"id": "NS-157", "title": "Add delivery export", "type": "feature", "status": "To Do", "priority": "Medium", "owner": "Alex Morgan", "description": "Export filtered delivery history as a CSV file."},
    {"id": "NS-158", "title": "Improve retry visibility", "type": "epic", "status": "In Progress", "priority": "High", "owner": "Maya Chen", "description": "Make retry attempts and scheduling visible throughout the delivery dashboard.", "runtime": "claude-code"},
    {"id": "NS-159", "title": "Fix empty endpoint labels", "type": "bug", "status": "In Review", "priority": "High", "owner": "Alex Morgan", "description": "Use the endpoint hostname when a custom label is missing.", "runtime": "codex"},
    {"id": "NS-160", "title": "Add endpoint ownership", "type": "feature", "status": "To Do", "priority": "Low", "owner": "Maya Chen", "description": "Assign a teammate to each webhook endpoint."},
    {"id": "NS-161", "title": "Review retention defaults", "type": "task", "status": "In Progress", "priority": "Medium", "owner": "Alex Morgan", "description": "Compare delivery retention requirements for production and test projects.", "runtime": "codex"},
    {"id": "NS-162", "title": "Document response codes", "type": "task", "status": "Done", "priority": "Low", "owner": "Maya Chen", "description": "Describe which response codes trigger another delivery attempt."},
  ] },
  { name: "Inbox", color: "#898989", tasks: [
    { id: "NS-153", title: "Investigate delayed delivery receipts", type: "bug", status: "To Do", priority: "High", owner: "Maya Chen", description: "Check reports of receipts arriving after the delivery completes." },
    { id: "NS-154", title: "Review webhook timeout feedback", type: "task", status: "To Do", priority: "Medium", owner: "Alex Morgan", description: "Review feedback about endpoint timeouts and record the next steps." },
    {"id": "NS-163", "title": "Fix delivery history pagination", "type": "bug", "status": "In Progress", "priority": "Medium", "owner": "Alex Morgan", "description": "Keep the selected filters when loading the next page of deliveries.", "runtime": "codex"},
    {"id": "NS-164", "title": "Add request duration to receipts", "type": "feature", "status": "To Do", "priority": "High", "owner": "Maya Chen", "description": "Include endpoint response time in the delivery receipt."},
    {"id": "NS-165", "title": "Check duplicate webhook reports", "type": "bug", "status": "In Review", "priority": "High", "owner": "Alex Morgan", "description": "Compare reported duplicate events with their idempotency keys.", "runtime": "codex"},
    {"id": "NS-166", "title": "Review endpoint import requests", "type": "task", "status": "To Do", "priority": "Low", "owner": "Maya Chen", "description": "Collect requirements for importing endpoints from a configuration file."},
    {"id": "NS-167", "title": "Clarify signing error messages", "type": "task", "status": "Done", "priority": "Medium", "owner": "Alex Morgan", "description": "Explain whether a signing failure comes from the key or payload."},
    {"id": "NS-168", "title": "Investigate missing response bodies", "type": "bug", "status": "In Progress", "priority": "Low", "owner": "Maya Chen", "description": "Check why some failed deliveries omit the endpoint response body.", "runtime": "claude-code"},
  ] },
  { name: "Milestone 1", color: "#93c5fd", tasks },
  { name: "Milestone 2", color: "#3b82f6", tasks: [
    { id: "NS-132", title: "Show delivery response headers", type: "feature", status: "In Progress", priority: "Medium", owner: "Alex Morgan", runtime: "codex", description: "Include endpoint response headers in delivery details." },
    { id: "NS-133", title: "Handle expired signing secrets", type: "bug", status: "In Review", priority: "High", owner: "Maya Chen", runtime: "claude-code", description: "Explain expired signing secrets and support secret rotation." },
    {"id": "NS-169", "title": "Build endpoint health dashboard", "type": "epic", "status": "In Progress", "priority": "Medium", "owner": "Alex Morgan", "description": "Summarize delivery success rates, response times and recent failures.", "runtime": "codex"},
    {"id": "NS-170", "title": "Add delivery latency charts", "type": "feature", "status": "To Do", "priority": "High", "owner": "Maya Chen", "description": "Plot delivery latency over the selected time range."},
    {"id": "NS-171", "title": "Test secret rotation", "type": "task", "status": "In Review", "priority": "High", "owner": "Alex Morgan", "description": "Verify deliveries during the overlap between old and new signing secrets.", "runtime": "codex"},
    {"id": "NS-172", "title": "Fix response header casing", "type": "bug", "status": "Done", "priority": "Low", "owner": "Maya Chen", "description": "Normalize header names before comparing endpoint responses."},
    {"id": "NS-173", "title": "Add retry attempt filters", "type": "feature", "status": "To Do", "priority": "Medium", "owner": "Alex Morgan", "description": "Filter delivery history by the number of retry attempts."},
    {"id": "NS-174", "title": "Document endpoint health checks", "type": "task", "status": "Done", "priority": "Low", "owner": "Maya Chen", "description": "Explain how health checks detect a failing endpoint."},
  ] },
  { name: "Ideas", color: "#eab308", tasks: [
    { id: "NS-155", title: "Explore delivery replay", type: "feature", status: "To Do", priority: "Low", owner: "Maya Chen", description: "Explore replaying a past event against a test endpoint." },
    { id: "NS-156", title: "Group endpoint health alerts", type: "feature", status: "To Do", priority: "Low", owner: "Alex Morgan", description: "Collect related endpoint failures into one notification." },
    {"id": "NS-175", "title": "Prototype event payload diffing", "type": "feature", "status": "In Progress", "priority": "Medium", "owner": "Alex Morgan", "description": "Compare the payloads of two deliveries without leaving the dashboard.", "runtime": "codex"},
    {"id": "NS-176", "title": "Explore endpoint templates", "type": "epic", "status": "To Do", "priority": "High", "owner": "Maya Chen", "description": "Define reusable settings for common webhook destinations."},
    {"id": "NS-177", "title": "Review replay permissions", "type": "task", "status": "In Review", "priority": "High", "owner": "Alex Morgan", "description": "Determine who can replay production events and how to record the action.", "runtime": "codex"},
    {"id": "NS-178", "title": "Try grouped failure summaries", "type": "feature", "status": "In Progress", "priority": "Low", "owner": "Maya Chen", "description": "Prototype a daily summary of failures grouped by endpoint.", "runtime": "claude-code"},
    {"id": "NS-179", "title": "Evaluate delivery sampling", "type": "task", "status": "Done", "priority": "Medium", "owner": "Alex Morgan", "description": "Compare sampling strategies for high-volume delivery logs."},
    {"id": "NS-180", "title": "Add saved delivery searches", "type": "feature", "status": "To Do", "priority": "Low", "owner": "Maya Chen", "description": "Let teammates save and reuse frequently selected delivery filters."},
  ] },
];
