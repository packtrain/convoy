export const TASK_PERMANENT_DELETE_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

export const MAX_SEARCH_TERMS = 16;
export const REF_QUERY_REGEX = /^([A-Z][A-Z0-9]{1,4})-(\d+)$/;

export const MAX_REFS_PER_CALL = 25;

export const MAX_LABELS_PER_PROJECT = 20;
export const MAX_LABEL_NAME_LENGTH = 50;

// Create cap and read bound for every section query.
export const MAX_SECTIONS_PER_PROJECT = 100;
export const MAX_SECTION_NAME_LENGTH = 100;

// One index range per id in `tasks.agentThreadWork.listByTasks`; clients chunk longer lists.
export const MAX_AGENT_THREAD_WORK_TASK_IDS = 1000;
