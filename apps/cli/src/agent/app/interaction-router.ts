export interface AnsweredInteraction {
  requestId: string;
  responseJson: string;
}

/**
 * Routes answered interaction requests (from the one standing per-session
 * Convex subscription) to the parked provider callback that is awaiting
 * them. Subscriptions re-fire with the full answered set, so dispatch
 * dedupes by requestId.
 */
export interface InteractionRouter {
  register(requestId: string, resolve: (responseJson: string) => void): void;
  unregister(requestId: string): void;
  dispatch(answered: AnsweredInteraction[]): void;
}

export function createInteractionRouter(): InteractionRouter {
  const resolvers = new Map<string, (responseJson: string) => void>();
  const delivered = new Set<string>();

  return {
    register(requestId, resolve) {
      resolvers.set(requestId, resolve);
    },

    unregister(requestId) {
      resolvers.delete(requestId);
    },

    dispatch(answered) {
      for (const item of answered) {
        if (delivered.has(item.requestId)) {
          continue;
        }

        const resolve = resolvers.get(item.requestId);
        if (!resolve) {
          // Not parked here (other worker, or already cancelled) — leave it
          // for a later register/dispatch cycle rather than marking delivered.
          continue;
        }

        delivered.add(item.requestId);
        resolvers.delete(item.requestId);
        resolve(item.responseJson);
      }
    },
  };
}
