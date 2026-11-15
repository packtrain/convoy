/**
 * User-facing error messages thrown by the checks domain. Specs and tests
 * assert on these strings — keep them in sync with `docs/specs/task-checks.md`.
 */
export const errors = {
  CHECK_NOT_FOUND: "Check not found",
  CHECK_KEY_INVALID: "Check key must start with a lowercase letter or digit and use only a-z, 0-9, - and _",
  CHECK_KEY_TAKEN: "A check with this key already exists",
  CHECK_LABEL_REQUIRED: "Check label cannot be empty",
  CHECKLIST_NOT_FOUND: "Checklist not found",
  CHECKLIST_DIFFERENT_PROJECT: "Checklist must belong to the task's project",
  CHECKLIST_NAME_REQUIRED: "Checklist name cannot be empty",
  CHECKLIST_NAME_TAKEN: "A checklist with this name already exists",
  CHECK_ARTIFACT_DIFFERENT_PROJECT: "Artifact must belong to this project",
  checkArtifactNotFound: (id: string) => `Artifact '${id}' was not found`,
  checkNoteRequired: (status: string) => `A ${status} check needs a note`,
  checkNoteTooLong: (max: number) => `Check note must be at most ${max} characters`,
  checkValueTooLong: (max: number) => `Check value can be at most ${max} characters`,
  checkLabelRequiredOutsideCatalog: (key: string) => `Check '${key}' is not in the catalog, so it needs a label`,
  checkKeyTooLong: (max: number) => `Check key must be at most ${max} characters`,
  checkLabelTooLong: (max: number) => `Check label must be at most ${max} characters`,
  checkInstructionTooLong: (max: number) => `Check instruction must be at most ${max} characters`,
  checkLimitReached: (max: number) => `A project can have up to ${max} checks`,
  checklistNameTooLong: (max: number) => `Checklist name must be at most ${max} characters`,
  checklistLimitReached: (max: number) => `A project can have up to ${max} checklists`,
  checklistUnknownCheck: (key: string) => `Unknown check '${key}'`,
} as const;
