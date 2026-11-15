export const DEV_SETTING_ENABLED_VALUE = "1";
export const DEV_SETTING_DISABLED_VALUE = "0";
export const DEV_SETTINGS_STORAGE_EVENT = "convoy:dev-settings-change";

export const DEV_SETTINGS = {
  extraProjectSettings: {
    label: "Extra project settings",
    description:
      "Enable the in-progress project settings sections and customization tabs.",
    storageKey: "convoy.dev-setting.extra-project-settings",
  },
  taskListShowRank: {
    label: "Task list: Show rank",
    description:
      "Show each task's raw LexoRank in the main project task list.",
    storageKey: "convoy.dev-setting.task-list-show-rank",
  },
  showUnfinishedItems: {
    label: "Show unfinished items",
    description:
      "Show disabled placeholder menu items, tabs and settings sections for features that are not built yet.",
    storageKey: "convoy.dev-setting.show-unfinished-items",
  },
  toolCallDebug: {
    label: "Threads: Tool call debug",
    description: "Show a button on tool call rows that copies the raw tool call JSON.",
    storageKey: "convoy.dev-setting.tool-call-debug",
  },
  githubIntegration: {
    label: "GitHub integration",
    description:
      "Show project Integrations settings and the Pull Requests page while the GitHub integration is in progress.",
    storageKey: "convoy.dev-setting.github-integration",
  },
} as const;

export type DevSettingId = keyof typeof DEV_SETTINGS;

export const DEV_SETTING_IDS = Object.keys(DEV_SETTINGS) as DevSettingId[];
