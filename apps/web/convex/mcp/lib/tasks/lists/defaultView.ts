import {
  boardGroupByValidator,
  listGroupByValidator,
  projectViewModeValidator,
} from "../../../../lib/contracts/validators";

/**
 * Enum allowlists for the per-List default view (OS-1566), shared by the MCP
 * tool schemas and their handlers. Derived from the validators so a new view
 * mode or grouping dimension needs no edit here.
 */
export const DEFAULT_VIEW_MODES = projectViewModeValidator.members.map(
  (member) => member.value
);

export const BOARD_GROUP_BYS = boardGroupByValidator.members.map(
  (member) => member.value
);

export const LIST_GROUP_BYS = listGroupByValidator.members.map(
  (member) => member.value
);
