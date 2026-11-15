import { suggestTaskListRefFromName } from "@/lib/task-lists/list-ref";
import { TASK_LIST_COLOR_PALETTE } from "@/lib/colors/palette";
import { ensure } from "../../../lib/shared/ensure";
import { errors } from "../../errors";

const LIST_REF_REGEX = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
export const MAX_LIST_REF_LENGTH = 32;
const MAX_LIST_NAME_LENGTH = 80;
const RESERVED_SYSTEM_LIST_REFS = new Set(["BACKLOG", "ARCHIVED"]);

function normalizeTaskListRef(ref: string): string {
  return ref.trim().toUpperCase();
}

function isValidTaskListRef(ref: string): boolean {
  return (
    ref.length >= 2 &&
    ref.length <= MAX_LIST_REF_LENGTH &&
    LIST_REF_REGEX.test(ref)
  );
}

export function normalizeTaskListRefForLookup(ref: string): string | null {
  const normalizedRef = normalizeTaskListRef(ref);
  return isValidTaskListRef(normalizedRef) ? normalizedRef : null;
}

export function normalizeListName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function createTaskListSearchText(name: string, ref: string): string {
  return `${name} ${ref}`.toLocaleLowerCase();
}

export function validateTaskListName(name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, " ");
  ensure(normalizedName).notEq("", errors.LIST_NAME_REQUIRED);
  ensure(normalizedName.length).lte(MAX_LIST_NAME_LENGTH, errors.listNameTooLong(MAX_LIST_NAME_LENGTH));
  return normalizedName;
}

export function validateTaskListRef(ref: string): string {
  const normalizedRef = normalizeTaskListRef(ref);
  ensure(isValidTaskListRef(normalizedRef)).isTrue(errors.LIST_REF_INVALID);
  ensure(RESERVED_SYSTEM_LIST_REFS.has(normalizedRef)).isFalse(errors.listRefReserved(normalizedRef));
  return normalizedRef;
}

export function validateOrSuggestTaskListRef(name: string, ref?: string): string {
  return validateTaskListRef(ref ?? suggestTaskListRefFromName(name));
}

export function validateTaskListColor(color: string): string {
  ensure(TASK_LIST_COLOR_PALETTE.some((supported) => supported === color)).isTrue(errors.LIST_COLOR_INVALID);
  return color;
}
