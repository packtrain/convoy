import type { ProjectAddResult } from "../../project/validators.js";

export function resultMessage(result: ProjectAddResult, created = false) {
  if (result.ok) return result.applied ? "Registered. Service applied the project. Open Runs to observe work." : "Registration saved. Start the service, then assign credentials from project Actions.";
  const reasons = {
    "target-incompatible": "Target CLI does not support guided project setup. Update the selected environment's CLI with convoy environment update, then retry. Registration did not start; inputs are retained.",
    "environment-unavailable": "Environment unavailable or changed. Restore the selected target before retrying. Registration did not start; inputs are retained.",
    path: "Use a direct child of the target workspace, without traversal.",
    "profile-conflict": "Profile key already belongs to another registration. Choose a different key.",
    "workspace-overlap": "Workspace overlaps another profile or its worktrees. Choose a different path.",
    "project-unavailable": "Project is not accessible with this key. Go back and select an accessible project.",
    "key-scope": "API key does not have the required project scope. Check its organization and allowed project.",
    "clone-mismatch": "This workspace was prepared with a different clone source. Use its original source or a different workspace.",
  } satisfies Record<NonNullable<ProjectAddResult["reason"]>, string>;
  const stages = {
    validation: "Validation failed. Check access, profile key and workspace path. Inputs are retained.",
    creation: "Creation outcome is uncertain. Inspect Convoy before retrying; link the project if it exists.",
    preparation: "Workspace preparation failed. Check the target path, reuse choice and clone access. Files may be retained; inputs remain editable.",
    key: "Worker key validation or issuance failed. Inspect API Keys and saved projects before retrying.",
    registration: "Registration was saved but service reconciliation failed. Retry after checking service status.",
    complete: "Registration completed.",
  };
  return `${result.reason ? reasons[result.reason] : stages[result.phase]}${created && result.projectId ? `\nCreated project retained:\n${result.projectId}` : ""}`;
}
