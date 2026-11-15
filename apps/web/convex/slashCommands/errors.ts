export const errors = {
  SLASH_COMMAND_NOT_FOUND: "Slash command not found",
  SLASH_COMMAND_KEY_REQUIRED: "Slash command key is required",
  SLASH_COMMAND_KEY_LENGTH: "Slash command key must be between 2 and 40 characters",
  SLASH_COMMAND_KEY_FORMAT: "Slash command key can only contain lowercase letters, numbers, hyphens, and colons",
  SLASH_COMMAND_DESCRIPTION_LENGTH: "Slash command description must be 500 characters or less",
  SLASH_COMMAND_CATEGORY_LENGTH: "Slash command category must be 80 characters or less",
  SLASH_COMMAND_CONTENT_REQUIRED: "Slash command content is required",
  SLASH_COMMAND_CONTENT_LENGTH: "Slash command content must be 100000 characters or less",
  SLASH_COMMAND_KEY_DUPLICATE: "A slash command with this key already exists",
  SLASH_COMMAND_ORGANIZATION_REQUIRED: "Organization is required for organization slash commands",
  SLASH_COMMAND_ORGANIZATION_NOT_FOUND: "Organization not found",
  SLASH_COMMAND_ORGANIZATION_MEMBERSHIP_REQUIRED: "Not a member of this organization",
  SLASH_COMMAND_ORGANIZATION_FORBIDDEN: "API key is not scoped to this organization",
  SLASH_COMMAND_ORGANIZATION_PROJECT_SCOPED:
    "API key is scoped to specific projects and cannot access organization prompts",
} as const;
