import type {
  GenericCliRuntimeSlug,
  GenericAvailableCli,
  ParseResult,
} from "../contracts";
import { success } from "./parsing";

export type GenericCliRuntimeDefinition<T extends GenericCliRuntimeSlug> = {
  type: T;
  label: string;
  parseAvailableCli: (
    _cli: Record<string, unknown>,
    version: string,
  ) => ParseResult<GenericAvailableCli<T>>;
};

export function createGenericCliRuntime<T extends GenericCliRuntimeSlug>(args: {
  type: T;
  label: string;
}): GenericCliRuntimeDefinition<T> {
  return {
    type: args.type,
    label: args.label,
    parseAvailableCli: (_cli, version) =>
      success({
        type: args.type,
        version,
      }),
  };
}
