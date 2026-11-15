import type { MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { ApiKeyKind } from "../contracts/validators";
import { generateApiKey, getKeyPrefix, hashApiKey } from "./apiKeys";
import { deleteApiKey, listApiKeysByUserKindAndName, insertApiKey, type StoredApiKeyScope } from "../../apiKeys/lib/apiKeysRepo";

/** Insert one key without reading the user's others; `replaceSameName` first deletes every same-kind, same-name key.
 * No per-user cap; cleanup runs out of band. See docs/specs/permissions-system.md#api-key-lifecycle.
 */
export async function mintApiKey(
  ctx: MutationCtx,
  userId: Id<"users">,
  props: {
    name: string;
    expiresAt: number | undefined;
    scope: StoredApiKeyScope;
    kind?: ApiKeyKind;
    sourceKeyId?: Id<"apiKeys">;
    replaceSameName?: boolean;
  }
): Promise<{ id: Id<"apiKeys">; key: string }> {
  const { name, expiresAt, scope, kind, sourceKeyId, replaceSameName } = props;

  if (replaceSameName) {
    for (const previous of await listApiKeysByUserKindAndName(ctx, userId, kind, name)) {
      await deleteApiKey(ctx, previous._id);
    }
  }

  const plaintextKey = generateApiKey();
  const keyHash = await hashApiKey(plaintextKey);
  const keyPrefix = getKeyPrefix(plaintextKey);

  const id = await insertApiKey(ctx, { name, keyHash, keyPrefix, expiresAt, scope, kind, sourceKeyId }, userId);

  return { id, key: plaintextKey };
}
