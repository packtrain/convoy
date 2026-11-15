import { ensure } from "../../lib/shared/ensure";
import { errors } from "../errors";
import { MAX_CHECK_KEY_LENGTH, MAX_CHECK_LABEL_LENGTH } from "./constants";

const CHECK_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export function validateCheckKey(raw: string): string {
  const key = raw.trim();
  ensure(key.length).lte(MAX_CHECK_KEY_LENGTH, errors.checkKeyTooLong(MAX_CHECK_KEY_LENGTH));
  ensure(key).regex(CHECK_KEY_PATTERN, errors.CHECK_KEY_INVALID);
  return key;
}

export function validateCheckLabel(raw: string): string {
  const label = raw.trim().replace(/\s+/g, " ");
  ensure(label).notEq("", errors.CHECK_LABEL_REQUIRED);
  ensure(label.length).lte(MAX_CHECK_LABEL_LENGTH, errors.checkLabelTooLong(MAX_CHECK_LABEL_LENGTH));
  return label;
}
